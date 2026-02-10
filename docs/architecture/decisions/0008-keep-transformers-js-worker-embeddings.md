# ADR-008: Keep transformers.js WorkerEmbeddings as Sole Embedding Backend

**Status**: Accepted
**Date**: 2026-02-10
**Deciders**: Core Team
**Related**: PR #160 (transformers v3 upgrade), PR #161 (remove dead device config)

## Context and Problem Statement

Lien uses local embeddings (all-MiniLM-L6-v2, 384-dim) for semantic code search. The existing implementation uses `@huggingface/transformers` v3 running in a Node.js worker thread (`WorkerEmbeddings`). We investigated whether a native approach could deliver faster embeddings, particularly with GPU acceleration.

Three alternatives were explored:

1. **Rust native addon** (`napi-rs` + `ort` crate) — a new `@liendev/embeddings` package
2. **Direct onnxruntime-node** — calling Microsoft's ONNX Runtime from TypeScript without transformers.js
3. **Worker-threaded onnxruntime-node** — same as (2) but offloaded to a worker thread

## Decision Drivers

* **Performance** — Embedding generation is the bottleneck during indexing
* **Simplicity** — Fewer moving parts, fewer dependencies, easier to maintain
* **Correctness** — Embeddings must be semantically identical across backends
* **Cold start** — MCP server and CLI should initialize quickly

## Considered Options

### Option 1: Rust native addon (`@liendev/embeddings`)

A new `packages/embeddings/` package using `napi-rs` + `ort` crate v2 + HuggingFace `tokenizers` crate. Would ship pre-built binaries for 5 platforms via napi-rs platform packages.

**Findings:**
- The `ort` crate's pre-built binaries from pyke's CDN (`cdn.pyke.io`) are **6x slower** than Microsoft's official ONNX Runtime build on Apple Silicon (ARM64)
- pyke's binary: ~10ms/embedding vs onnxruntime-node's official binary: ~1.6ms/embedding
- The version pinning in `ort` v2 (requires ONNX Runtime >= 1.23.x) prevents using Microsoft's faster v1.21.0 dylib
- Added significant complexity: Rust toolchain, cross-compilation CI, 5 platform packages

### Option 2: Direct onnxruntime-node with TypeScript tokenizer (chosen then rejected)

Call `onnxruntime-node` directly from TypeScript with a hand-rolled WordPiece tokenizer, bypassing transformers.js.

**Findings:**
- Per-embedding speed: ~2.3ms (vs ~3.2ms for transformers.js) — **30% faster per-call**
- Cosine similarity = 1.000000 (bit-identical output)
- But runs on main thread, blocking file scanning and AST parsing
- Full pipeline `lien index --force`: **19.9s** (vs 8.1s for WorkerEmbeddings)
- Even when moved to a worker thread: **19.5s** — still 2x slower end-to-end
- CPU time: 93.5s vs 41.6s — our tokenizer + inference call pattern is less efficient than transformers.js internals

### Option 3: Keep WorkerEmbeddings (chosen)

Keep the existing `WorkerEmbeddings` using `@huggingface/transformers` v3 in a worker thread.

**Findings:**
- transformers.js v3 in Node.js uses `onnxruntime-node` under the hood (not WASM)
- Ships Microsoft's official optimized ARM64 binary
- Handles tokenization via compiled WASM tokenizer (faster than our TypeScript WordPiece)
- Worker thread enables concurrent file processing during embedding generation
- Full pipeline `lien index --force`: **8.1s** — fastest option

## Decision Outcome

In the context of optimizing embedding generation for local semantic search, facing the finding that both native alternatives (Rust addon and direct onnxruntime-node) were 2-2.5x slower for end-to-end indexing, we decided to keep `WorkerEmbeddings` (transformers.js in a worker thread) as the sole embedding backend, accepting the dependency on `@huggingface/transformers`.

### Key insight

transformers.js v3 already uses `onnxruntime-node` (native C++) in Node.js — it's not running WASM. The performance advantage comes from its optimized tokenizer and the worker thread enabling concurrent file I/O + AST parsing on the main thread.

## Consequences

### Positive

- **Zero new dependencies** — no Rust toolchain, no platform-specific binaries, no CI matrix
- **Simplest architecture** — one embedding backend, no factory pattern, no fallback logic
- **Fastest end-to-end** — 8.1s for full reindex (82 files) vs 19.5s for native alternatives
- **Removed dead code** — `embeddings.device` config, `LIEN_EMBEDDING_DEVICE` env var, `resolveEmbeddingDevice()`, WebGPU try/catch blocks

### Negative

- **No GPU acceleration path** — WebGPU doesn't work in Node.js; CoreML/CUDA would require a native addon
- **Single point of failure** — if transformers.js breaks, there's no fallback (mitigated: it's a well-maintained library with 10k+ GitHub stars)

### Neutral

- The `LIEN_EMBEDDING_BACKEND=js` env var override was removed (no longer needed with single backend)
- `LocalEmbeddings` class remains available for direct (non-worker) usage in tests

## Validation

### Benchmark: Full `lien index --force` (82 files, Apple Silicon M3)

| Backend | Wall clock | CPU time | Notes |
|---------|-----------|----------|-------|
| WorkerEmbeddings (transformers.js) | **8.1s** | 41.6s | Worker thread parallelism |
| NativeEmbeddingService (main thread) | 19.9s | 95.4s | Blocks main thread |
| NativeWorkerEmbeddings (worker thread) | 19.5s | 93.5s | Apples-to-apples comparison |

### Benchmark: Per-embedding microbenchmark

| Backend | Latency | Throughput |
|---------|---------|------------|
| onnxruntime-node direct | 1.6ms | 625 emb/s |
| NativeEmbeddingService (TS tokenizer) | 2.3ms | 428 emb/s |
| WorkerEmbeddings (transformers.js) | 3.2ms | 315 emb/s |
| Rust addon (ort crate, pyke binary) | 9.7ms | 103 emb/s |

Per-call, onnxruntime-node direct is fastest — but the end-to-end pipeline performance is what matters, and transformers.js wins there due to internal optimizations.

## References

- [transformers.js v3](https://huggingface.co/docs/transformers.js) — uses onnxruntime-node in Node.js
- [ort crate](https://docs.rs/ort/latest/ort/) — Rust ONNX Runtime bindings (pyke CDN binaries)
- [onnxruntime-node](https://www.npmjs.com/package/onnxruntime-node) — Microsoft's official Node.js addon
- PR #160 — transformers v3 upgrade + device config (now removed)
- PR #161 — remove dead embeddings.device config
