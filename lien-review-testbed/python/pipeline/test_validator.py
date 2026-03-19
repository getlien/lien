"""Tests for the pipeline validator module."""

import pytest

from pipeline.models import Record
from pipeline.validator import (
    check_required_fields,
    validate_batch,
    validate_record,
    validate_timestamp,
)


class TestValidateRecord:
    """Tests for validate_record."""

    def test_valid_record(self):
        record = Record(
            id="rec_001",
            source="test",
            timestamp="2025-01-01T00:00:00Z",
            data={"key": "value"},
            status="raw",
        )
        result = validate_record(record)
        assert result.success is True
        assert len(result.errors) == 0

    def test_missing_id(self):
        record = Record(
            id="",
            source="test",
            timestamp="2025-01-01T00:00:00Z",
            data={},
            status="raw",
        )
        result = validate_record(record)
        assert result.success is False

    def test_invalid_timestamp(self):
        record = Record(
            id="rec_002",
            source="test",
            timestamp="not-a-date",
            data={},
            status="raw",
        )
        result = validate_record(record)
        assert result.success is False
        assert any("timestamp" in e.lower() for e in result.errors)


class TestValidateTimestamp:
    """Tests for validate_timestamp."""

    def test_iso_format(self):
        assert validate_timestamp("2025-01-01T00:00:00Z") is True

    def test_date_only(self):
        assert validate_timestamp("2025-01-01") is True

    def test_invalid_format(self):
        assert validate_timestamp("Jan 1, 2025") is False

    def test_empty_string(self):
        assert validate_timestamp("") is False


class TestCheckRequiredFields:
    """Tests for check_required_fields."""

    def test_all_present(self):
        data = {"name": "Alice", "email": "alice@example.com"}
        missing = check_required_fields(data, ["name", "email"])
        assert missing == []

    def test_missing_field(self):
        data = {"name": "Alice"}
        missing = check_required_fields(data, ["name", "email"])
        assert "email" in missing

    def test_none_value(self):
        data = {"name": None}
        missing = check_required_fields(data, ["name"])
        assert "name" in missing


class TestValidateBatch:
    """Tests for validate_batch."""

    def test_batch_with_duplicates(self):
        records = [
            Record(id="rec_001", source="test", timestamp="2025-01-01T00:00:00Z", data={}, status="raw"),
            Record(id="rec_001", source="test", timestamp="2025-01-02T00:00:00Z", data={}, status="raw"),
        ]
        results = validate_batch(records)
        assert len(results) == 2
        # Second record should be flagged as duplicate
        assert results[1].success is False
