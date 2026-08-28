// Minimal RFC4180-ish CSV parser. No external dependencies — everything
// runs locally in the browser, nothing is ever sent over the network.

export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings so \r\n and \r both behave.
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-empty trailing rows.
  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) {
    rows.pop();
  }

  if (!rows.length) return { headers: [], records: [] };

  const headers = rows[0].map((h) => h.trim());
  const records = rows.slice(1).map((r) => {
    const rec = {};
    headers.forEach((h, idx) => {
      rec[h] = (r[idx] ?? '').trim();
    });
    return rec;
  });

  return { headers, records };
}

const DATE_HEADER_HINTS = ['date', 'transaction date', 'posting date', 'trans date', 'post date'];
const DESC_HEADER_HINTS = ['description', 'merchant', 'name', 'payee', 'memo'];
const AMOUNT_HEADER_HINTS = ['amount', 'amt'];
const DEBIT_HEADER_HINTS = ['debit', 'withdrawal'];
const CREDIT_HEADER_HINTS = ['credit', 'deposit'];

function bestMatch(headers, hints) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const hint of hints) {
    const idx = lower.indexOf(hint);
    if (idx !== -1) return headers[idx];
  }
  for (const hint of hints) {
    const idx = lower.findIndex((h) => h.includes(hint));
    if (idx !== -1) return headers[idx];
  }
  return '';
}

// Suggests a column mapping the user can confirm/correct in the import UI.
export function guessMapping(headers) {
  const amountCol = bestMatch(headers, AMOUNT_HEADER_HINTS);
  return {
    dateCol: bestMatch(headers, DATE_HEADER_HINTS),
    descCol: bestMatch(headers, DESC_HEADER_HINTS),
    amountCol,
    debitCol: amountCol ? '' : bestMatch(headers, DEBIT_HEADER_HINTS),
    creditCol: amountCol ? '' : bestMatch(headers, CREDIT_HEADER_HINTS),
  };
}

export function parseAmount(str) {
  if (str == null) return NaN;
  const cleaned = String(str).replace(/[$,]/g, '').trim();
  if (cleaned === '') return NaN;
  if (/^\(.*\)$/.test(cleaned)) {
    return -parseFloat(cleaned.slice(1, -1));
  }
  return parseFloat(cleaned);
}

export function parseDate(str) {
  if (!str) return '';
  const s = str.trim();
  // M/D/YYYY or M/D/YY
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let [, mo, da, yr] = m;
    if (yr.length === 2) yr = `20${yr}`;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  // YYYY-MM-DD already
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, yr, mo, da] = m;
    return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return '';
}
