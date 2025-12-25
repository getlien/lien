---
"@liendev/core": minor
"@liendev/lien": minor
---

Previously, when `~/.lien/config.json` contained JSON syntax errors, Lien would silently fall back to LanceDB without indicating the config was ignored.

**Now you get clear, actionable error messages:**

```bash
$ lien index
✖ Indexing failed

Failed to parse global config file.
Config file: /Users/you/.lien/config.json
Syntax error: Expected double-quoted property name in JSON at position 23 (line 1 column 24)

Please fix the JSON syntax errors in your config file.
```

**What changed:**

- Config parsing errors now show the exact file path
- Specific syntax error with line/column position
- Helpful remediation message
- Missing config files still silently fall back to LanceDB (expected behavior)
