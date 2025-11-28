# E2E Tests with Real Projects

End-to-end tests that validate Lien works correctly on real open source projects.

## Overview

These tests:
- Clone popular open source projects for each supported language
- Index them with Lien
- Validate AST chunking and metadata extraction
- Ensure no regressions on real-world codebases

## Test Projects

| Language   | Project  | Repository                                | Why This Project                           |
|------------|----------|-------------------------------------------|--------------------------------------------|
| Python     | Requests | https://github.com/psf/requests           | Popular HTTP library, clean structure      |
| TypeScript | Zod      | https://github.com/colinhacks/zod         | Modern TS, clean codebase, type-heavy      |
| JavaScript | Express  | https://github.com/expressjs/express      | Most popular Node.js framework             |
| PHP        | Monolog  | https://github.com/Seldaek/monolog        | Standard PHP logging, clear patterns       |

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

These tests run automatically on:
- Push to `main` branch
- Pull requests to `main` (optional, can be skipped with `[skip e2e]` in commit message)

See `.github/workflows/e2e.yml` for CI configuration.

## What Gets Validated

For each project, we verify:

1. **Initialization**: Lien config created successfully
2. **Indexing**: Project indexed without errors
3. **File Coverage**: Minimum number of files indexed
4. **AST Chunking**: More chunks than files (functions/methods extracted)
5. **AST Metadata**: Symbol names, types, complexity, etc. present
6. **Reindexing**: Can reindex without errors

## Test Duration

- **Per project**: ~20-60 seconds (clone + index)
- **Total suite**: ~2-5 minutes (4 projects)

Timing depends on:
- Network speed (git clone)
- CPU (indexing + embeddings)
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
  sampleSearchQuery: 'example search query',
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

### Index Failed
```bash
# Check the temp directory (tests use /tmp for predictability)
ls -la /tmp/lien-e2e-tests/

# Run Lien manually (from your lien repo root)
cd /tmp/lien-e2e-tests/requests-*  # or zod-*, express-*, monolog-*
node <path-to-lien-repo>/packages/cli/dist/index.js index --verbose

# Or if you have lien installed globally
lien index --verbose
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

**Temp directory location:**
```bash
/tmp/lien-e2e-tests/
```

**Manual cleanup if needed:**
```bash
# Remove all E2E test directories
rm -rf /tmp/lien-e2e-tests/

# Or check what's there
ls -la /tmp/lien-e2e-tests/
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
A: Yes, add `[skip e2e]` to your commit message.

**Q: What if a project updates and breaks tests?**  
A: Pin to a specific commit SHA instead of branch name, or update expected values.

**Q: Why shallow clones?**  
A: Speed. We only need latest code to validate Lien works.

## Future Enhancements

- [ ] Add semantic search validation (requires MCP server)
- [ ] Add performance benchmarks (index time, search latency)
- [ ] Add multi-language project test (e.g., Django + React)
- [ ] Cache git clones between runs
- [ ] Add memory usage monitoring
- [ ] Test incremental indexing (modify file, reindex)

