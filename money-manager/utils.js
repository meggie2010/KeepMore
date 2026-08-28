export function fmtMoney(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

export function monthKey(dateStr) {
  return (dateStr || '').slice(0, 7);
}

export function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

export function listMonths(txns) {
  const set = new Set(txns.map((t) => monthKey(t.date)).filter(Boolean));
  return Array.from(set).sort();
}

export function prevMonthKey(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function lastNMonths(allMonths, n) {
  return allMonths.slice(Math.max(0, allMonths.length - n));
}

// Computes fixed/guilt-free/income/savings totals for one month.
export function monthSummary(txns, categories, key) {
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const inMonth = txns.filter((t) => monthKey(t.date) === key);

  let income = 0;
  let fixedNet = 0;
  let guiltfreeNet = 0;

  for (const t of inMonth) {
    const cat = catById[t.categoryId];
    if (!cat) continue;
    if (cat.group === 'income') {
      if (t.amount > 0) income += t.amount;
    } else if (cat.group === 'fixed') {
      fixedNet += t.amount;
    } else if (cat.group === 'guiltfree') {
      guiltfreeNet += t.amount;
    }
    // transfer group is excluded entirely
  }

  const fixedSpend = Math.max(-fixedNet, 0);
  const guiltfreeSpend = Math.max(-guiltfreeNet, 0);
  const totalSpend = fixedSpend + guiltfreeSpend;
  const savings = income - totalSpend;
  const savingsRate = income > 0 ? (savings / income) * 100 : null;

  return { income, fixedSpend, guiltfreeSpend, totalSpend, savings, savingsRate };
}

export function categoryTotalsForMonth(txns, categories, key) {
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const inMonth = txns.filter((t) => monthKey(t.date) === key);
  const totals = {};
  for (const t of inMonth) {
    const cat = catById[t.categoryId];
    if (!cat || cat.group !== 'fixed' && cat.group !== 'guiltfree') continue;
    if (t.amount >= 0) continue;
    totals[cat.id] = (totals[cat.id] || 0) + -t.amount;
  }
  return Object.entries(totals)
    .map(([id, value]) => ({ id, label: catById[id].name, value }))
    .sort((a, b) => b.value - a.value);
}

export function topMerchantsForMonth(txns, categories, key, limit = 10) {
  const catById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const inMonth = txns.filter((t) => monthKey(t.date) === key);
  const totals = {};
  for (const t of inMonth) {
    const cat = catById[t.categoryId];
    if (!cat || cat.group === 'transfer' || cat.group === 'income') continue;
    if (t.amount >= 0) continue;
    const key2 = t.description || '(no description)';
    if (!totals[key2]) totals[key2] = { description: key2, category: cat.name, total: 0, count: 0 };
    totals[key2].total += -t.amount;
    totals[key2].count += 1;
  }
  return Object.values(totals).sort((a, b) => b.total - a.total).slice(0, limit);
}
