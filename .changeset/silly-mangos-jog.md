---
"@liendev/parser": patch
"@liendev/core": patch
"@liendev/lien": patch
---

`lien index` now refuses to index your home directory or a filesystem root (`/`, `C:\`, a Windows user-profile root) unless explicitly overridden with `--allow-unsafe-root`. This closes the incident behind #1025: running `lien index` from `$HOME` swept macOS Keychain databases, `.npm` debug logs, and Claude Code agent caches into a 10.5 GB index with no warning. The refusal names the exact path and the override flag; a genuine reason to index an unusual root is always one flag away.

As defense in depth, an extra set of OS/credential exclusions (`Library/`, `AppData/`, `.npm/`, `.cache/`, `.claude/`, `.ssh/`, `.aws/`, `.gnupg/`, `*.keychain`/`*.keychain-db`) now applies whenever the indexed root IS the home directory itself — scoped so an ordinary project is never affected, even one with its own legitimate `Library/` directory (Arduino, Unity, some Java layouts) or one that simply lives directly under `$HOME` (`~/myproject`).

Indexing also now skips any single file over 5 MB instead of chunking it whole — a backstop against the same disk-blowup class independent of path filtering, for a legitimately huge binary in an otherwise ordinary project just as much as for an overridden home-root scan.

`lien status` now reports the index's on-disk size (`Index size:` in text output, `indexSizeBytes` in `--format json`), so an anomalously large index is visible instead of sitting unnoticed.
