# Architectural Decision Records (ADRs)

This directory contains Architectural Decision Records (ADRs) documenting significant architectural and design decisions made in the Lien project. Each ADR captures a decision's context, alternatives, and consequences. Background on the practice and the Y-statement format used here is at [adr.github.io](https://adr.github.io/).

## ADR Index

| ADR | Title | Date | Status |
|-----|-------|------|--------|
| [ADR-001](0001-split-vectordb-module.md) | Split VectorDB Module into Focused Sub-Modules | 2025-11-24 | Accepted |
| [ADR-002](0002-strategy-pattern-ast-traversal.md) | Use Strategy Pattern for Language-Specific AST Traversal | 2025-11-25 | Accepted |
| [ADR-003](0003-ast-based-chunking.md) | Use AST-Based Semantic Chunking Over Line-Based Chunking | 2025-11-23 | Accepted |
| [ADR-004](0004-test-association-detection.md) | Use Convention-Based and Import-Based Test Association Detection | 2025-11-23 | Accepted |
| [ADR-005](0005-per-language-definition-pattern.md) | Consolidate Language Support into Per-Language Definitions | 2026-02-03 | Partially Superseded |
| [ADR-006](0006-consolidated-language-files-with-import-extractors.md) | Consolidate Language Files and Add Import Extractors | 2026-02-05 | Accepted |
| [ADR-007](0007-replace-framework-detection-with-ecosystem-presets.md) | Replace Framework Detection with Ecosystem Presets | 2026-02-07 | Accepted |
| [ADR-008](0008-keep-transformers-js-worker-embeddings.md) | Keep transformers.js WorkerEmbeddings as Sole Embedding Backend | 2026-02-10 | Superseded by ADR-011 |
| [ADR-009](0009-extract-parser-package.md) | Extract `@liendev/parser` from `@liendev/core` | 2026-02-19 | Accepted |
| [ADR-010](0010-retire-qdrant-backend.md) | Retire the Qdrant Backend | 2026-07-02 | Accepted |
| [ADR-011](0011-sqlite-structural-store-fts5-lexical-search.md) | Replace LanceDB + Embeddings with a SQLite Structural Store and FTS5 Lexical Search | 2026-07-04 | Accepted |
| [ADR-012](0012-self-hostable-review-action.md) | Self-Hostable GitHub Action for PR Review | 2026-06-27 | Accepted |
| [ADR-013](0013-prebuilt-native-parser-napi-rs.md) | Prebuilt Native Parser via napi-rs (`@liendev/parser-native`) | 2026-07-08 | Accepted |
| [ADR-014](0014-per-rule-candidate-loop-passes.md) | Per-Rule Candidate-Loop Passes for Agent Review | 2026-07-16 | Accepted |

## Conventions

New ADRs follow the section structure demonstrated by the existing files: Status, Date, Deciders, Related; Context and Problem Statement; Decision Drivers; Considered Options; Decision Outcome (as a Y-statement); Consequences (Positive/Negative/Neutral); Validation; Related Decisions; References.

Write an ADR for a significant architectural change, a choice between competing technical approaches, or a decision that affects future development. Skip it for bug fixes, routine refactoring, or dependency bumps.

Number sequentially (e.g. `0015-my-decision.md`) and commit it through the normal PR review process. If a decision is later replaced, write a new ADR that supersedes the old one and mark the old one's status accordingly, rather than editing the original record.
