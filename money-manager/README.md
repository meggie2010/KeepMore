# KeepMore — Personal Spending Agent

A private, local-only spending dashboard. Upload checking and credit card CSVs,
get transactions auto-categorized into spending buckets, and see a monthly
report with your Fixed Costs vs. Guilt-Free Spending split and your savings rate.

Everything runs client-side — CSV files are parsed in your browser and all
data is stored in `localStorage`. Nothing is ever uploaded to a server.

## Running it

```bash
cd money-manager
python3 -m http.server 8000
# then open http://localhost:8000
```

(Needs to be served over HTTP, not opened as a `file://` URL, because it uses
ES module `<script type="module">` imports.)

## How it works

- **Import** — upload a CSV, choose Checking or Credit Card, confirm the
  column mapping (date / description / amount, or debit + credit columns) and
  the sign convention, then import. Re-importing the same file is safe —
  duplicate transactions are skipped automatically.
- **Categories** — the starting spending buckets (Housing, Groceries, Dining,
  Auto & Transport, etc.), each assigned to **Fixed Costs** or **Guilt-Free
  Spending**. Add/rename/delete buckets, move them between groups, and edit
  the keyword lists used to auto-categorize transactions. There are also two
  special groups: **Income** (paychecks/deposits) and **Transfers** (credit
  card payments, account transfers — excluded from spending and income totals
  so they aren't double-counted).
- **Transactions** — every imported transaction, filterable by month/account/
  category/search. Recategorizing one transaction updates every past (and
  future) transaction from that same merchant, so the categorizer gets better
  over time.
- **Dashboard** — pick a month to see income, fixed costs, guilt-free
  spending, amount saved, and savings rate, plus a category breakdown, a
  6-month trend, and your top merchants.

## Files

```
money-manager/
├── index.html          # app shell, tab navigation
├── styles.css           # design tokens (light/dark) + layout
├── app.js                # router
├── csv.js                # CSV parsing + column-mapping heuristics
├── categories.js         # default buckets, persistence
├── categorize.js         # keyword rule engine + merchant memory
├── charts.js              # hand-rolled SVG charts (bar, split bar, trend, line)
├── utils.js               # month math, summary calculations
└── views/
    ├── import.js
    ├── transactions.js
    ├── categories.js
    └── dashboard.js
```
