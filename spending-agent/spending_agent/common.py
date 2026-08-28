"""Shared schema and helpers used across the ingest, categorize, and report stages."""

import hashlib
import re

# Canonical column order for the normalized transaction store. Every stage
# reads and writes CSVs with (at least) these columns.
TRANSACTION_COLUMNS = [
    "id",
    "date",
    "description",
    "amount",
    "account",
    "account_type",
    "source_file",
    "source_category",
]

_NON_ALNUM = re.compile(r"[^a-z0-9 ]")
_WHITESPACE = re.compile(r"\s+")


def normalize_description(description: str) -> str:
    """Lowercases and strips punctuation so the same merchant hashes/matches
    consistently regardless of formatting differences between statements."""
    text = (description or "").lower()
    text = _NON_ALNUM.sub(" ", text)
    text = _WHITESPACE.sub(" ", text).strip()
    return text


def make_transaction_id(account: str, date: str, description: str, amount: float, occurrence: int = 0) -> str:
    """Deterministic id used to dedupe transactions across repeated imports.

    `occurrence` disambiguates genuinely repeated same-day transactions (e.g.
    two identical $625 recurring buys on the same date) from a re-imported
    duplicate of the same file: it's the 0-based rank of this row among all
    rows sharing the same (date, description, amount) within one ingest
    batch, in file order. Re-running the same file(s) reproduces the same
    ranks, so true re-imports still dedupe; genuine repeats don't collide.
    """
    key = f"{account}|{date}|{normalize_description(description)}|{amount:.2f}|{occurrence}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
