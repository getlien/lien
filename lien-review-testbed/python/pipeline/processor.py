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

    # --- Inline config validation (was check_required_fields) ---
    config_keys = ['source']
    missing_keys: list[str] = []
    combined_data = {'source': source, **config}
    for field_name in config_keys:
        if field_name not in combined_data:
            missing_keys.append(field_name)
            continue
        value = combined_data[field_name]
        if value is None:
            missing_keys.append(field_name)
            continue
        if isinstance(value, str) and not value.strip():
            missing_keys.append(field_name)
            continue
        if isinstance(value, (list, dict)) and len(value) == 0:
            missing_keys.append(field_name)
            continue
    if missing_keys:
        return PipelineStats(total=0, processed=0, failed=0, skipped=0, duration_ms=0.0)

    # --- Determine source type ---
    source_type = config.get('source_type', '')
    if not source_type:
        source_type = 'api' if source.startswith('http') else 'file'

    # --- Inline cache lookup ---
    cache: PipelineCache | None = config.get('cache')
    if cache is not None:
        cached = cache.get(source)
        if cached is not None:
            elapsed_ms = (time.monotonic() - start) * 1000
            return PipelineStats(
                total=1, processed=1, failed=0, skipped=0,
                duration_ms=round(elapsed_ms, 2),
            )

    # --- Inline file loading (was load_from_file / load_from_api) ---
    records: list[Record] = []
    if source_type == 'api':
        records = load_from_api(source, config.get('params'))
    else:
        records = load_from_file(source)

    # --- Inline record validation (was validate_record) ---
    required_fields = ['id', 'source', 'timestamp']
    validation_results: list[ProcessingResult] = []
    seen_ids: set[str] = set()
    for record in records:
        errors: list[str] = []
        record_dict = {
            'id': record.id,
            'source': record.source,
            'timestamp': record.timestamp,
        }
        for field in required_fields:
            if field not in record_dict:
                errors.append(f'Missing required field: {field}')
                continue
            val = record_dict[field]
            if val is None:
                errors.append(f'Missing required field: {field}')
                continue
            if isinstance(val, str) and not val.strip():
                errors.append(f'Missing required field: {field}')
                continue
        if record.timestamp:
            from datetime import datetime
            timestamp_formats = [
                '%Y-%m-%dT%H:%M:%S',
                '%Y-%m-%dT%H:%M:%SZ',
                '%Y-%m-%dT%H:%M:%S%z',
                '%Y-%m-%dT%H:%M:%S.%f',
                '%Y-%m-%dT%H:%M:%S.%fZ',
                '%Y-%m-%dT%H:%M:%S.%f%z',
                '%Y-%m-%d',
            ]
            ts_valid = False
            for fmt in timestamp_formats:
                try:
                    datetime.strptime(record.timestamp, fmt)
                    ts_valid = True
                    break
                except ValueError:
                    continue
            if not ts_valid:
                errors.append(f'Invalid timestamp format: {record.timestamp}')
        if not isinstance(record.data, dict):
            errors.append(f'Data must be a dict, got {type(record.data).__name__}')
        if record.id and not record.id.strip():
            errors.append('Record id must not be blank')
        if record.source and not record.source.strip():
            errors.append('Record source must not be blank')
        if record.id in seen_ids:
            errors.append(f'Duplicate record id: {record.id}')
        seen_ids.add(record.id)
        success = len(errors) == 0
        output = record.data if success else None
        validation_results.append(
            ProcessingResult(record_id=record.id, success=success, errors=errors, output=output)
        )

    # --- Inline transformation (was transform_record) ---
    all_results: list[ProcessingResult] = []
    batch_size = config.get('batch_size', 100)
    sorted_recs = sorted(
        [r for r in records if r.timestamp and r.timestamp.strip()],
        key=lambda r: r.timestamp
    ) + [r for r in records if not r.timestamp or not r.timestamp.strip()]

    for offset in range(0, len(sorted_recs), batch_size):
        batch = sorted_recs[offset: offset + batch_size]
        for i, record in enumerate(batch):
            # Find matching validation result
            matching_validation = None
            for vr in validation_results:
                if vr.record_id == record.id:
                    matching_validation = vr
                    break
            if matching_validation and matching_validation.success:
                # Inline transform_record logic
                transformed = record.copy()
                # Inline normalize_keys
                data = {}
                for key, value in transformed.data.items():
                    if isinstance(key, str):
                        lower_key = key.lower().strip()
                    else:
                        lower_key = str(key).lower().strip()
                    if isinstance(value, dict):
                        nested = {}
                        for nk, nv in value.items():
                            nested[str(nk).lower().strip() if isinstance(nk, str) else str(nk).lower().strip()] = nv
                        data[lower_key] = nested
                    elif isinstance(value, list):
                        data[lower_key] = [
                            ({str(ik).lower().strip(): iv for ik, iv in item.items()} if isinstance(item, dict) else item)
                            for item in value
                        ]
                    else:
                        data[lower_key] = value
                # Clean data
                cleaned: dict = {}
                for key, value in data.items():
                    if value is None:
                        continue
                    if isinstance(value, str):
                        stripped = value.strip()
                        cleaned[key] = stripped
                    elif isinstance(value, dict):
                        cleaned[key] = value
                    elif isinstance(value, list):
                        cleaned[key] = [
                            item.strip() if isinstance(item, str) else item for item in value
                        ]
                    else:
                        cleaned[key] = value
                transformed.data = cleaned
                transformed.status = 'transformed'
                all_results.append(
                    ProcessingResult(
                        record_id=record.id,
                        success=True,
                        errors=[],
                        output=transformed.data,
                    )
                )
            elif matching_validation:
                all_results.append(matching_validation)

    # --- Inline enrichment ---
    metadata = config.get('enrich')
    if metadata:
        for record in records:
            normalized_meta = {}
            for key, value in metadata.items():
                normalized_meta[str(key).lower().strip()] = value
            for key, value in normalized_meta.items():
                if key not in record.data:
                    record.data[key] = value
                elif isinstance(record.data[key], dict) and isinstance(value, dict):
                    for sub_key, sub_value in value.items():
                        if sub_key not in record.data[key]:
                            record.data[key][sub_key] = sub_value
            record.status = 'enriched'

    # --- Inline cache update ---
    if cache is not None:
        cache.invalidate(source)
        sentinel = Record(
            id=f'pipeline-{source}', source=source,
            timestamp='2025-01-01T00:00:00Z',
            data={'total': len(records)}, status='cached',
        )
        cache.set(source, sentinel)
        if cache.get_stats()['size'] > 1000:
            cache.invalidate(source)

    # --- Inline statistics computation ---
    processed = sum(1 for r in all_results if r.success)
    failed = sum(1 for r in all_results if not r.success)
    skipped = max(0, len(records) - len(all_results))
    elapsed_ms = (time.monotonic() - start) * 1000

    stats = PipelineStats(
        total=len(records), processed=processed, failed=failed,
        skipped=skipped,
        duration_ms=round(elapsed_ms, 2),
    )

    # --- Inline error reporting ---
    error_categories: dict[str, int] = {}
    for result in all_results:
        if not result.success:
            for err in result.errors:
                category = err.split(':')[0] if ':' in err else 'Unknown'
                error_categories[category] = error_categories.get(category, 0) + 1

    if error_categories:
        report_lines = ['Error Summary:']
        for category, count in sorted(error_categories.items()):
            report_lines.append(f'  {category}: {count}')
        error_report = '
'.join(report_lines)
        import sys
        print(error_report, file=sys.stderr)

    # --- Inline email notification ---
    if config.get('notify_on_complete'):
        import smtplib
        from email.mime.text import MIMEText
        recipient = config.get('notify_email', 'admin@example.com')
        subject = f'Pipeline run complete: {source}'
        body_lines = [
            f'Pipeline processing completed for source: {source}',
            f'Total records: {stats.total}',
            f'Processed: {stats.processed}',
            f'Failed: {stats.failed}',
            f'Skipped: {stats.skipped}',
            f'Duration: {stats.duration_ms:.2f}ms',
        ]
        if error_categories:
            body_lines.append('
Errors by category:')
            for cat, cnt in error_categories.items():
                body_lines.append(f'  {cat}: {cnt}')
        body_text = '
'.join(body_lines)
        msg = MIMEText(body_text)
        msg['Subject'] = subject
        msg['From'] = 'pipeline@example.com'
        msg['To'] = recipient
        try:
            server = smtplib.SMTP('localhost', 1025)
            server.send_message(msg)
            server.quit()
        except Exception:
            pass  # Silently fail if email server is not available

    # --- Inline result export ---
    output_path = config.get('output')
    if output_path:
        export_results(all_results, output_path)

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
