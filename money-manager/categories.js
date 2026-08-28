// Default spending buckets. Fully editable from the Categories tab —
// this is just the starting point until real buckets are configured.

export const GROUPS = {
  fixed: { id: 'fixed', label: 'Fixed Costs' },
  guiltfree: { id: 'guiltfree', label: 'Guilt-Free Spending' },
  income: { id: 'income', label: 'Income' },
  transfer: { id: 'transfer', label: 'Transfers (excluded)' },
};

export const DEFAULT_CATEGORIES = [
  // Fixed costs
  { id: 'housing', name: 'Housing', group: 'fixed', keywords: ['rent', 'mortgage', 'hoa', 'landlord', 'property mgmt'] },
  { id: 'utilities', name: 'Utilities', group: 'fixed', keywords: ['electric', 'pg&e', 'con edison', 'water bill', 'sewer', 'comcast', 'xfinity', 'spectrum', 'internet', 'verizon', 'at&t', 't-mobile', 'gas company', 'utility'] },
  { id: 'insurance', name: 'Insurance', group: 'fixed', keywords: ['insurance', 'geico', 'progressive', 'state farm', 'allstate', 'liberty mutual', 'usaa'] },
  { id: 'subscriptions', name: 'Subscriptions', group: 'fixed', keywords: ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'amazon prime', 'apple.com/bill', 'icloud', 'audible', 'youtube premium', 'hbo', 'peacock'] },
  { id: 'debt', name: 'Debt Payments', group: 'fixed', keywords: ['student loan', 'navient', 'sallie mae', 'loan pymt', 'loan payment', 'nelnet'] },
  { id: 'childcare', name: 'Childcare & Education', group: 'fixed', keywords: ['daycare', 'tuition', 'preschool', 'college'] },

  // Guilt-free spending
  { id: 'groceries', name: 'Groceries', group: 'guiltfree', keywords: ['grocery', 'safeway', 'kroger', 'trader joe', 'whole foods', 'aldi', 'publix', 'costco', 'sprouts', 'wegmans'] },
  { id: 'dining', name: 'Dining', group: 'guiltfree', keywords: ['restaurant', 'starbucks', 'doordash', 'uber eats', 'grubhub', 'chipotle', 'mcdonald', 'coffee', 'cafe', 'pizza', 'bar ', 'brewery'] },
  { id: 'shopping', name: 'Shopping', group: 'guiltfree', keywords: ['amazon', 'target', 'walmart', 'best buy', 'ebay', 'etsy', 'nike', 'nordstrom', 'macy'] },
  { id: 'auto', name: 'Auto & Transport', group: 'guiltfree', keywords: ['shell', 'chevron', 'exxon', 'gas station', 'auto repair', 'dmv', 'parking', 'uber', 'lyft', 'transit'] },
  { id: 'travel', name: 'Travel', group: 'guiltfree', keywords: ['airlines', 'airbnb', 'hotel', 'marriott', 'hilton', 'expedia', 'delta air', 'southwest', 'united air'] },
  { id: 'entertainment', name: 'Entertainment', group: 'guiltfree', keywords: ['movie', 'amc', 'ticketmaster', 'steam', 'concert', 'cinema', 'bowling'] },
  { id: 'health', name: 'Health & Fitness', group: 'guiltfree', keywords: ['gym', 'pharmacy', 'cvs', 'walgreens', 'fitness', 'planet fitness', 'peloton', 'doctor', 'dental'] },
  { id: 'personal', name: 'Personal Care', group: 'guiltfree', keywords: ['salon', 'spa', 'barber', 'nails'] },
  { id: 'other', name: 'Other', group: 'guiltfree', keywords: [] },

  // Special groups (excluded from the fixed/guilt-free split)
  { id: 'income', name: 'Income', group: 'income', keywords: ['payroll', 'direct dep', 'salary', 'paycheck'] },
  { id: 'transfer', name: 'Transfers & Payments', group: 'transfer', keywords: ['credit card payment', 'card payment', 'autopay', 'online payment thank you', 'transfer to', 'transfer from', 'atm withdrawal', 'zelle', 'venmo'] },
];

const CATEGORIES_KEY = 'kmm_categories_v1';

export function loadCategories() {
  const raw = localStorage.getItem(CATEGORIES_KEY);
  if (!raw) return structuredClone(DEFAULT_CATEGORIES);
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch (e) {
    // fall through to defaults
  }
  return structuredClone(DEFAULT_CATEGORIES);
}

export function saveCategories(categories) {
  localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
}

export function resetCategories() {
  const defaults = structuredClone(DEFAULT_CATEGORIES);
  saveCategories(defaults);
  return defaults;
}
