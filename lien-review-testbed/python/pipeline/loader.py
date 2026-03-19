"""Data loading functions for reading records from files and APIs."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from pipeline.models import Record
from pipeline.transformer import merge_records, normalize_keys
from pipeline.validator import check_required_fields, validate_record, validate_timestamp

LOADER_REQUIRED_FIELDS: list[str] = ["id", "source", "timestamp"]


def load_from_file(filepath: str) -> list[Record]:
    """Load records from a JSON file on disk.

    The file must contain either a JSON array of record objects or a
    single JSON object with a 'records' key holding the array. Each
    raw dict is validated for required fields before conversion.
    Records sharing the same id are merged into a single record.

    Raises FileNotFoundError if the path does not exist.
    Raises ValueError if the JSON structure is unexpected.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Data file not found: {filepath}")

    with open(filepath, "r", encoding="utf-8") as fh:
        content = json.load(fh)

    if isinstance(content, list):
        raw_data = content
    elif isinstance(content, dict) and "records" in content:
        raw_data = content["records"]
    else:
        raise ValueError(
            f"Unexpected JSON structure in {filepath}: "
            "expected a list or object with 'records' key"
        )

    records = parse_raw_data(raw_data)

    valid_records: list[Record] = []
    for record in records:
        result = validate_record(record)
        if result.success:
            valid_records.append(record)

    return _deduplicate_records(valid_records)


def load_from_api(url: str, params: dict | None = None) -> list[Record]:
    """Simulate loading records from a remote API endpoint.

    In a real implementation this would make an HTTP request. For the
    testbed it generates synthetic records based on the URL and params
    to allow deterministic testing without network dependencies.
    """
    record_count = 5
    if params and "limit" in params:
        record_count = int(params["limit"])

    raw_data: list[dict[str, Any]] = []
    for i in range(record_count):
        entry: dict[str, Any] = {
            "id": f"api-{i + 1}",
            "source": url,
            "timestamp": f"2025-01-{(i + 1):02d}T00:00:00Z",
            "data": {"fetched_from": url, "index": i},
        }
        if params:
            entry["data"]["query_params"] = params
        raw_data.append(entry)

    records = parse_raw_data(raw_data)

    valid_records: list[Record] = []
    for record in records:
        result = validate_record(record)
        if result.success:
            valid_records.append(record)

    return valid_records


def load_data(source: str) -> list[Record]:
    """Unified loader that delegates to file or API loading.

    Inspects the source string to determine the loading strategy:
    sources starting with 'http://' or 'https://' are treated as API
    endpoints; everything else is treated as a local file path.

    Returns an empty list if the source string is blank or if loading
    fails.
    """
    if not source or not source.strip():
        return []

    is_url = source.startswith("http://") or source.startswith("https://")

    try:
        if is_url:
            records = load_from_api(source, None)
        else:
            records = load_from_file(source)
    except (FileNotFoundError, ValueError):
        return []

    return records


def parse_raw_data(raw: list[dict]) -> list[Record]:
    """Convert a list of raw dictionaries into Record instances.

    Each dict must contain at least 'id', 'source', and 'timestamp'.
    Dicts missing required fields are skipped so that partial data loads
    can still proceed. Timestamps are validated before record creation,
    and data keys are normalized to lowercase for consistency.

    The 'data' key defaults to an empty dict if not provided, and
    'status' defaults to 'pending'.
    """
    records: list[Record] = []

    for entry in raw:
        missing = check_required_fields(entry, LOADER_REQUIRED_FIELDS)
        if missing:
            continue

        ts = str(entry["timestamp"])
        if not validate_timestamp(ts):
            continue

        raw_data = entry.get("data", {})
        cleaned_data = normalize_keys(raw_data) if isinstance(raw_data, dict) else {}

        record = Record(
            id=str(entry["id"]),
            source=str(entry["source"]),
            timestamp=ts,
            data=cleaned_data,
            status=entry.get("status", "pending"),
        )
        records.append(record)

    return records


def _deduplicate_records(records: list[Record]) -> list[Record]:
    """Merge records that share the same id into single records.

    Groups records by their id field and merges each group using
    merge_records. Returns a flat list with one record per unique id.
    """
    groups: dict[str, list[Record]] = {}
    for record in records:
        groups.setdefault(record.id, []).append(record)

    deduplicated: list[Record] = []
    for group in groups.values():
        if len(group) == 1:
            deduplicated.append(group[0])
        else:
            deduplicated.append(merge_records(group))

    return deduplicated
