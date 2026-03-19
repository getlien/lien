"""Data pipeline package for processing, transforming, and reporting on records."""

from pipeline.cli import display_stats, run_ingest, run_multi_source, run_pipeline, run_preview, run_with_cache
from pipeline.loader import load_data
from pipeline.models import PipelineStats, ProcessingResult, Record
from pipeline.processor import (
    get_top_records,
    ingest_and_merge,
    process_and_report,
    process_batch,
    process_pipeline,
    process_single,
)
from pipeline.reporter import export_results, generate_report, run_scheduled_report, summarize_errors
from pipeline.transformer import transform_record

__all__ = [
    "Record",
    "ProcessingResult",
    "PipelineStats",
    "process_pipeline",
    "process_single",
    "process_batch",
    "process_and_report",
    "ingest_and_merge",
    "transform_record",
    "generate_report",
    "summarize_errors",
    "export_results",
    "display_stats",
    "run_pipeline",
    "run_with_cache",
    "run_multi_source",
    "run_preview",
    "run_ingest",
    "get_top_records",
    "run_scheduled_report",
    "load_data",
]
