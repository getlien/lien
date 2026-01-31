---
'@liendev/core': patch
'@liendev/lien': patch
---

fix: clean up empty string artifacts in metadata, fix list_functions crash with LanceDB storage

- Filter empty strings from metadata fields (parameters, symbolType, symbols) at both AST extraction and MCP response shaping
- Fix list_functions crash when LanceDB flattens nested symbols objects
- Consolidate duplicate deduplication logic into shared utility
- Remove untyped response objects in MCP handlers
- Filter markdown files from related chunks in get_files_context
