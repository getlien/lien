# Quick GitHub Copilot Review Prompt

Copy-paste these into PR comments to get targeted reviews from Copilot.

---

## For General PR Reviews

```
@github-copilot review this PR with focus on:

1. **Code Quality**: TypeScript types, naming conventions, error handling
2. **Architecture**: Single Responsibility, modularity, clean interfaces
3. **Testing**: Ensure new features have tests, check if all tests pass
4. **Performance**: Look for inefficient operations, redundant work
5. **Edge Cases**: Empty/null input, large files, invalid data handling
6. **Security**: Input validation, path sanitization, no hardcoded secrets
7. **Documentation**: Check if README/docs/JSDoc need updates
8. **Consistency**: Follows existing patterns and conventions

Red flags:
- `any` types without justification
- Commented-out code
- Functions >50 lines
- Missing test coverage
- Hardcoded values that should be configurable
- Nested callbacks (prefer async/await)

Project principles: KISS, YAGNI, Single Responsibility, Fail Fast
```

---

## For CLI/Command Changes

```
@github-copilot review this CLI change:

Focus on:
1. Help text: Clear, accurate, follows existing format?
2. Options: Named consistently with other commands?
3. Input validation: Before expensive operations?
4. Error messages: Helpful and actionable?
5. Exit codes: 0 for success, non-zero for errors?
6. Progress indicators: For long-running operations?
7. Tests: CLI behavior tested?
```

---

## For Configuration/Schema Changes

```
@github-copilot review this configuration change:

Focus on:
1. Backward compatibility: Will existing configs still work?
2. Validation: Schema properly validates all cases?
3. Defaults: Sensible defaults provided?
4. Documentation: Config options documented?
5. Migration: Is there a migration path if breaking?
6. Consistency: Follows existing config patterns?
```

---

## For Performance-Critical Code

```
@github-copilot review this code for performance:

Focus on:
1. Algorithm complexity: O(n) vs O(n²)?
2. Data structures: Appropriate choices (Map vs Array for lookups)?
3. Memory: Large data handled efficiently (streaming/chunking)?
4. Caching: Expensive operations cached where appropriate?
5. Async: No blocking operations?
6. Benchmarks: Performance tests included or passing?
```

---

## For Server/Daemon Changes

```
@github-copilot review this server code:

Focus on:
1. Signal handling: SIGINT, SIGTERM for graceful shutdown?
2. Resource cleanup: Intervals, watchers, connections properly closed?
3. Process management: No zombie processes?
4. Logging: Appropriate level, doesn't leak sensitive info?
5. Error recovery: Handles failures gracefully?
6. Health checks: Can detect and report unhealthy state?
```

---

## For Test Changes

```
@github-copilot review these tests:

Focus on:
1. Coverage: Do new features have corresponding tests?
2. Edge cases: Empty/null/large/invalid input tested?
3. Determinism: Tests are reliable, not flaky?
4. Clarity: Test names clearly describe what's being tested?
5. Independence: Tests don't depend on each other?
6. Completeness: Integration tests cover end-to-end workflows?
```

---

## For Documentation Updates

```
@github-copilot review this documentation:

Focus on:
1. Accuracy: Reflects current behavior?
2. Completeness: All new features documented?
3. Clarity: Easy for developers to understand?
4. Examples: Code examples are correct and helpful?
5. Breaking changes: Clearly explained with migration guide?
6. Consistency: Follows documentation style/format?
```

---

## One-Liner for Quick Reviews

```
@github-copilot review focusing on: TypeScript types, code organization, test coverage, error handling, edge cases, performance, and consistency with existing codebase patterns.
```

---

## Reference Full Instructions

For comprehensive review guidelines:

```
@github-copilot review this PR following the guidelines in .github/instructions.md
```

---

## Targeted Questions

Combine with specific questions for focused reviews:

```
@github-copilot review this PR:
1. Is the error handling comprehensive?
2. Are there any performance concerns with this approach?
3. Are the tests sufficient to catch regressions?
4. Does this follow the project's architecture patterns?
```

