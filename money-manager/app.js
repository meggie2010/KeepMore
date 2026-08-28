import { render as renderDashboard } from './views/dashboard.js';
import { render as renderImport } from './views/import.js';
import { render as renderTransactions } from './views/transactions.js';
import { render as renderCategories } from './views/categories.js';

const views = {
  dashboard: renderDashboard,
  import: renderImport,
  transactions: renderTransactions,
  categories: renderCategories,
};

const root = document.getElementById('view-root');
const tabs = document.getElementById('tabs');

function setActiveTab(view) {
  tabs.querySelectorAll('.tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
}

function navigate(view) {
  if (!views[view]) view = 'dashboard';
  window.location.hash = view;
  setActiveTab(view);
  views[view](root);
}

tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  navigate(btn.dataset.view);
});

window.addEventListener('hashchange', () => {
  navigate(window.location.hash.slice(1));
});

navigate(window.location.hash.slice(1) || 'dashboard');
