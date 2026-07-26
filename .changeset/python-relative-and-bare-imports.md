---
'@liendev/parser': patch
---

Fixes #901 and #904: two Python import-resolution gaps found on
pallets/flask, both remainders after #859/#861.

#904 — relative imports (`from .module import X`, `from ..pkg import Y`)
never matched anything, because `matchesPythonModule`'s regex rejects a
leading dot and the generic relative-import strategy in `matchesFile` only
understands JS/TS's slash-based `./`/`../`. `PythonImportExtractor` now
converts the grammar's leading-dot form to a `./`/`../`-prefixed specifier
at extraction time (mirroring `RustImportExtractor`'s `super::` -> `../`
conversion), and `python` is added to `chunker.ts`'s
`RESOLVE_RELATIVE_IMPORTS` set so `filepath` is threaded through and
`resolveRelativeImport` resolves it against the importing file's own
directory — the same path JS specifiers already take. On flask,
`src/flask/app.py`'s `from .globals import ...` now resolves to
`src/flask/globals`, closing 11 of `flask.globals`'s 16 real dependents that
were previously invisible (5/16 reported -> full ground truth).

#901 — a bare package import (`import flask`) never matched anything:
`matchesPythonModule`'s regex required at least one dot, so a dot-free
specifier failed the gate before any of its four sub-strategies ran. The
gate now also accepts a bare word, but routes it through only the two
position-anchored sub-strategies (exact/parent-package match) — the
unrestricted suffix/source-prefix strategies stay reserved for genuinely
multi-segment dotted paths, per #883's precedent against widening
leniency for short bare identifiers. Separately, flask's `src/`-layout
(package lives at `src/flask/`, one directory below where a bare import
resolves) has no reliable manifest declaration to read — even flit_core,
flask's own build backend, only declares the package *name*, not its
directory — so a new `python-src-layout.ts` (mirroring `php-psr4.ts`/
`go-module.ts`'s manifest-root pattern from #877) detects a real on-disk
`src/<package>/__init__.py` and resolves `flask` -> `src/flask` before
`matchesFile` ever runs. Together, `import flask` now reaches
`src/flask/__init__.py` and (via the parent-package strategy, exactly like
the existing dotted `django.http` -> `django/http/*.py` behavior) every file
under `src/flask/` — including `app.py`, which previously reported no test
coverage at all despite being the package's most heavily-tested file.

`resolvePythonSrcLayoutImport` verifies each candidate path actually exists
on disk before rewriting a specifier — needed because a single git repo can
hold more than one Python project (flask's own repo does: `examples/celery/`
and `examples/tutorial/` each have their own nested `src/<pkg>/` or
flat-layout package). Without that check, a bare import in one of those
nested projects (`examples/celery/make_celery.py`'s `import task_app`) would
misresolve against the *outer* `src/flask` root; the existence check keeps
that case an honest no-op instead.

Both fixes are additive and gated behind the exact shape they target (a
leading dot / a dot-free bare word / a detected, existence-verified `src/`
layout); every existing dotted-import test-association and dependent-analysis
behavior is unchanged (verified via a corpus-wide before/after dependents
diff across all 80 `.py` files in flask's repo: 0 regressions, 0 unexplained
new edges).
