import { parseCSV, guessMapping, parseAmount, parseDate } from '../csv.js';
import { loadCategories } from '../categories.js';
import { loadTransactions, saveTransactions, loadMerchantMap, categorize, transactionId } from '../categorize.js';

let state = {
  account: 'checking',
  files: [], // {name, headers, records}
  mapping: null,
  amountMode: 'single', // 'single' | 'debitCredit'
  spentIsPositive: false,
};

function resetState() {
  state = { account: state.account, files: [], mapping: null, amountMode: 'single', spentIsPositive: false };
}

async function readFiles(fileList) {
  const files = [];
  for (const f of fileList) {
    const text = await f.text();
    const { headers, records } = parseCSV(text);
    files.push({ name: f.name, headers, records });
  }
  return files;
}

function buildTransactionsFromFiles(files, mapping, amountMode, spentIsPositive, account, categories, merchantMap) {
  const result = { txns: [], skipped: 0 };
  for (const file of files) {
    for (const record of file.records) {
      const date = parseDate(record[mapping.dateCol]);
      const description = (record[mapping.descCol] || '').trim();
      let amount;

      if (amountMode === 'single') {
        const raw = parseAmount(record[mapping.amountCol]);
        if (isNaN(raw)) { result.skipped++; continue; }
        amount = spentIsPositive ? -raw : raw;
      } else {
        const debit = mapping.debitCol ? parseAmount(record[mapping.debitCol]) : NaN;
        const credit = mapping.creditCol ? parseAmount(record[mapping.creditCol]) : NaN;
        const d = isNaN(debit) ? 0 : Math.abs(debit);
        const c = isNaN(credit) ? 0 : Math.abs(credit);
        if (d === 0 && c === 0) { result.skipped++; continue; }
        amount = c - d;
      }

      if (!date || !description || isNaN(amount)) { result.skipped++; continue; }

      const categoryId = categorize(description, amount, account, categories, merchantMap);
      const id = transactionId(account, date, description, amount);
      result.txns.push({ id, date, description, amount, account, categoryId, isManual: false, importedAt: new Date().toISOString() });
    }
  }
  return result;
}

export function render(root) {
  const container = document.createElement('div');
  container.innerHTML = `
    <h1>Import Transactions</h1>
    <p class="subtitle">Upload a CSV export from your bank or credit card. Parsing happens entirely in your browser.</p>

    <div class="card">
      <div class="form-row">
        <label>Account type
          <select id="acct-type">
            <option value="checking">Checking</option>
            <option value="credit">Credit Card</option>
          </select>
        </label>
      </div>
      <div class="dropzone" id="dropzone">
        <div id="dropzone-text">Drag CSV file(s) here, or click to choose</div>
        <input type="file" id="file-input" accept=".csv" multiple style="display:none">
      </div>
    </div>

    <div id="mapping-area"></div>
    <div id="summary-area"></div>
  `;
  root.innerHTML = '';
  root.appendChild(container);

  const acctSelect = container.querySelector('#acct-type');
  acctSelect.value = state.account;
  acctSelect.addEventListener('change', () => {
    state.account = acctSelect.value;
    state.spentIsPositive = state.account === 'credit';
    if (state.files.length) renderMapping();
  });

  const dropzone = container.querySelector('#dropzone');
  const fileInput = container.querySelector('#file-input');
  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    await handleFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', async () => {
    await handleFiles(fileInput.files);
  });

  async function handleFiles(fileList) {
    if (!fileList.length) return;
    state.files = await readFiles(fileList);
    state.spentIsPositive = state.account === 'credit';
    container.querySelector('#dropzone-text').textContent = `${state.files.length} file(s) loaded: ${state.files.map((f) => f.name).join(', ')}`;
    renderMapping();
  }

  function renderMapping() {
    const headers = state.files[0]?.headers || [];
    state.mapping = guessMapping(headers);
    if (!state.mapping.amountCol && (state.mapping.debitCol || state.mapping.creditCol)) {
      state.amountMode = 'debitCredit';
    } else {
      state.amountMode = 'single';
    }

    const mappingArea = container.querySelector('#mapping-area');
    const headerOptions = (selected) => headers.map((h) => `<option value="${h}" ${h === selected ? 'selected' : ''}>${h}</option>`).join('');
    const noneOption = (selected) => `<option value="" ${!selected ? 'selected' : ''}>— none —</option>`;

    mappingArea.innerHTML = `
      <div class="card">
        <h2 style="margin-top:0">Confirm Column Mapping</h2>
        <div class="mapping-grid">
          <label>Date column
            <select id="map-date">${headerOptions(state.mapping.dateCol)}</select>
          </label>
          <label>Description column
            <select id="map-desc">${headerOptions(state.mapping.descCol)}</select>
          </label>
          <label>Amount format
            <select id="map-mode">
              <option value="single" ${state.amountMode === 'single' ? 'selected' : ''}>Single amount column</option>
              <option value="debitCredit" ${state.amountMode === 'debitCredit' ? 'selected' : ''}>Separate debit/credit columns</option>
            </select>
          </label>
        </div>
        <div class="mapping-grid" id="amount-fields"></div>
        <p style="color:var(--text-secondary);font-size:0.85rem">Preview (first 5 rows):</p>
        <div id="preview-table"></div>
        <div class="form-row" style="margin-top:14px">
          <button class="primary" id="do-import">Import ${state.files.reduce((n, f) => n + f.records.length, 0)} rows</button>
        </div>
        <div id="import-error" style="color:var(--bad);font-size:0.85rem"></div>
      </div>
    `;

    const dateSel = mappingArea.querySelector('#map-date');
    const descSel = mappingArea.querySelector('#map-desc');
    const modeSel = mappingArea.querySelector('#map-mode');

    function renderAmountFields() {
      const amtFields = mappingArea.querySelector('#amount-fields');
      if (state.amountMode === 'single') {
        amtFields.innerHTML = `
          <label>Amount column
            <select id="map-amount">${headerOptions(state.mapping.amountCol)}</select>
          </label>
          <label>Sign convention
            <select id="map-sign">
              <option value="neg" ${!state.spentIsPositive ? 'selected' : ''}>Negative = money spent</option>
              <option value="pos" ${state.spentIsPositive ? 'selected' : ''}>Positive = money spent</option>
            </select>
          </label>
        `;
        amtFields.querySelector('#map-amount').addEventListener('change', (e) => { state.mapping.amountCol = e.target.value; renderPreview(); });
        amtFields.querySelector('#map-sign').addEventListener('change', (e) => { state.spentIsPositive = e.target.value === 'pos'; renderPreview(); });
      } else {
        amtFields.innerHTML = `
          <label>Debit (money out) column
            <select id="map-debit">${noneOption(state.mapping.debitCol)}${headerOptions(state.mapping.debitCol)}</select>
          </label>
          <label>Credit (money in) column
            <select id="map-credit">${noneOption(state.mapping.creditCol)}${headerOptions(state.mapping.creditCol)}</select>
          </label>
        `;
        amtFields.querySelector('#map-debit').addEventListener('change', (e) => { state.mapping.debitCol = e.target.value; renderPreview(); });
        amtFields.querySelector('#map-credit').addEventListener('change', (e) => { state.mapping.creditCol = e.target.value; renderPreview(); });
      }
    }

    function renderPreview() {
      const categories = loadCategories();
      const merchantMap = loadMerchantMap();
      const sample = { ...state.files[0], records: state.files[0].records.slice(0, 5) };
      const { txns } = buildTransactionsFromFiles([sample], state.mapping, state.amountMode, state.spentIsPositive, state.account, categories, merchantMap);
      const preview = mappingArea.querySelector('#preview-table');
      if (!txns.length) {
        preview.innerHTML = '<p class="chart-empty">Nothing parsed yet — check the column mapping above.</p>';
        return;
      }
      preview.innerHTML = `
        <table>
          <thead><tr><th>Date</th><th>Description</th><th class="num">Amount</th><th>Guessed Category</th></tr></thead>
          <tbody>
            ${txns.map((t) => {
              const cat = categories.find((c) => c.id === t.categoryId);
              return `<tr><td>${t.date}</td><td>${t.description}</td><td class="num">${t.amount.toFixed(2)}</td><td><span class="badge">${cat?.name || '—'}</span></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }

    dateSel.addEventListener('change', (e) => { state.mapping.dateCol = e.target.value; renderPreview(); });
    descSel.addEventListener('change', (e) => { state.mapping.descCol = e.target.value; renderPreview(); });
    modeSel.addEventListener('change', (e) => { state.amountMode = e.target.value; renderAmountFields(); renderPreview(); });

    renderAmountFields();
    renderPreview();

    mappingArea.querySelector('#do-import').addEventListener('click', () => {
      const errEl = mappingArea.querySelector('#import-error');
      if (!state.mapping.dateCol || !state.mapping.descCol) {
        errEl.textContent = 'Please select both a date and description column.';
        return;
      }
      if (state.amountMode === 'single' && !state.mapping.amountCol) {
        errEl.textContent = 'Please select an amount column.';
        return;
      }
      if (state.amountMode === 'debitCredit' && !state.mapping.debitCol && !state.mapping.creditCol) {
        errEl.textContent = 'Please select at least one of debit or credit column.';
        return;
      }
      errEl.textContent = '';
      doImport();
    });
  }

  function doImport() {
    const categories = loadCategories();
    const merchantMap = loadMerchantMap();
    const existing = loadTransactions();
    const existingIds = new Set(existing.map((t) => t.id));

    const { txns, skipped } = buildTransactionsFromFiles(state.files, state.mapping, state.amountMode, state.spentIsPositive, state.account, categories, merchantMap);

    const newOnes = [];
    let duplicates = 0;
    for (const t of txns) {
      if (existingIds.has(t.id)) { duplicates++; continue; }
      existingIds.add(t.id);
      newOnes.push(t);
    }

    saveTransactions([...existing, ...newOnes]);

    const byCategory = {};
    for (const t of newOnes) {
      const cat = categories.find((c) => c.id === t.categoryId);
      const name = cat?.name || 'Uncategorized';
      byCategory[name] = (byCategory[name] || 0) + 1;
    }

    const summaryArea = container.querySelector('#summary-area');
    summaryArea.innerHTML = `
      <div class="card import-summary">
        <h2 style="margin-top:0">Import Complete</h2>
        <p><strong>${newOnes.length}</strong> new transactions imported, <strong>${duplicates}</strong> duplicates skipped${skipped ? `, <strong>${skipped}</strong> rows skipped (missing data)` : ''}.</p>
        ${newOnes.length ? `<ul>${Object.entries(byCategory).map(([name, n]) => `<li>${name}: ${n}</li>`).join('')}</ul>` : ''}
      </div>
    `;

    resetState();
    container.querySelector('#mapping-area').innerHTML = '';
    container.querySelector('#dropzone-text').textContent = 'Drag CSV file(s) here, or click to choose';
    fileInput.value = '';
  }
}
