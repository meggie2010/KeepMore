const TRANSACTIONS_KEY = 'kmm_transactions_v1';
const MERCHANT_MAP_KEY = 'kmm_merchant_map_v1';

export function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(TRANSACTIONS_KEY) || '[]');
  } catch (e) {
    return [];
  }
}

export function saveTransactions(txns) {
  localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txns));
}

export function loadMerchantMap() {
  try {
    return JSON.parse(localStorage.getItem(MERCHANT_MAP_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

export function saveMerchantMap(map) {
  localStorage.setItem(MERCHANT_MAP_KEY, JSON.stringify(map));
}

export function normalizeDescription(desc) {
  return (desc || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Simple, deterministic hash for dedup IDs (not cryptographic).
function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

export function transactionId(account, date, description, amount) {
  return hashString(`${account}|${date}|${normalizeDescription(description)}|${amount.toFixed(2)}`);
}

// Runs merchant-memory first (learned from manual corrections), then
// falls back to keyword rules in category order, then a sensible default.
export function categorize(description, amount, account, categories, merchantMap) {
  const norm = normalizeDescription(description);

  if (merchantMap[norm]) {
    const cat = categories.find((c) => c.id === merchantMap[norm]);
    if (cat) return cat.id;
  }

  for (const cat of categories) {
    if (cat.group === 'income' || !cat.keywords || !cat.keywords.length) continue;
    if (cat.keywords.some((kw) => kw && norm.includes(kw.toLowerCase()))) {
      return cat.id;
    }
  }

  // Income rules checked separately so they only apply to inflows.
  if (amount > 0) {
    const incomeCat = categories.find((c) => c.group === 'income');
    if (incomeCat) {
      if (incomeCat.keywords.some((kw) => kw && norm.includes(kw.toLowerCase()))) {
        return incomeCat.id;
      }
      if (account === 'checking') return incomeCat.id;
    }
  }

  const other = categories.find((c) => c.id === 'other') || categories.find((c) => c.group === 'guiltfree');
  return other ? other.id : categories[0]?.id;
}

// Learn from a manual override: remember this merchant description ->
// category, and optionally re-apply it to every other transaction with
// the same normalized description.
export function applyManualCategory(txns, merchantMap, txnId, categoryId, applyToAllSimilar) {
  const txn = txns.find((t) => t.id === txnId);
  if (!txn) return txns;
  const norm = normalizeDescription(txn.description);
  merchantMap[norm] = categoryId;
  saveMerchantMap(merchantMap);

  return txns.map((t) => {
    if (t.id === txnId) return { ...t, categoryId, isManual: true };
    if (applyToAllSimilar && normalizeDescription(t.description) === norm) {
      return { ...t, categoryId, isManual: true };
    }
    return t;
  });
}
