---
"@liendev/parser": patch
---

Fix `matchesAtBoundary`/`matchesFile` (and the parallel `matchesPHPNamespace`
reverse-component matcher) so a bare, slash-free import specifier no longer
wins a coincidental boundary match against an unrelated multi-segment path.

Confirmed independently in three languages during an OSS dogfood sweep:

- **Go**: `github.com/gin-gonic/gin/internal/fs` tail-matched the unrelated
  top-level `fs.go`, misattributing a real dependency away from
  `internal/fs/fs.go` to the wrong file.
- **Ruby**: a bare `require 'sinatra'` matched every file under `lib/sinatra/`
  (`base.rb`, `main.rb`, `show_exceptions.rb`, `version.rb`), not just the
  gem's own entry point (`lib/sinatra.rb`).
- **Swift**: `import Combine` (Apple's system framework) falsely matched the
  unrelated `Source/Features/Combine.swift` purely because the basenames
  coincide.

The fix is one targeted guard, not a scoring system: a bare (no `/`)
specifier must reach the *end* of the longer string (not merely appear as an
interior component — this alone fixes the Ruby fan-out) and may have at most
one leading directory segment before it (the common "source directory
prefix" convention, e.g. bare `auth` resolving to `src/auth.rs` — more than
that is a coincidental name collision, not a real relationship). Multi-segment
patterns, and a cleaned `./`/`../` relative import (already proof the
specifier names a real project file, not an ambiguous external package), are
both unaffected.

`matchesPHPNamespace` independently implements the same reverse
tail-matching idea for PHP-style namespaces and had the identical gap for a
single-component import (e.g. the Swift `Combine` case actually flows
through this fallback strategy, not just `matchesAtBoundary`), so it gets the
same "at most one leading directory" guard.

Fixes #868.
