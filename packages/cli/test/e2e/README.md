# E2E Tests

Gated tests that are excluded from the fast suite (`npm test`) because they
clone real repositories over the network, which is too slow for the default
`vitest run`.

## Real Open Source Projects (`real-projects.test.ts`)

End-to-end tests that validate Lien works correctly on real open source projects.

These tests:
- Clone popular open source projects for each supported language (shallow,
  `--depth 1`)
- Parse them with `performChunkOnlyIndex` — there is no persisted index to
  build, so nothing is stored and nothing can be stale
- Validate AST chunking, metadata extraction, dependency edges and test
  associations against per-project floors
- Run the four commands and check their output cannot contradict itself
- Ensure no regressions on real-world codebases

## Test Projects

| Language   | Project  | Repository                                | Why This Project                           |
|------------|----------|-------------------------------------------|--------------------------------------------|
| Python     | Requests | https://github.com/psf/requests           | Popular HTTP library, clean structure      |
| TypeScript | Zod      | https://github.com/colinhacks/zod         | Modern TS, clean codebase, type-heavy      |
| JavaScript | Express  | https://github.com/expressjs/express      | Most popular Node.js framework             |
| PHP        | Monolog  | https://github.com/Seldaek/monolog        | Standard PHP logging, clear patterns       |
| Rust       | Anyhow   | https://github.com/dtolnay/anyhow         | Error handling library, clean Rust patterns|
| Go         | Chi      | https://github.com/go-chi/chi             | Lightweight HTTP router, clean Go patterns |
| Java       | JavaPoet | https://github.com/square/javapoet        | Source-gen library, standard Java patterns |
| C#         | MediatR  | https://github.com/jbogard/MediatR        | Mediator library, clean C# patterns        |
| Ruby       | Sinatra  | https://github.com/sinatra/sinatra        | Web framework, classes/modules + require   |
| Kotlin     | Klaxon   | https://github.com/cbeust/klaxon          | JSON library, classes/objects + imports    |
| Swift      | SwiftyJSON | https://github.com/SwiftyJSON/SwiftyJSON | JSON library, structs/extensions + imports |

## Running Tests

### Locally (Manual)

```bash
# Run all E2E tests
npm run test:e2e

# Run specific language
npm test -- real-projects.test.ts -t "Python"
npm test -- real-projects.test.ts -t "TypeScript"

# Run with verbose output
npm run test:e2e -- --reporter=verbose
```

### CI/CD (Automatic)

The workflow triggers on `pull_request` to `main` and on `workflow_dispatch`.
It does **not** run on push.

Within a PR, the matrix runs when **any** of these holds (#1066):

| Condition | Why |
|---|---|
| the diff touches `packages/parser/src/`, `packages/parser-native/`, `packages/cli/src/` or `packages/cli/test/e2e/` (ignoring `*.md`) | this is what the suite asserts on — the primary trigger |
| the diff touches `e2e.yml` or `plan-e2e-matrix.mjs` | a change to the harness should run the harness |
| the PR contains a changeset | retained so nothing that ran before stops running |
| the PR carries the `e2e` label | manual escape hatch |
| `workflow_dispatch` | manual run |

Path is the primary trigger because changeset presence answers *"is this
release-worthy"*, not *"does this touch dependency resolution"*. Relying on the
latter let #1065 — a fix for a Rust crate-root **fabrication** bug — merge with
zero corpora because it carried no changeset. See #1066.

There is **no** `[skip e2e]` commit-message mechanism. To skip, simply don't
touch the trigger paths; to force a run, add the `e2e` label.

See `.github/workflows/e2e.yml` for CI configuration.

## What Gets Validated

**Parser, for each project:**

1. **Parse succeeds**: `performChunkOnlyIndex` returns `success: true` —
   checked explicitly, because it reports failure by RETURNING a flag rather
   than throwing, so an empty result would otherwise read as a pass
2. **File coverage**: minimum number of files parsed
3. **AST chunking**: more chunks than files (functions/methods extracted)
4. **AST metadata**: symbol names, types, complexity present
5. **Dependency edges**: a per-project floor, as a collapse detector — plus an
   exact-zero tripwire for languages known to resolve none (`swift`)
6. **Test associations**: same shape, same tripwire

Every floor is a **collapse detector, not a target**. Do not tighten one to
match a current measurement; see each field's doc comment.

**Commands, for each project** (#1139). These assert invariants rather than
values, since eleven upstream repos move on their own schedule:

7. **`lien complexity --format json`**: parses, reports files analysed
8. **`lien health --format json`**: no entry may contradict the run's own
   `coverage[]` — an entry whose language resolved no fan-in must carry
   `dependents: null` and `shape: "unknown-fan-in"`, never a count or a
   containment verdict. This is the invariant #1137 violated in a shipped
   release while this suite stayed green
9. **`lien review --base HEAD`** on the unmodified clone: must call an empty
   diff empty rather than clean
10. **`lien delta` + `lien review`** against a synthetic uncommitted edit:
    both must see the change, and both must exit 0

**What is deliberately NOT covered:** `lien review --base <parent>` against a
real historical commit. The corpus is cloned `--depth 1`, so `HEAD~1` does not
exist. Item 10 works around that with an uncommitted edit against `HEAD`,
which exercises the diff path but not multi-commit history. Deepening the
clones would cost network time on every CI run; that trade has not been made.

## Test Duration

- **Per project**: ~2-15 seconds (clone + parse + four commands)
- **Total suite**: 11 projects, sharded one per CI job

Timing depends on:
- Network speed (git clone dominates)
- CPU (parsing)
- Project size

## Adding New Projects

To add a test for a new language or project:

1. Add to `TEST_PROJECTS` array in `real-projects.test.ts`:

```typescript
{
  name: 'ProjectName',
  repo: 'https://github.com/user/project.git',
  branch: 'main',
  language: 'rust',
  expectedMinFiles: 20,
  expectedMinChunks: 80,
  expectedSymbolTypes: ['function', 'method', 'struct'],
}
```

2. Run locally to verify:

```bash
npm test -- real-projects.test.ts -t "ProjectName"
```

## Debugging Failed Tests

### Clone Failed
```bash
# Verify repo URL and branch
git ls-remote https://github.com/user/project.git

# Try manual clone
git clone --depth 1 --branch main https://github.com/user/project.git /tmp/test
```

### Parse Failed
```bash
# Find the temp directory (cross-platform)
TEMP_DIR="$(node -p 'require("path").join(require("os").tmpdir(), "lien-e2e-tests")')"
echo "Temp directory: $TEMP_DIR"

# Check the temp directory contents
ls -la "$TEMP_DIR"

# Run Lien manually in the failed project directory
cd "$TEMP_DIR"/requests-*  # or zod-*, swiftyjson-*, monolog-*, ...
node <path-to-lien-repo>/packages/cli/dist/index.js health

# Or if you have lien installed globally
lien health
```

### Not Enough Files/Chunks
- Project structure may have changed
- Update `expectedMinFiles` / `expectedMinChunks` to reflect reality
- Check if project moved files to a different directory

## Cleanup

Tests automatically clean up temp directories:
- **After tests complete**: `afterAll()` hook removes all test directories
- **On interruption**: Signal handlers (SIGINT/SIGTERM) catch Ctrl+C and kill commands
- **On crash**: Process exit handlers ensure cleanup even if tests fail

**Temp directory location (OS-specific):**
```bash
# Linux
/tmp/lien-e2e-tests/

# macOS
/var/folders/.../T/lien-e2e-tests/  # or /tmp/lien-e2e-tests/

# Windows
C:\Users\<username>\AppData\Local\Temp\lien-e2e-tests\
```

**Manual cleanup if needed:**
```bash
# Linux/macOS: Remove all E2E test directories
rm -rf "$(node -e 'console.log(require("os").tmpdir())')/lien-e2e-tests/"

# Windows (PowerShell): Remove all E2E test directories
Remove-Item -Recurse -Force "$env:TEMP\lien-e2e-tests"

# Or check what's there (cross-platform Node.js)
node -e "console.log(require('path').join(require('os').tmpdir(), 'lien-e2e-tests'))"
```

**Cleanup guarantees:**
- ✅ Cleans up after successful test run
- ✅ Cleans up after failed test run
- ✅ Cleans up when you press Ctrl+C
- ✅ Cleans up when process is killed (SIGTERM)
- ✅ Only leaves files if process is force-killed (SIGKILL)

## Performance Optimization

To keep tests fast:
- **Shallow clones**: `--depth 1` (only latest commit)
- **Parallel execution**: Vitest runs tests in parallel
- **Caching**: Git clones are not cached (fresh each time to catch issues)

## CI Configuration

See `.github/workflows/e2e.yml`:

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run test:e2e
```

## FAQ

**Q: Why not use smaller test projects?**  
A: Real projects catch issues that toy examples miss (complex nesting, edge cases, performance).

**Q: Can I skip these in CI?**  
A: Not by commit message — `[skip e2e]` was documented here but never
implemented anywhere in `.github/`. The matrix is trigger-gated instead: it
runs when the diff touches the paths listed under "CI/CD" above, when the PR
has a changeset, or when it carries the `e2e` label. A PR touching none of
those already skips it.

**Q: What if a project updates and breaks tests?**  
A: Pin to a specific commit SHA instead of branch name, or update expected values.

**Q: Why shallow clones?**  
A: Speed. We only need latest code to validate Lien works.

## Future Enhancements

- [ ] Add performance benchmarks (parse time)
- [ ] Add multi-language project test (e.g., Django + React)
- [ ] Cache git clones between runs
- [ ] Add memory usage monitoring

