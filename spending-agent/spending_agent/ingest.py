"""Stage 1: ingest raw bank/credit-card CSV exports and normalize them into
a single common transaction format.

Usage:
    python -m spending_agent.ingest
    python -m spending_agent.ingest --input-dir data/raw --config accounts.yaml --output data/transactions.csv

Each account is configured once in accounts.yaml (which CSV columns to read,
and the sign convention) so you don't have to re-map columns every month.
Re-running against the same files is safe: transactions are deduped by a
hash of (account, date, description, amount).
"""

import argparse
import warnings
from pathlib import Path

import pandas as pd
import yaml

from spending_agent.common import TRANSACTION_COLUMNS, make_transaction_id

REQUIRED_KEYS = {"type", "file_pattern", "date_column", "description_column"}


class IngestError(Exception):
    pass


def load_account_configs(config_path: Path) -> dict:
    if not config_path.exists():
        raise IngestError(
            f"Account config not found: {config_path}\n"
            f"Copy accounts.example.yaml to accounts.yaml and edit it for your accounts."
        )
    with open(config_path) as f:
        raw = yaml.safe_load(f) or {}
    accounts = raw.get("accounts") or {}
    if not accounts:
        raise IngestError(f"No accounts defined in {config_path}")

    for key, cfg in accounts.items():
        missing = REQUIRED_KEYS - cfg.keys()
        if missing:
            raise IngestError(f"Account '{key}' is missing required config key(s): {sorted(missing)}")
        has_amount = "amount_column" in cfg
        has_debit_credit = "debit_column" in cfg or "credit_column" in cfg
        if not has_amount and not has_debit_credit:
            raise IngestError(
                f"Account '{key}' needs either 'amount_column' (plus 'spent_is_positive') "
                f"or 'debit_column'/'credit_column'."
            )
        if cfg["type"] not in ("checking", "credit"):
            raise IngestError(f"Account '{key}' has invalid type '{cfg['type']}' (expected checking or credit)")
    return accounts


def parse_amount(raw) -> float:
    """Handles $, thousands commas, and parenthesized negatives like ($12.34)."""
    if raw is None:
        return float("nan")
    s = str(raw).strip().replace("$", "").replace(",", "")
    if s == "":
        return float("nan")
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        return float("nan")


def normalize_file(path: Path, account_key: str, cfg: dict) -> pd.DataFrame:
    # index_col=False: some bank exports (e.g. Chase) have a stray trailing
    # comma on every data row, one more field than the header has columns.
    # Without this, pandas silently treats the first column as an unnamed
    # row index and shifts every other column over by one.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", pd.errors.ParserWarning)
        df = pd.read_csv(path, dtype=str, keep_default_na=False, index_col=False)

    for col in (cfg["date_column"], cfg["description_column"]):
        if col not in df.columns:
            raise IngestError(f"{path.name}: expected column '{col}' not found. Columns present: {list(df.columns)}")

    dates = pd.to_datetime(df[cfg["date_column"]], errors="coerce")
    descriptions = df[cfg["description_column"]].str.strip()

    if "amount_column" in cfg:
        if cfg["amount_column"] not in df.columns:
            raise IngestError(f"{path.name}: amount_column '{cfg['amount_column']}' not found.")
        amounts = df[cfg["amount_column"]].map(parse_amount)
        if cfg.get("spent_is_positive", False):
            amounts = -amounts
    else:
        zeros = pd.Series(0.0, index=df.index)
        debit = df[cfg["debit_column"]].map(parse_amount).fillna(0).abs() if cfg.get("debit_column") else zeros
        credit = df[cfg["credit_column"]].map(parse_amount).fillna(0).abs() if cfg.get("credit_column") else zeros
        amounts = credit - debit

    out = pd.DataFrame(
        {
            "date": dates.dt.strftime("%Y-%m-%d"),
            "description": descriptions,
            "amount": amounts,
            "account": account_key,
            "account_type": cfg["type"],
            "source_file": path.name,
        }
    )

    before = len(out)
    out = out.dropna(subset=["date", "amount"])
    out = out[out["description"].str.strip() != ""]
    skipped = before - len(out)
    if skipped:
        print(f"  {path.name}: skipped {skipped} row(s) with missing/unparseable date, description, or amount")

    out["occurrence"] = out.groupby(["date", "description", "amount"]).cumcount()
    out["id"] = [
        make_transaction_id(r.account, r.date, r.description, r.amount, r.occurrence) for r in out.itertuples()
    ]
    return out[TRANSACTION_COLUMNS]


def ingest(input_dir: Path, config_path: Path, output_path: Path) -> pd.DataFrame:
    accounts = load_account_configs(config_path)

    frames = []
    for account_key, cfg in accounts.items():
        files = sorted(input_dir.glob(cfg["file_pattern"]))
        if not files:
            print(f"  {account_key}: no files matching '{cfg['file_pattern']}' in {input_dir}")
            continue
        for f in files:
            print(f"  {account_key}: reading {f.name}")
            frames.append(normalize_file(f, account_key, cfg))

    new_df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=TRANSACTION_COLUMNS)

    if output_path.exists():
        existing = pd.read_csv(output_path, dtype={"id": str})
    else:
        existing = pd.DataFrame(columns=TRANSACTION_COLUMNS)

    combined = pd.concat([existing, new_df], ignore_index=True)
    combined = combined.drop_duplicates(subset="id", keep="first")
    combined = combined.sort_values("date").reset_index(drop=True)

    new_count = len(combined) - len(existing)
    duplicate_count = len(new_df) - new_count

    output_path.parent.mkdir(parents=True, exist_ok=True)
    combined.to_csv(output_path, index=False)

    print(
        f"\nParsed {len(new_df)} row(s) from {len(frames)} file(s). "
        f"{new_count} new, {duplicate_count} duplicate(s) skipped."
    )
    print(f"Total transactions in {output_path}: {len(combined)}")
    return combined


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input-dir", type=Path, default=Path("data/raw"), help="Folder of raw bank/card CSV exports")
    parser.add_argument("--config", type=Path, default=Path("accounts.yaml"), help="Account config YAML")
    parser.add_argument("--output", type=Path, default=Path("data/transactions.csv"), help="Normalized output CSV")
    args = parser.parse_args()

    print(f"Ingesting from {args.input_dir} using {args.config}")
    try:
        ingest(args.input_dir, args.config, args.output)
    except IngestError as e:
        raise SystemExit(f"Error: {e}")


if __name__ == "__main__":
    main()
