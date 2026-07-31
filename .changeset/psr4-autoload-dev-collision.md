---
"@liendev/parser": patch
"@liendev/lien": patch
---

Fix `get_dependents` reporting `0` (with no caveat) for every file in a PHP
project whose `composer.json` declares the same PSR-4 namespace prefix in
both `autoload` and `autoload-dev` — the standard library layout, where a
package's tests share its own namespace (#1002). `resolvePsr4Map`
(`php-psr4.ts`) used to build a flat `Map<prefix, string>`, and
`autoload-dev` was processed second, so it silently overwrote `autoload`'s
directory for the shared prefix. On Monolog's real `composer.json`
(`"Monolog\\"` declared as both `src/Monolog` and `tests/Monolog`), every
`use Monolog\Logger;` in `src/` resolved to the nonexistent
`tests/Monolog/Logger`, and `get_dependents` reported `0` dependents for
all 232 of Monolog's files with `attributionCaveat: null` — indistinguishable
from "nothing depends on this file."

Both directories are simultaneously correct (`Monolog\Logger` really lives
under `src/Monolog`, `Monolog\LoggerTest` really lives under
`tests/Monolog`), so a flat `Map<prefix, string>` can't represent the data —
reordering to prefer `autoload` would just invert the bug and break PHP test
association (#867), the reason this module exists. The map now stores
`Map<prefix, string[]>`, appending rather than overwriting (this also
resolves, for free, the previously-ignored case of a PSR-4 prefix mapping to
an array of Composer fallback directories — only the first entry used to be
kept). `resolvePsr4Import` tries each candidate directory in declaration
order (`autoload` before `autoload-dev`) and prefers whichever resolves to a
real `.php` file on disk, falling back to the first-registered candidate
when neither exists (matching prior behavior for the single-candidate case).

Verified end to end against a real `Seldaek/monolog` clone: before this fix,
`0 edges / 232 orphans (100.0%)`; after, `src/Monolog/Logger.php` correctly
reports all 13 of its real production importers as dependents. Confirmed no
over-correction (no production file's import resolves to a `tests/`
candidate that doesn't apply to it). Swept the sibling manifest resolvers
this module says it "mirrors" (`workspace-packages.ts`, `rust-crate-map.ts`)
for the same last-write-wins shape — both are clean, because npm/Cargo
package names are uniqueness-enforced by their respective package managers,
unlike Composer's PSR-4, which explicitly permits the same prefix in two
sections.
