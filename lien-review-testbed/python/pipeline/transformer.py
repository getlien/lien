"""Data transformation functions for cleaning, normalizing, and enriching records."""

from __future__ import annotations

from pipeline.models import Record


def strip_html(text: str) -> str:
    """Remove HTML tags from a string.

    Strips all HTML tags including self-closing tags, attributes, and
    nested elements. Preserves the text content between tags. Also
    decodes common HTML entities like &amp;, &lt;, &gt;, and &quot;.

    Returns the cleaned plain text string.
    """
    import re

    if not text:
        return text

    # Remove script and style elements entirely
    cleaned = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # Remove HTML tags
    cleaned = re.sub(r'<[^>]+>', '', cleaned)

    # Decode HTML entities
    cleaned = cleaned.replace('&amp;', '&')
    cleaned = cleaned.replace('&lt;', '<')
    cleaned = cleaned.replace('&gt;', '>')
    cleaned = cleaned.replace('&quot;', '"')
    cleaned = cleaned.replace('&#39;', "'")
    cleaned = cleaned.replace('&nbsp;', ' ')

    # Collapse whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


def transform_record(record: Record) -> Record:
    """Apply the full transformation pipeline to a single record.

    Normalizes all dictionary keys to lowercase, strips leading/trailing
    whitespace from string values, removes keys whose values are None,
    and marks the record status as 'transformed'.

    Returns a new Record instance — the original is not mutated.
    """
    transformed = record.copy()
    data = normalize_keys(transformed.data)

    cleaned: dict = {}
    for key, value in data.items():
        if value is None:
            continue
        if isinstance(value, str):
            stripped = strip_html(value.strip())
            if stripped:
                cleaned[key] = stripped
            else:
                cleaned[key] = stripped
        elif isinstance(value, dict):
            cleaned[key] = normalize_keys(value)
        elif isinstance(value, list):
            cleaned[key] = [
                item.strip() if isinstance(item, str) else item for item in value
            ]
        else:
            cleaned[key] = value

    transformed.data = cleaned
    transformed.status = "transformed"
    return transformed


def normalize_keys(data: dict) -> dict:
    """Recursively lowercase all dictionary keys.

    Nested dictionaries have their keys lowercased as well. Non-dict
    values are left untouched. Keys that are not strings are converted
    to their string representation and lowercased. Duplicate keys after
    normalization are resolved by keeping the last value encountered.

    This is used by transform_record, enrich_record, the loader,
    and the processor to ensure consistent key casing.
    """
    if not isinstance(data, dict):
        return data

    normalized: dict = {}

    for key, value in data.items():
        if isinstance(key, str):
            lower_key = key.lower().strip()
        else:
            lower_key = str(key).lower().strip()

        if isinstance(value, dict):
            normalized[lower_key] = normalize_keys(value)
        elif isinstance(value, list):
            normalized[lower_key] = [
                normalize_keys(item) if isinstance(item, dict) else item
                for item in value
            ]
        else:
            normalized[lower_key] = value

    return normalized


def sort_records(records: list[Record]) -> list[Record]:
    """Sort records by timestamp in ascending order.

    Uses lexicographic comparison on ISO-8601 timestamp strings, which
    produces chronological ordering for consistently formatted dates.
    Records with identical timestamps retain their original relative
    order (stable sort). Empty or missing timestamps are placed at the
    end of the sorted output.
    """
    if not records:
        return []

    has_timestamp: list[Record] = []
    missing_timestamp: list[Record] = []

    for record in records:
        if record.timestamp and record.timestamp.strip():
            has_timestamp.append(record)
        else:
            missing_timestamp.append(record)

    sorted_with_ts = sorted(has_timestamp, key=lambda r: r.timestamp)

    return sorted_with_ts + missing_timestamp


def merge_records(records: list[Record]) -> Record:
    """Merge a list of records into a single consolidated record.

    The merged record takes the id and source from the first record in
    the list. Data dictionaries are merged in order, so later records
    overwrite earlier ones for duplicate keys. The timestamp is taken
    from the latest record (last after sorting ascending).

    Raises ValueError if the input list is empty.
    """
    if not records:
        raise ValueError("Cannot merge an empty list of records")

    sorted_recs = sort_records(records)

    merged_data: dict = {}
    sources: list[str] = []

    for rec in sorted_recs:
        normalized = normalize_keys(rec.data)
        merged_data.update(normalized)
        if rec.source not in sources:
            sources.append(rec.source)

    return Record(
        id=sorted_recs[0].id,
        source=",".join(sources),
        timestamp=sorted_recs[-1].timestamp,
        data=merged_data,
        status="merged",
    )


def enrich_record(record: Record, metadata: dict) -> Record:
    """Add metadata fields to a record's data payload.

    Metadata keys are normalized to lowercase before merging. Existing
    keys in the record data are preserved -- metadata only fills in keys
    that are not already present. Nested dict metadata values are merged
    recursively rather than overwritten wholesale.

    The record status is set to 'enriched'. Returns a new Record
    instance; the original is not mutated.
    """
    enriched = record.copy()
    normalized_meta = normalize_keys(metadata)

    for key, value in normalized_meta.items():
        if key not in enriched.data:
            enriched.data[key] = value
        elif isinstance(enriched.data[key], dict) and isinstance(value, dict):
            for sub_key, sub_value in value.items():
                if sub_key not in enriched.data[key]:
                    enriched.data[key][sub_key] = sub_value

    enriched.status = "enriched"
    return enriched
