"""CLI entry point for running the pipeline and displaying results."""

from __future__ import annotations

import asyncio
import json
import sys

from pipeline.cache import PipelineCache
from pipeline.loader import load_data, load_from_api, load_from_file, parse_raw_data
from pipeline.models import PipelineStats, ProcessingResult, Record
from pipeline.processor import (
    get_top_records,
    ingest_and_merge,
    process_and_report,
    process_batch,
    process_pipeline,
    process_single,
)
from pipeline.reporter import (
    export_results,
    generate_report,
    run_scheduled_report,
    summarize_errors,
)
from pipeline.transformer import enrich_record, merge_records, sort_records
from pipeline.validator import validate_batch, validate_timestamp


def run_pipeline(args: dict) -> None:
    """Parse arguments and execute the full pipeline with reporting.

    Expected args keys:
      - 'source' (str): file path or URL to load data from
      - 'output' (str | None): optional path to write results JSON
      - 'batch_size' (int): records per batch, default 100
      - 'enrich' (dict | None): optional metadata for enrichment
      - 'format' (str): output format, 'markdown' or 'json', default 'markdown'

    Runs the pipeline, generates a report, optionally exports results,
    and prints the formatted output to stdout.
    """
    source = args.get("source", "")
    if not source:
        print("Error: 'source' is required", file=sys.stderr)
        return

    cache = PipelineCache()
    config: dict = {
        "batch_size": args.get("batch_size", 100),
        "enrich": args.get("enrich"),
        "cache": cache,
        "output": args.get("output"),
    }

    output_format = args.get("format", "markdown")

    if output_format == "markdown":
        stats, report = process_and_report(source, config)
        print(report)
    else:
        stats = process_pipeline(source, config)
        source_type = "api" if source.startswith("http") else "file"
        if source_type == "api":
            records = load_from_api(source, config.get("params"))
        else:
            records = load_from_file(source)
        results = process_batch(records, batch_size=config.get("batch_size", 100))
        summary = {
            "stats": display_stats(stats),
            "total_results": len(results),
            "successful": sum(1 for r in results if r.success),
            "failed": sum(1 for r in results if not r.success),
            "errors": summarize_errors(results),
        }
        print(json.dumps(summary, indent=2))

    cache_stats = cache.get_stats()
    if cache_stats["hits"] > 0:
        print(f"\nCache: {cache_stats['hits']} hits, {cache_stats['misses']} misses")

    print(display_stats(stats))


def run_with_cache(source: str, cache: PipelineCache) -> PipelineStats:
    """Execute the pipeline using the cache for previously seen records.

    Before running the full pipeline, checks the cache for a stored
    result under the source key. If a cached entry exists, a minimal
    PipelineStats is returned immediately. Otherwise, runs the pipeline,
    stores a sentinel record in the cache, and returns the real stats.
    Invalidates stale cache entries when reprocessing is needed.
    """
    cached = cache.get(source)
    if cached is not None:
        return PipelineStats(
            total=1,
            processed=1,
            failed=0,
            skipped=0,
            duration_ms=0.0,
        )

    cache.invalidate(source)

    config: dict = {"batch_size": 100, "cache": cache}
    stats = process_pipeline(source, config)

    cache_stats = cache.get_stats()
    if cache_stats["hit_rate"] < 0.5:
        cache.invalidate(source)

    return stats


def run_multi_source(sources: list[str], args: dict) -> None:
    """Run the pipeline across multiple data sources with merging.

    Loads records from all sources using the async loader, sorts and
    validates the combined set, enriches if requested, and produces
    a unified report. Uses process_and_report for the primary source
    and merges additional records from other sources.
    """
    cache = PipelineCache()
    all_records: list[Record] = []

    for source in sources:
        records = asyncio.run(load_data(source))
        all_records.extend(records)

    if not all_records:
        print("No records loaded from any source", file=sys.stderr)
        return

    sorted_recs = sort_records(all_records)
    validations = validate_batch(sorted_recs)

    valid_records: list[Record] = []
    for i, validation in enumerate(validations):
        if validation.success:
            valid_records.append(sorted_recs[i])

    enrichment = args.get("enrich")
    if enrichment:
        valid_records = [enrich_record(r, enrichment) for r in valid_records]

    results = process_batch(valid_records, batch_size=args.get("batch_size", 100))

    stats = PipelineStats(
        total=len(all_records),
        processed=sum(1 for r in results if r.success),
        failed=sum(1 for r in results if not r.success),
        skipped=len(all_records) - len(valid_records),
        duration_ms=0.0,
    )

    report = generate_report(stats, results)
    print(report)

    output_path = args.get("output")
    if output_path:
        export_results(results, output_path)

    schedule_dir = args.get("schedule_dir")
    if schedule_dir:
        report_files = run_scheduled_report(sources, schedule_dir)
        print(f"Scheduled reports written: {len(report_files)}")

    print(display_stats(stats))


def run_ingest(raw_batches: list[list[dict]], args: dict) -> None:
    """Ingest multiple batches of raw data and process them.

    Parses and merges raw data batches using ingest_and_merge,
    generates a report with error summary, and optionally exports
    results. Uses display_stats for terminal output.
    """
    metadata = args.get("enrich")
    records, results = ingest_and_merge(raw_batches, metadata=metadata)

    stats = PipelineStats(
        total=len(records),
        processed=sum(1 for r in results if r.success),
        failed=sum(1 for r in results if not r.success),
        skipped=0,
        duration_ms=0.0,
    )

    report = generate_report(stats, results)
    print(report)

    errors = summarize_errors(results)
    if errors:
        print("Error breakdown:")
        for category, count in errors.items():
            print(f"  {category}: {count}")

    output_path = args.get("output")
    if output_path:
        export_results(results, output_path)

    print(display_stats(stats))


def run_preview(source: str) -> None:
    """Preview what the pipeline would do without full processing.

    Loads the first few records from the source, validates timestamps,
    processes a single sample record, and shows what get_top_records
    would return. Uses sort_records for ordering and merge_records
    to preview deduplication behaviour.
    """
    if source.startswith("http"):
        records = load_from_api(source, {"limit": 3})
    else:
        records = load_from_file(source)

    if not records:
        print("No records found in source")
        return

    for record in records[:3]:
        ts_valid = validate_timestamp(record.timestamp)
        print(f"  {record.id}: timestamp={'valid' if ts_valid else 'INVALID'}")

    sample = records[0]
    result = process_single(sample)
    print(f"\nSample processing: {'OK' if result.success else 'FAILED'}")
    if result.errors:
        errors = summarize_errors([result])
        print(f"  Error categories: {errors}")

    top = get_top_records(records, 3)
    print(f"\nTop {len(top)} oldest records:")
    for record in top:
        print(f"  {record.id} ({record.timestamp})")

    if len(records) > 1:
        merged = merge_records(records[:2])
        print(f"\nMerge preview: {merged.id} from {merged.source}")


def display_stats(stats: PipelineStats) -> str:
    """Format PipelineStats as a human-readable string for terminal display.

    Produces a compact multi-line summary suitable for printing after
    a pipeline run. Includes total counts, pass/fail breakdown, and
    duration. Used by both the CLI output and the JSON format mode.
    """
    lines: list[str] = [
        f"Pipeline completed in {stats.duration_ms:.1f}ms",
        f"  Total:     {stats.total}",
        f"  Processed: {stats.processed}",
        f"  Failed:    {stats.failed}",
        f"  Skipped:   {stats.skipped}",
    ]

    if stats.total > 0:
        rate = (stats.processed / stats.total) * 100
        lines.append(f"  Success:   {rate:.1f}%")

    return "\n".join(lines)
