---
"@liendev/parser": minor
"@liendev/core": minor
---

feat(parser): chunk markdown by heading section as a 'doc' chunk kind

Markdown files (`.md`/`.mdx`/`.markdown`) now chunk by heading section — the heading breadcrumb becomes the chunk's symbol name — instead of fixed 75-line windows. Chunking is fenced-code- and YAML-front-matter-aware and splits oversized sections, and chunks are tagged with a new `type: 'doc'`. This improves `search_code` / `get_files_context` retrieval of README, CLAUDE.md, and `docs/` content. Internally, a shared bounded-BFS graph primitive (`walkBounded`) is extracted into `@liendev/parser` and reused by the review engine.
