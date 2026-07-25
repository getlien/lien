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
interior component — this alone fixes the Ruby fan-out), and the number of
directory segments allowed before it depends on which side is bare. A bare
*import* matching within a longer *target* may have at most one leading
segment — the established "source directory prefix" convention (bare `auth`
resolving to `src/auth.rs`). A bare *target* (a short top-level file's own
basename) matching within a longer *import* gets no leading-segment leniency
at all: there's no confirmed legitimate case for it, and it's exactly the Go
bug's shape — `internal/fs` (already module-prefix-stripped by #867) must not
tail-match an unrelated top-level `fs` target just because only one directory
segment happens to precede the match. Multi-segment patterns, and a cleaned
`./`/`../` relative import (already proof the specifier names a real project
file, not an ambiguous external package), are both unaffected.

`matchesPHPNamespace` independently implements the same reverse
tail-matching idea for PHP-style namespaces and had the identical gap for a
single-component import (e.g. the Swift `Combine` case actually flows
through this fallback strategy, not just `matchesAtBoundary`), so it gets the
same "at most one leading directory" guard.

Fixes #868.
