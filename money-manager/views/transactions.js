import { loadCategories } from '../categories.js';
import { loadTransactions, saveTransactions, loadMerchantMap, applyManualCategory, normalizeDescription } from '../categorize.js';
import { fmtMoney, listMonths, monthLabel } from '../utils.js';

export function render(root) {
  const categories = loadCategories();
  let txns = loadTransactions();
  const merchantMap = loadMerchantMap();

  const container = document.createElement('div');
  container.innerHTML = `
    <h1>Transactions</h1>
    <p class="subtitle">${txns.length} transactions. Recategorizing a merchant applies to every past and future transaction from that merchant.</p>
    <div class="form-row">
      <label>Month
        <select id="filter-month"><option value="all">All</option></select>
      </label>
      <label>Account
        <select id="filter-account">
          <option value="all">All</option>
          <option value="checking">Checking</option>
          <option value="credit">Credit Card</option>
        </select>
      </label>
      <label>Category
        <select id="filter-category"><option value="all">All</option></select>
      </label>
      <label>Search
        <input type="text" id="filter-search" placeholder="Merchant name…">
      </label>
    </div>
    <div class="card"><div id="txn-table"></div></div>
  `;
  root.innerHTML = '';
  root.appendChild(container);

  const monthSelect = container.querySelector('#filter-month');
  listMonths(txns).slice().reverse().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = monthLabel(m);
    monthSelect.appendChild(opt);
  });

  const catSelect = container.querySelector('#filter-category');
  categories.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    catSelect.appendChild(opt);
  });

  const accountSelect = container.querySelector('#filter-account');
  const searchInput = container.querySelector('#filter-search');

  [monthSelect, accountSelect, catSelect].forEach((el) => el.addEventListener('change', renderTable));
  searchInput.addEventListener('input', renderTable);

  function renderTable() {
    const monthFilter = monthSelect.value;
    const accountFilter = accountSelect.value;
    const catFilter = catSelect.value;
    const search = searchInput.value.trim().toLowerCase();

    const filtered = txns
      .filter((t) => monthFilter === 'all' || t.date.startsWith(monthFilter))
      .filter((t) => accountFilter === 'all' || t.account === accountFilter)
      .filter((t) => catFilter === 'all' || t.categoryId === catFilter)
      .filter((t) => !search || t.description.toLowerCase().includes(search))
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    const tableEl = container.querySelector('#txn-table');
    if (!filtered.length) {
      tableEl.innerHTML = '<p class="chart-empty">No transactions match these filters.</p>';
      return;
    }

    tableEl.innerHTML = `
      <table>
        <thead>
          <tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th class="num">Amount</th></tr>
        </thead>
        <tbody>
          ${filtered.map((t) => `
            <tr data-id="${t.id}">
              <td>${t.date}</td>
              <td>${t.description}</td>
              <td><span class="badge">${t.account === 'checking' ? 'Checking' : 'Credit'}</span></td>
              <td>
                <select class="cat-select" data-id="${t.id}">
                  ${categories.map((c) => `<option value="${c.id}" ${c.id === t.categoryId ? 'selected' : ''}>${c.name}</option>`).join('')}
                </select>
              </td>
              <td class="num" style="color:${t.amount < 0 ? 'var(--bad)' : 'var(--good)'}">${fmtMoney(t.amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    tableEl.querySelectorAll('.cat-select').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        const newCatId = e.target.value;
        const similarCount = txns.filter((t) => t.id !== id && normalizeDescription(t.description) === normalizeDescription(txns.find((x) => x.id === id).description)).length;
        const applyToAll = similarCount === 0 || confirm(`Apply "${categories.find((c) => c.id === newCatId).name}" to all ${similarCount + 1} transactions from this merchant too?`);
        txns = applyManualCategory(txns, merchantMap, id, newCatId, applyToAll);
        saveTransactions(txns);
        renderTable();
      });
    });
  }

  renderTable();
}
