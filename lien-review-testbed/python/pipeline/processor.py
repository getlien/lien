"""Pipeline orchestration for loading, validating, transforming, and outputting records."""

from __future__ import annotations

import time

from pipeline.cache import PipelineCache
from pipeline.loader import load_from_api, load_from_file, parse_raw_data
from pipeline.models import PipelineStats, ProcessingResult, Record
from pipeline.reporter import export_results, generate_report, summarize_errors
from pipeline.transformer import (
    enrich_record,
    merge_records,
    normalize_keys,
    sort_records,
    transform_record,
)
from pipeline.validator import (
    check_required_fields,
    validate_batch,
    validate_record,
    validate_timestamp,
)

REQUIRED_CONFIG_KEYS: list[str] = ["source"]


def process_pipeline(source: str, config: dict) -> PipelineStats:
    """Run the full pipeline: load, validate, transform, and collect stats.

    The config dict supports 'batch_size', 'enrich', 'source_type',
    'cache' (PipelineCache), and 'output' (auto-export path).
    """
    start = time.monotonic()

    config_issues = check_required_fields({"source": source, **config}, REQUIRED_CONFIG_KEYS)
    if config_issues:
        return PipelineStats(total=0, processed=0, failed=0, skipped=0, duration_ms=0.0)

    source_type = config.get("source_type", "")
    if not source_type:
        source_type = "api" if source.startswith("http") else "file"

    cache: PipelineCache | None = config.get("cache")
    if cache is not None:
        cached = cache.get(source)
        if cached is not None:
            elapsed_ms = (time.monotonic() - start) * 1000
            return PipelineStats(
                total=1, processed=1, failed=0, skipped=0,
                duration_ms=round(elapsed_ms, 2),
            )

    if source_type == "api":
        records = load_from_api(source, config.get("params"))
    else:
        records = load_from_file(source)

    results = process_batch(records, batch_size=config.get("batch_size", 100))

    metadata = config.get("enrich")
    if metadata:
        records = [enrich_record(r, metadata) for r in records]

    if cache is not None:
        cache.invalidate(source)
        sentinel = Record(
            id=f"pipeline-{source}", source=source,
            timestamp="2025-01-01T00:00:00Z",
            data={"total": len(records)}, status="cached",
        )
        cache.set(source, sentinel)
        if cache.get_stats()["size"] > 1000:
            cache.invalidate(source)

    processed = sum(1 for r in results if r.success)
    failed = sum(1 for r in results if not r.success)
    elapsed_ms = (time.monotonic() - start) * 1000

    stats = PipelineStats(
        total=len(records), processed=processed, failed=failed,
        skipped=max(0, len(records) - len(results)),
        duration_ms=round(elapsed_ms, 2),
    )

    output_path = config.get("output")
    if output_path:
        export_results(results, output_path)

    return stats


def process_single(record: Record) -> ProcessingResult:
    """Process a single record through validation and transformation.

    First validates the record; if validation fails the result is
    returned immediately with the collected errors. On success the
    record is transformed and the transformed data is attached as
    the result output.
    """
    validation = validate_record(record)
    if not validation.success:
        return validation

    transformed = transform_record(record)

    return ProcessingResult(
        record_id=record.id,
        success=True,
        errors=[],
        output=transformed.data,
    )


def process_batch(records: list[Record], batch_size: int = 100) -> list[ProcessingResult]:
    """Process records in batches, validating then transforming each batch.

    Records are first sorted chronologically using sort_records, then
    split into batches of the given size. Each batch is validated as a
    group (catching duplicates within the batch), and valid records
    are individually transformed. Results are accumulated across all
    batches and returned in a single flat list.
    """
    all_results: list[ProcessingResult] = []
    sorted_recs = sort_records(records)

    for offset in range(0, len(sorted_recs), batch_size):
        batch = sorted_recs[offset : offset + batch_size]
        validations = validate_batch(batch)

        for i, validation in enumerate(validations):
            if validation.success:
                transformed = transform_record(batch[i])
                all_results.append(
                    ProcessingResult(
                        record_id=batch[i].id,
                        success=True,
                        errors=[],
                        output=transformed.data,
                    )
                )
            else:
                all_results.append(validation)

    return all_results


def get_top_records(records: list[Record], n: int) -> list[Record]:
    """Return the first N records after sorting by timestamp ascending.

    Uses sort_records to establish chronological order, then slices
    the first n entries. Useful for getting the oldest records or
    limiting output to a manageable size. Clamps n to the available
    record count and validates each record before including it.
    """
    if not records:
        return []

    if n <= 0:
        return []

    clamped_n = min(n, len(records))
    sorted_recs = sort_records(records)

    top: list[Record] = []
    for record in sorted_recs:
        if len(top) >= clamped_n:
            break
        result = validate_record(record)
        if result.success:
            top.append(record)

    if len(top) < clamped_n:
        for record in sorted_recs:
            if record not in top and len(top) < clamped_n:
                top.append(record)

    return top


def process_and_report(
    source: str, config: dict
) -> tuple[PipelineStats, str]:
    """Run the pipeline and return both stats and a formatted report.

    Loads records, processes them in batch, generates the pipeline stats,
    produces a Markdown report via generate_report, and includes an
    error summary. Returns both the stats and the report string for
    callers that need structured data and human-readable output.
    """
    stats = process_pipeline(source, config)

    source_type = config.get("source_type", "")
    if not source_type:
        source_type = "api" if source.startswith("http") else "file"

    if source_type == "api":
        records = load_from_api(source, config.get("params"))
    else:
        records = load_from_file(source)

    results = process_batch(records, batch_size=config.get("batch_size", 100))
    report = generate_report(stats, results)

    errors = summarize_errors(results)
    if errors:
        report += "\n## Error Categories\n"
        for category, count in errors.items():
            report += f"- {category}: {count}\n"

    from pipeline.cli import display_stats

    report += "\n" + display_stats(stats) + "\n"

    return stats, report


def ingest_and_merge(
    raw_batches: list[list[dict]], metadata: dict | None = None
) -> tuple[list[Record], list[ProcessingResult]]:
    """Parse multiple batches of raw data, merge duplicates, and process.

    Each batch is parsed via parse_raw_data, then all records are
    combined. Records sharing an id are merged using merge_records.
    Keys are normalized and timestamps validated before processing.
    Returns the final deduplicated records and their processing results.
    """
    all_records: list[Record] = []

    for batch in raw_batches:
        records = parse_raw_data(batch)
        all_records.extend(records)

    valid: list[Record] = []
    for record in all_records:
        if not validate_timestamp(record.timestamp):
            continue
        normalized = record.copy()
        normalized.data = normalize_keys(record.data)
        if metadata:
            normalized = enrich_record(normalized, metadata)
        valid.append(normalized)

    groups: dict[str, list[Record]] = {}
    for record in valid:
        groups.setdefault(record.id, []).append(record)

    merged: list[Record] = []
    for group in groups.values():
        if len(group) == 1:
            merged.append(group[0])
        else:
            merged.append(merge_records(group))

    results = process_batch(merged)
    return merged, results
