"""Stage 2: categorize normalized transactions using an editable rules file.

Usage:
    python -m spending_agent.categorize
    python -m spending_agent.categorize --input data/transactions.csv --rules rules.yaml --output data/categorized_transactions.csv

Matching order per transaction:
    1. First category in rules.yaml whose keyword appears in the description (case-insensitive).
    2. If nothing matches: the account's own raw category (source_category column,
       captured during ingest via accounts.yaml's category_column), mapped through
       rules.yaml's source_category_fallback.
    3. Otherwise: the `other` category.
"""

import argparse
from pathlib import Path

import pandas as pd
import yaml

from spending_agent.common import normalize_description

REQUIRED_CATEGORY_KEYS = {"id", "name", "group"}
VALID_GROUPS = {"fixed", "guiltfree", "income", "savings", "investments", "transfer"}


class CategorizeError(Exception):
    pass


def load_rules(rules_path: Path) -> dict:
    if not rules_path.exists():
        raise CategorizeError(f"Rules file not found: {rules_path}")
    with open(rules_path) as f:
        rules = yaml.safe_load(f) or {}

    categories = rules.get("categories") or []
    if not categories:
        raise CategorizeError(f"No categories defined in {rules_path}")

    seen_ids = set()
    for cat in categories:
        missing = REQUIRED_CATEGORY_KEYS - cat.keys()
        if missing:
            raise CategorizeError(f"Category {cat} is missing required key(s): {sorted(missing)}")
        if cat["group"] not in VALID_GROUPS:
            raise CategorizeError(f"Category '{cat['id']}' has invalid group '{cat['group']}' (expected one of {sorted(VALID_GROUPS)})")
        if cat["id"] in seen_ids:
            raise CategorizeError(f"Duplicate category id '{cat['id']}' in {rules_path}")
        seen_ids.add(cat["id"])
        cat.setdefault("keywords", [])

    if "other" not in seen_ids:
        raise CategorizeError(f"{rules_path} must define a category with id 'other' as the ultimate fallback.")

    rules["categories"] = categories
    rules.setdefault("source_category_fallback", {})
    return rules


def categorize_transaction(description: str, source_category: str, categories: list, fallback_map: dict) -> tuple:
    """Returns (category_id, matched_via) where matched_via is 'keyword', 'bank_category', or 'default'."""
    norm = normalize_description(description)
    for cat in categories:
        for kw in cat["keywords"]:
            if kw and normalize_description(kw) in norm:
                return cat["id"], "keyword"

    source_category = (source_category or "").strip()
    if source_category and source_category in fallback_map:
        return fallback_map[source_category], "bank_category"

    return "other", "default"


def categorize_all(transactions: pd.DataFrame, rules: dict) -> pd.DataFrame:
    categories = rules["categories"]
    fallback_map = rules["source_category_fallback"]
    cat_by_id = {c["id"]: c for c in categories}

    results = [
        categorize_transaction(row.description, getattr(row, "source_category", ""), categories, fallback_map)
        for row in transactions.itertuples()
    ]
    category_ids, matched_via = zip(*results) if results else ((), ())

    out = transactions.copy()
    out["category_id"] = category_ids
    out["category_name"] = [cat_by_id[c]["name"] for c in category_ids]
    out["category_group"] = [cat_by_id[c]["group"] for c in category_ids]
    out["matched_via"] = matched_via
    return out


def print_summary(categorized: pd.DataFrame, rules: dict) -> None:
    group_labels = rules.get("groups", {})
    print("\nBy group:")
    for group_id, total in categorized.groupby("category_group")["amount"].sum().items():
        label = group_labels.get(group_id, group_id)
        print(f"  {label}: {total:,.2f} ({(categorized['category_group'] == group_id).sum()} txns)")

    print("\nBy category:")
    by_cat = categorized.groupby("category_name")["amount"].agg(["sum", "count"]).sort_values("sum")
    for name, row in by_cat.iterrows():
        print(f"  {name}: {row['sum']:,.2f} ({int(row['count'])} txns)")

    via_counts = categorized["matched_via"].value_counts()
    print(f"\nMatched via keyword: {via_counts.get('keyword', 0)}")
    print(f"Matched via bank category fallback: {via_counts.get('bank_category', 0)}")
    print(f"Fell to default 'other': {via_counts.get('default', 0)}")

    uncategorized = categorized[categorized["category_id"] == "other"]
    if len(uncategorized):
        print("\nTop merchants still in 'Other' (add keywords for these to rules.yaml if they should be elsewhere):")
        top = uncategorized.groupby("description")["amount"].agg(["sum", "count"]).sort_values("sum").head(10)
        for desc, row in top.iterrows():
            print(f"  {desc}: {row['sum']:,.2f} ({int(row['count'])} txns)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", type=Path, default=Path("data/transactions.csv"), help="Normalized transactions CSV (from ingest)")
    parser.add_argument("--rules", type=Path, default=Path("rules.yaml"), help="Categorization rules YAML")
    parser.add_argument("--output", type=Path, default=Path("data/categorized_transactions.csv"), help="Categorized output CSV")
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Error: {args.input} not found. Run ingest first: python -m spending_agent.ingest")

    try:
        rules = load_rules(args.rules)
    except CategorizeError as e:
        raise SystemExit(f"Error: {e}")

    transactions = pd.read_csv(args.input, dtype={"id": str}, keep_default_na=False)
    categorized = categorize_all(transactions, rules)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    categorized.to_csv(args.output, index=False)
    print(f"Categorized {len(categorized)} transactions -> {args.output}")

    print_summary(categorized, rules)


if __name__ == "__main__":
    main()
