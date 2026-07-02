# ADR-010: Retire the Qdrant Backend

**Status**: Accepted
**Date**: 2026-07-02
**Deciders**: Core Team

## Context and Problem Statement

Lien's thesis is **local-first**: all code analysis, embedding, and search happen on the user's machine. LanceDB is the backend that delivers this — zero-config, local disk, no server.

The Qdrant backend was added during an earlier exploration of hosted/team scenarios (cross-repo search, multi-tenant isolation via `orgId`/`branch`/`commitSha`). That direction was abandoned, but the backend stayed behind as half-maintained pivot residue. A whole-repo review confirmed it was not just dead weight — it was actively causing bugs:

1. **`lien status` reports "Not indexed"** for projects configured with the Qdrant backend, because status checks the LanceDB path directly.
2. **`lien index --force` clears the wrong backend** — the clear path did not follow the configured backend.
3. **`lien config set qdrant.apiKey` wipes `qdrant.url`** — the partial-config builder overwrote the nested `qdrant` object with an empty `url`.

Every code path had to carry a second backend it could not test in CI (the Qdrant test suite required a locally running Qdrant server and failed on every plain `npm test` run).

## Decision

Remove the Qdrant implementation entirely; keep the backend seam.

- **Deleted**: `qdrant.ts`, `qdrant-query.ts`, `qdrant-filter-builder.ts`, `qdrant-batch-insert.ts`, `qdrant-maintenance.ts`, `qdrant-payload-mapper.ts` and their tests; the `@qdrant/js-client-rest` dependency; the `qdrant.*` config keys and the `qdrant` backend enum value; the `LIEN_QDRANT_URL`/`LIEN_QDRANT_API_KEY` environment variables.
- **Kept deliberately**: the `VectorDBInterface` type and the `createVectorDB` factory. This seam is how an alternative backend would be reintroduced without touching call sites. The cross-repo surface (`supportsCrossRepo`, `searchCrossRepo`, `scanCrossRepo`, the `crossRepo` MCP tool parameters) also remains — LanceDB reports `supportsCrossRepo: false` and handlers fall back to single-repo behavior, exactly as before.
- **Kept deliberately**: the multi-tenant `ChunkMetadata` fields (`repoId`, `orgId`, `branch`, `commitSha`) — optional fields that a future cross-repo-capable backend can populate.

## Consequences

### Positive

- Three real bugs disappear at the root instead of being patched around.
- One backend, tested in CI: the full `@liendev/core` suite is green without a Qdrant server.
- Smaller dependency tree and less code to maintain in every vectordb change.

### Negative / Breaking

- **Breaking for Qdrant configs** — mitigated by graceful degradation: an existing `~/.lien/config.json` with `backend: "qdrant"` or `qdrant.*` keys (or `LIEN_BACKEND=qdrant`) does **not** crash. Lien warns once ("Qdrant support was removed in Lien v0.49; falling back to local LanceDB.") and proceeds with LanceDB. `mergeGlobalConfig` drops the retired keys on the next `lien config set`, so config files heal over time.
- Users who relied on cross-repo search via Qdrant lose that capability; `crossRepo=true` now always falls back to single-repo with a warning note in the tool response.

### Neutral

- Reintroducing a remote backend later means implementing `VectorDBInterface` and extending the factory — the same shape the Qdrant backend had, minus the half-maintenance.
