# Spending Agent (Python)

A local, file-based personal spending pipeline — the Python counterpart to
`money-manager/`. Built as three independent stages:

1. **Ingest** (`spending_agent/ingest.py`) — raw bank/credit CSV exports → one normalized `transactions.csv` ✅ done
2. **Categorize** — normalized transactions → categorized, using an editable rules file — *coming next*
3. **Report** — categorized transactions → a monthly dashboard/report — *coming after that*

Each stage reads and writes plain CSV files in `data/`, so you can always
open the output in Excel/Numbers to sanity-check it, and each stage can be
run and debugged on its own.

## Setup

```bash
cd spending-agent
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp accounts.example.yaml accounts.yaml
```

Edit `accounts.yaml` to match your bank's and credit card's real CSV export
columns (see comments in the file). `accounts.yaml` is gitignored — it's
personal to your accounts.

## Try it with the sample data first

```bash
python -m spending_agent.ingest --input-dir sample_data/raw --config accounts.example.yaml --output data/transactions.csv
```

This reads the sample checking/credit CSVs in `sample_data/raw/`, normalizes
them, and writes `data/transactions.csv`. Open that file — every row has:

| column | meaning |
|---|---|
| `id` | stable hash used to dedupe re-imports |
| `date` | `YYYY-MM-DD` |
| `description` | merchant/description text |
| `amount` | **negative = money spent, positive = money in** |
| `account` | the account key from `accounts.yaml` |
| `account_type` | `checking` or `credit` |
| `source_file` | which export file the row came from |

## Using it with your real data

1. Drop your bank/credit card CSV exports into `data/raw/`.
2. Run:
   ```bash
   python -m spending_agent.ingest
   ```
   (defaults to `--input-dir data/raw --config accounts.yaml --output data/transactions.csv`)
3. Re-running is safe — transactions already in `data/transactions.csv` are
   skipped, so you can re-export overlapping date ranges without creating
   duplicates.

`data/` is gitignored — your transaction history never gets committed.
