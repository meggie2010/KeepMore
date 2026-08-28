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


def make_transaction_id(account: str, date: str, description: str, amount: float) -> str:
    """Deterministic id used to dedupe transactions across repeated imports."""
    key = f"{account}|{date}|{normalize_description(description)}|{amount:.2f}"
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:16]
