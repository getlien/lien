"""Reporting functions for generating human-readable pipeline output."""

from __future__ import annotations

import json
import os
from collections import defaultdict

from pipeline.models import PipelineStats, ProcessingResult


def generate_report(stats: PipelineStats, results: list[ProcessingResult]) -> str:
    """Generate a Markdown-formatted report from pipeline stats and results.

    The report includes a summary header with key metrics, a breakdown
    of successes vs failures, and — if any failures occurred — a grouped
    error summary produced by summarize_errors.

    Returns the complete report as a single string.
    """
    lines: list[str] = []
    lines.append("# Pipeline Report")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- **Total records:** {stats.total}")
    lines.append(f"- **Processed:** {stats.processed}")
    lines.append(f"- **Failed:** {stats.failed}")
    lines.append(f"- **Skipped:** {stats.skipped}")
    lines.append(f"- **Duration:** {stats.duration_ms:.1f}ms")
    lines.append("")

    if stats.total > 0:
        success_rate = (stats.processed / stats.total) * 100
        lines.append(f"**Success rate:** {success_rate:.1f}%")
        lines.append("")

    failed_results = [r for r in results if not r.success]
    if failed_results:
        lines.append("## Errors")
        lines.append("")

        error_summary = summarize_errors(results)
        for error_type, count in sorted(
            error_summary.items(), key=lambda x: x[1], reverse=True
        ):
            lines.append(f"- {error_type}: **{count}** occurrences")
        lines.append("")

        lines.append("### Failed Records")
        lines.append("")
        for result in failed_results:
            lines.append(f"- `{result.record_id}`: {'; '.join(result.errors)}")
        lines.append("")

    successful = [r for r in results if r.success]
    if successful:
        lines.append("## Processed Records")
        lines.append("")
        lines.append(f"{len(successful)} records processed successfully.")
        lines.append("")

    return "\n".join(lines)


def summarize_errors(results: list[ProcessingResult]) -> dict:
    """Group and count errors across all processing results.

    Extracts error messages from failed results and categorizes them by
    their prefix (the text before the first colon). If no colon is found
    the entire message is used as the category. Returns a dict mapping
    error category strings to occurrence counts.
    """
    error_counts: dict[str, int] = defaultdict(int)

    for result in results:
        if not result.success:
            for error_msg in result.errors:
                colon_pos = error_msg.find(":")
                if colon_pos > 0:
                    category = error_msg[:colon_pos].strip()
                else:
                    category = error_msg.strip()
                error_counts[category] += 1

    return dict(error_counts)


def export_results(results: list[ProcessingResult], filepath: str) -> None:
    """Write processing results to a JSON file.

    Serializes each ProcessingResult as a dictionary with keys
    'record_id', 'success', 'errors', and 'output'. Creates parent
    directories if they do not exist. An error summary is appended
    as a top-level 'error_summary' key alongside the results array.
    """
    output_dir = os.path.dirname(filepath)
    if output_dir and not os.path.exists(output_dir):
        os.makedirs(output_dir, exist_ok=True)

    serialized: list[dict] = []
    for result in results:
        serialized.append(
            {
                "record_id": result.record_id,
                "success": result.success,
                "errors": result.errors,
                "output": result.output,
            }
        )

    error_summary = summarize_errors(results)

    payload = {
        "results": serialized,
        "total": len(results),
        "successful": sum(1 for r in results if r.success),
        "failed": sum(1 for r in results if not r.success),
        "error_summary": error_summary,
    }

    with open(filepath, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)


def run_scheduled_report(sources: list[str], output_dir: str) -> list[str]:
    """Run automated reports for multiple sources and export to files.

    Orchestrates pipeline execution for each source using run_pipeline
    and run_with_cache for efficiency. Generates individual reports and
    exports results to the given output directory. For multi-source runs,
    delegates to run_multi_source. Uses display_stats for logging.

    Returns a list of output file paths that were written.

    Uses lazy imports to avoid circular dependencies with the cli module.
    """
    from pipeline.cache import PipelineCache
    from pipeline.cli import (
        display_stats,
        run_ingest,
        run_multi_source,
        run_pipeline,
        run_preview,
        run_with_cache,
    )

    cache = PipelineCache()
    output_files: list[str] = []

    for i, source in enumerate(sources):
        output_path = os.path.join(output_dir, f"report_{i}.json")

        run_preview(source)

        stats = run_with_cache(source, cache)
        print(display_stats(stats))

        args = {
            "source": source,
            "output": output_path,
            "batch_size": 100,
            "format": "markdown",
        }
        run_pipeline(args)
        output_files.append(output_path)

    if len(sources) > 1:
        combined_args = {
            "output": os.path.join(output_dir, "combined_report.json"),
            "batch_size": 100,
        }
        run_multi_source(sources, combined_args)
        output_files.append(combined_args["output"])

    sample_raw = [
        {
            "id": "scheduled-1",
            "source": "scheduler",
            "timestamp": "2025-01-01T00:00:00Z",
            "data": {"scheduled": True},
        }
    ]
    ingest_args = {"output": os.path.join(output_dir, "ingest_report.json")}
    run_ingest([sample_raw], ingest_args)
    output_files.append(ingest_args["output"])

    return output_files
