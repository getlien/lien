---
'@liendev/parser': minor
---

The native backend (`@liendev/parser-native`) is now the default parser -- prebuilt binaries, 1.8-2.2x faster end-to-end than the previous `node-tree-sitter` path. `LIEN_PARSER=legacy` remains available as a transitional opt-out (scheduled for removal in a future release). If no prebuilt native binary can be loaded for your platform, lien automatically falls back to the legacy backend for the session and prints a one-time warning explaining why and how to build one -- see ADR-013 (docs/architecture/decisions/0013-prebuilt-native-parser-napi-rs.md).
