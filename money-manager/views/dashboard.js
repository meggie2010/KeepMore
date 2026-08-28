import { loadTransactions } from '../categorize.js';
import { loadCategories } from '../categories.js';
import { horizontalBarChart, splitBar, stackedBarsOverTime, lineChart } from '../charts.js';
import {
  fmtMoney, listMonths, monthLabel, monthSummary, prevMonthKey,
  lastNMonths, categoryTotalsForMonth, topMerchantsForMonth,
} from '../utils.js';

function deltaHtml(current, previous, higherIsGood, isPercent = false) {
  if (previous == null || current == null) return '';
  const diff = current - previous;
  if (Math.abs(diff) < 0.01) return `<div class="delta">No change vs last month</div>`;
  const good = higherIsGood ? diff > 0 : diff < 0;
  const arrow = diff > 0 ? '▲' : '▼';
  const text = isPercent ? `${Math.abs(diff).toFixed(1)} pts` : fmtMoney(Math.abs(diff));
  return `<div class="delta ${good ? 'good' : 'bad'}">${arrow} ${text} vs last month</div>`;
}

function statTile(label, value, delta) {
  return `<div class="stat-tile"><div class="label">${label}</div><div class="value">${value}</div>${delta}</div>`;
}

export function render(root) {
  const categories = loadCategories();
  const txns = loadTransactions();
  const months = listMonths(txns);

  if (!months.length) {
    root.innerHTML = `
      <h1>Dashboard</h1>
      <p class="subtitle">No transactions yet.</p>
      <div class="card">Head to the <strong>Import</strong> tab to upload your first checking or credit card CSV.</div>
    `;
    return;
  }

  const container = document.createElement('div');
  container.innerHTML = `
    <h1>Dashboard</h1>
    <p class="subtitle">Your monthly spending report.</p>
    <div class="form-row">
      <label>Month
        <select id="dash-month"></select>
      </label>
    </div>
    <div class="kpi-row" id="dash-kpis"></div>
    <div class="card">
      <h2 style="margin-top:0">Fixed vs. Guilt-Free</h2>
      <div id="dash-split"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Spending by Category</h2>
      <div id="dash-categories"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Fixed vs. Guilt-Free — Last 6 Months</h2>
      <div id="dash-trend-bars"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Savings Rate — Last 6 Months</h2>
      <div id="dash-trend-rate"></div>
    </div>
    <div class="card">
      <h2 style="margin-top:0">Top Merchants</h2>
      <div id="dash-merchants"></div>
    </div>
  `;
  root.innerHTML = '';
  root.appendChild(container);

  const monthSelect = container.querySelector('#dash-month');
  months.slice().reverse().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = monthLabel(m);
    monthSelect.appendChild(opt);
  });
  monthSelect.value = months[months.length - 1];
  monthSelect.addEventListener('change', () => renderMonth(monthSelect.value));

  function renderMonth(key) {
    const summary = monthSummary(txns, categories, key);
    const prevKey = prevMonthKey(key);
    const hasPrev = months.includes(prevKey);
    const prevSummary = hasPrev ? monthSummary(txns, categories, prevKey) : null;

    container.querySelector('#dash-kpis').innerHTML = [
      statTile('Income', fmtMoney(summary.income), deltaHtml(summary.income, prevSummary?.income, true)),
      statTile('Fixed Costs', fmtMoney(summary.fixedSpend), deltaHtml(summary.fixedSpend, prevSummary?.fixedSpend, false)),
      statTile('Guilt-Free Spending', fmtMoney(summary.guiltfreeSpend), deltaHtml(summary.guiltfreeSpend, prevSummary?.guiltfreeSpend, false)),
      statTile('Amount Saved', fmtMoney(summary.savings), deltaHtml(summary.savings, prevSummary?.savings, true)),
      statTile('Savings Rate', summary.savingsRate == null ? '—' : `${summary.savingsRate.toFixed(1)}%`,
        deltaHtml(summary.savingsRate, prevSummary?.savingsRate, true, true)),
    ].join('');

    const splitEl = container.querySelector('#dash-split');
    splitEl.innerHTML = '';
    splitEl.appendChild(splitBar([
      { label: 'Fixed Costs', value: summary.fixedSpend, color: 'var(--series-1)' },
      { label: 'Guilt-Free Spending', value: summary.guiltfreeSpend, color: 'var(--series-2)' },
    ]));

    const catTotals = categoryTotalsForMonth(txns, categories, key);
    const catEl = container.querySelector('#dash-categories');
    catEl.innerHTML = '';
    catEl.appendChild(horizontalBarChart(catTotals));

    const last6 = lastNMonths(months, 6);
    const trendData = last6.map((m) => {
      const s = monthSummary(txns, categories, m);
      return { label: monthLabel(m), fixed: s.fixedSpend, guiltfree: s.guiltfreeSpend };
    });
    const barsEl = container.querySelector('#dash-trend-bars');
    barsEl.innerHTML = '';
    barsEl.appendChild(stackedBarsOverTime(trendData));

    const rateData = last6
      .map((m) => ({ label: monthLabel(m), value: monthSummary(txns, categories, m).savingsRate }))
      .filter((p) => p.value != null);
    const rateEl = container.querySelector('#dash-trend-rate');
    rateEl.innerHTML = '';
    rateEl.appendChild(lineChart(rateData));

    const merchants = topMerchantsForMonth(txns, categories, key);
    const merchantsEl = container.querySelector('#dash-merchants');
    if (!merchants.length) {
      merchantsEl.innerHTML = '<p class="chart-empty">No spending this month.</p>';
    } else {
      merchantsEl.innerHTML = `
        <table>
          <thead><tr><th>Merchant</th><th>Category</th><th class="num">Transactions</th><th class="num">Total</th></tr></thead>
          <tbody>
            ${merchants.map((m) => `
              <tr>
                <td>${m.description}</td>
                <td><span class="badge">${m.category}</span></td>
                <td class="num">${m.count}</td>
                <td class="num">${fmtMoney(m.total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  renderMonth(monthSelect.value);
}
