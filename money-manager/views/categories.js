import { loadCategories, saveCategories, resetCategories, GROUPS } from '../categories.js';
import { loadTransactions, saveTransactions } from '../categorize.js';

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `cat-${Date.now()}`;
}

export function render(root) {
  let categories = loadCategories();

  const container = document.createElement('div');
  container.innerHTML = `
    <h1>Categories</h1>
    <p class="subtitle">Spending buckets, grouped into Fixed Costs and Guilt-Free Spending. Edit keywords to improve auto-categorization.</p>
    <div class="form-row">
      <button class="primary" id="add-category">+ Add category</button>
      <button class="secondary" id="reset-categories">Reset to defaults</button>
    </div>
    <div id="groups"></div>
  `;
  root.innerHTML = '';
  root.appendChild(container);

  function persist() {
    saveCategories(categories);
  }

  function renderGroups() {
    const groupsEl = container.querySelector('#groups');
    groupsEl.innerHTML = Object.values(GROUPS).map((g) => `
      <div class="card">
        <h2 style="margin-top:0">${g.label}</h2>
        <div id="group-${g.id}"></div>
      </div>
    `).join('');

    Object.values(GROUPS).forEach((g) => {
      const listEl = groupsEl.querySelector(`#group-${g.id}`);
      const catsInGroup = categories.filter((c) => c.group === g.id);
      if (!catsInGroup.length) {
        listEl.innerHTML = '<p class="chart-empty">No categories in this group.</p>';
        return;
      }
      listEl.innerHTML = catsInGroup.map((c) => `
        <div class="category-row" data-id="${c.id}">
          <strong style="min-width:150px">${c.name}</strong>
          <select class="move-group" data-id="${c.id}">
            ${Object.values(GROUPS).map((g2) => `<option value="${g2.id}" ${g2.id === c.group ? 'selected' : ''}>${g2.label}</option>`).join('')}
          </select>
          <div class="keywords" data-id="${c.id}" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
            ${c.keywords.map((kw, i) => `<span class="keyword-tag">${kw}<button data-id="${c.id}" data-kw-index="${i}" title="Remove">×</button></span>`).join('')}
            <input type="text" class="add-kw" data-id="${c.id}" placeholder="+ keyword" style="width:100px;font-size:0.78rem;padding:3px 8px">
          </div>
          ${['other', 'income', 'transfer'].includes(c.id) ? '' : `<button class="secondary danger" data-id="${c.id}" data-action="delete">Delete</button>`}
        </div>
      `).join('');
    });

    groupsEl.querySelectorAll('.move-group').forEach((sel) => {
      sel.addEventListener('change', (e) => {
        const cat = categories.find((c) => c.id === e.target.dataset.id);
        cat.group = e.target.value;
        persist();
        renderGroups();
      });
    });

    groupsEl.querySelectorAll('.keyword-tag button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const cat = categories.find((c) => c.id === e.target.dataset.id);
        cat.keywords.splice(Number(e.target.dataset.kwIndex), 1);
        persist();
        renderGroups();
      });
    });

    groupsEl.querySelectorAll('.add-kw').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const val = e.target.value.trim().toLowerCase();
        if (!val) return;
        const cat = categories.find((c) => c.id === e.target.dataset.id);
        if (!cat.keywords.includes(val)) cat.keywords.push(val);
        persist();
        renderGroups();
      });
    });

    groupsEl.querySelectorAll('[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.target.dataset.id;
        const cat = categories.find((c) => c.id === id);
        const txns = loadTransactions();
        const affected = txns.filter((t) => t.categoryId === id);
        if (!confirm(`Delete "${cat.name}"? ${affected.length ? `${affected.length} transaction(s) will move to "Other".` : ''}`)) return;
        if (affected.length) {
          const moved = txns.map((t) => (t.categoryId === id ? { ...t, categoryId: 'other' } : t));
          saveTransactions(moved);
        }
        categories = categories.filter((c) => c.id !== id);
        persist();
        renderGroups();
      });
    });
  }

  container.querySelector('#add-category').addEventListener('click', () => {
    const name = prompt('Category name:');
    if (!name || !name.trim()) return;
    let id = slugify(name);
    while (categories.some((c) => c.id === id)) id += '-2';
    categories.push({ id, name: name.trim(), group: 'guiltfree', keywords: [] });
    persist();
    renderGroups();
  });

  container.querySelector('#reset-categories').addEventListener('click', () => {
    if (!confirm('Reset all categories to the defaults? Custom categories and keyword edits will be lost.')) return;
    categories = resetCategories();
    renderGroups();
  });

  renderGroups();
}
