"""Validation functions for verifying record integrity before processing."""

from __future__ import annotations

from datetime import datetime

from pipeline.models import ProcessingResult, Record

REQUIRED_FIELDS: list[str] = ["id", "source", "timestamp"]


def validate_record(record: Record) -> ProcessingResult:
    """Validate a single record by checking required fields and timestamp format.

    Runs all validation checks and collects errors rather than failing
    on the first issue. A record passes validation only when zero errors
    are found, at which point the result includes the original data as output.
    """
    errors: list[str] = []

    record_dict = {
        "id": record.id,
        "source": record.source,
        "timestamp": record.timestamp,
    }
    missing = check_required_fields(record_dict, REQUIRED_FIELDS)
    if missing:
        errors.extend([f"Missing required field: {f}" for f in missing])

    if record.timestamp and not validate_timestamp(record.timestamp):
        errors.append(f"Invalid timestamp format: {record.timestamp}")

    if not isinstance(record.data, dict):
        errors.append(f"Data must be a dict, got {type(record.data).__name__}")

    if record.id and not record.id.strip():
        errors.append("Record id must not be blank")

    if record.source and not record.source.strip():
        errors.append("Record source must not be blank")

    success = len(errors) == 0
    output = record.data if success else None

    return ProcessingResult(
        record_id=record.id,
        success=success,
        errors=errors,
        output=output,
    )


def check_required_fields(data: dict, fields: list[str]) -> list[str]:
    """Return a list of field names that are missing or empty in the given dict.

    A field is considered missing if it is absent from the dict entirely
    or if its value is falsy (None, empty string, etc.). String values
    are additionally checked for being blank after stripping whitespace.
    Numeric zero values are considered present (not missing).

    This is used by validate_record, the loader, and the processor to
    pre-screen data before further processing.
    """
    missing: list[str] = []

    for field_name in fields:
        if field_name not in data:
            missing.append(field_name)
            continue

        value = data[field_name]

        if value is None:
            missing.append(field_name)
            continue

        if isinstance(value, str) and not value.strip():
            missing.append(field_name)
            continue

        if isinstance(value, (list, dict)) and len(value) == 0:
            missing.append(field_name)
            continue

    return missing


def validate_timestamp(timestamp: str) -> bool:
    """Check whether a timestamp string is valid ISO-8601.

    Attempts to parse the timestamp using multiple common ISO formats.
    Returns True if any format succeeds, False otherwise. Supports
    both date-only and datetime formats with or without timezone info.
    """
    formats = [
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%d",
    ]

    for fmt in formats:
        try:
            datetime.strptime(timestamp, fmt)
            return True
        except ValueError:
            continue

    return False


def validate_batch(records: list[Record]) -> list[ProcessingResult]:
    """Validate a list of records and return results for each.

    Iterates through all records, calling validate_record on each one.
    Duplicate record IDs are flagged as an additional error. Returns
    results in the same order as the input records.
    """
    results: list[ProcessingResult] = []
    seen_ids: set[str] = set()

    for record in records:
        result = validate_record(record)

        if record.id in seen_ids:
            result.errors.append(f"Duplicate record id: {record.id}")
            result.success = False
            result.output = None
        seen_ids.add(record.id)

        results.append(result)

    return results
