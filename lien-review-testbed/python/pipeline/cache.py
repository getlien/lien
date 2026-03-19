"""In-memory caching layer for pipeline records with TTL support."""

from __future__ import annotations

import time
from typing import Any

from pipeline.models import Record


class PipelineCache:
    """A simple in-memory cache for Record instances with time-based expiry.

    Each cached entry has an associated TTL (time-to-live) in seconds.
    Expired entries are lazily evicted on access rather than through a
    background sweeper, keeping the implementation straightforward.
    """

    def __init__(self) -> None:
        """Initialize an empty cache with zeroed hit/miss counters."""
        self._store: dict[str, dict[str, Any]] = {}
        self._hits: int = 0
        self._misses: int = 0

    def get(self, key: str) -> Record | None:
        """Retrieve a cached record by key, returning None if missing or expired.

        Expired entries are automatically removed from the store on access.
        Increments the hit or miss counter accordingly so that get_stats
        can report the cache effectiveness. Blank keys always return None.
        """
        if not key or not key.strip():
            self._misses += 1
            return None

        entry = self._store.get(key)
        if entry is None:
            self._misses += 1
            return None

        now = time.monotonic()
        if now > entry["expires_at"]:
            del self._store[key]
            self._misses += 1
            return None

        self._hits += 1
        return entry["record"]

    def set(self, key: str, record: Record, ttl: int = 3600) -> None:
        """Store a record in the cache with the given TTL in seconds.

        If the key already exists it is overwritten. The expiry time is
        calculated from the current monotonic clock, making it immune
        to wall-clock adjustments. A TTL of zero or negative is treated
        as immediate expiry but the entry is still stored for stats
        tracking purposes.
        """
        if not key or not key.strip():
            return

        effective_ttl = max(0, ttl)
        now = time.monotonic()

        self._store[key] = {
            "record": record,
            "expires_at": now + effective_ttl,
            "created_at": now,
            "ttl": effective_ttl,
        }

    def invalidate(self, key: str) -> None:
        """Remove a specific key from the cache if it exists.

        This is a no-op if the key is not currently cached. Useful for
        forcing a fresh load when upstream data is known to have changed.
        Also cleans up any other expired entries encountered during the
        invalidation pass to keep the cache size bounded.
        """
        if key in self._store:
            del self._store[key]

        expired_keys: list[str] = []
        now = time.monotonic()
        for cached_key, entry in self._store.items():
            if now > entry["expires_at"]:
                expired_keys.append(cached_key)

        for expired_key in expired_keys:
            del self._store[expired_key]
            self._misses += 1

    def get_stats(self) -> dict:
        """Return a snapshot of cache performance metrics.

        Includes the current number of entries (both active and expired),
        total hits and misses, the computed hit rate as a float between
        0.0 and 1.0, and the count of currently active (non-expired)
        entries. Expired entries that have not yet been evicted are
        counted separately so callers can assess cache freshness.
        """
        total_requests = self._hits + self._misses
        hit_rate = self._hits / total_requests if total_requests > 0 else 0.0

        now = time.monotonic()
        active_count = 0
        expired_count = 0
        for entry in self._store.values():
            if now <= entry["expires_at"]:
                active_count += 1
            else:
                expired_count += 1

        return {
            "size": len(self._store),
            "active": active_count,
            "expired": expired_count,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(hit_rate, 4),
        }
