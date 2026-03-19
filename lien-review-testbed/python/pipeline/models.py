"""Core data models used throughout the pipeline."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Record:
    """Represents a single data record flowing through the pipeline.

    Each record has a unique identifier, a source label indicating where it
    originated, an ISO-8601 timestamp, an arbitrary data payload, and a status
    that tracks its progression through the pipeline stages.
    """

    id: str
    source: str
    timestamp: str
    data: dict
    status: str = "pending"

    def copy(self) -> Record:
        """Return a copy of this record with a deep-copied data payload.

        Nested dictionaries within the data payload are recursively
        copied to prevent mutations on the copy from affecting the
        original. Lists within the data are shallow-copied. All scalar
        fields (id, source, timestamp, status) are copied by value.
        """
        copied_data: dict = {}
        for key, value in self.data.items():
            if isinstance(value, dict):
                copied_data[key] = dict(value)
            elif isinstance(value, list):
                copied_data[key] = list(value)
            else:
                copied_data[key] = value

        return Record(
            id=self.id,
            source=self.source,
            timestamp=self.timestamp,
            data=copied_data,
            status=self.status,
        )


@dataclass
class ProcessingResult:
    """Captures the outcome of processing a single record.

    Holds whether the processing succeeded, any error messages collected
    during validation or transformation, and the optional output payload.
    """

    record_id: str
    success: bool
    errors: list[str] = field(default_factory=list)
    output: dict | None = None


@dataclass
class PipelineStats:
    """Aggregate statistics for a completed pipeline run.

    Tracks totals for processed, failed, and skipped records alongside
    the wall-clock duration of the run in milliseconds.
    """

    total: int
    processed: int
    failed: int
    skipped: int
    duration_ms: float
