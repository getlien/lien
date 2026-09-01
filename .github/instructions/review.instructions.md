---
applyTo: "**"
excludeAgent: "coding-agent"
---

# Lien Code Review Instructions

Review PRs for Lien — a local-first code-health CLI. It parses the working
tree on demand with Tree-sitter and answers four questions about a change:
what is risky to touch, what crossed a complexity threshold, what
deterministic signals fire on the diff, and where the hotspots are.

There is no server, no persisted index and no search. `lien complexity`,
`lien health`, `lien review` and `lien delta` are the whole surface. The MCP
server, the SQLite structural store, the file watcher, the LLM review engine
and the GitHub Action all existed once and were deleted — if a diff
reintroduces one, that is the finding.

---

## ⚠️ Critical: Lien-specific issues

**These break Lien in ways that are hard to debug. Flag immediately.**

### No-data honesty (`packages/cli/src/utils/scan-failure.ts`)

- **A read-only command must never render "no data" as a clean result.** An
  empty or failed parse formats identically to a genuinely clean codebase
  unless the command checks which one it has.
- `performChunkOnlyIndex` signals failure by **returning `{ success: false }`**,
  not by throwing — easy to miss. `complexity`, `health` and `review` all
  route it through `describeScanFailure`.
- Partial failure counts too: `describeScanFailure` returns `undefined` the
  moment *anything* parsed, so `describePartialScan` covers the run where most
  of the corpus failed.
- **The inverse is equally a bug:** never turn a genuinely clean result into a
  false alarm. A gate that over-fires gets trained out as noise.

### Deterministic over inferred (`packages/parser/src/signals/`)

- A check that is really a diff/parse query should be **computed**, not handed
  to a model to grep-and-reason.
- New signals must be pure functions over a diff plus parser output — no LLM,
  no network, no index — unit-tested in a co-located `<module>.test.ts`, and
  **default OFF** until precision is measured on real diffs. 13 of 14 existing
  signals have unproven precision; only `comparison-change` runs by default.

### Published-package surface (`packages/parser/src/index.ts`)

- `@liendev/parser` is published, so **an exported internal is
  semver-locked**. The barrel is deliberately curated: a symbol goes public
  only when production code outside its module imports it.
- Never widen the export list "for now" — narrowing later is a breaking change.

### Tree-sitter node iteration

- `.namedChildren` / `.children` are **arrays**. Use `.forEach()`, `.find()`,
  `.some()`, `.map()`, `.flatMap()` — never manual index loops over
  `namedChildCount`. No `.findLast()` (ES2023).

### File paths (cross-platform)

- Always `path.join()` / `path.resolve()`, never string concatenation.
- Normalize before comparing — `getCanonicalPath()` exists for this.

---

## 🔍 Standard review

### Must have
- [ ] **No `any`** without an `// eslint-disable` explaining why
- [ ] **Async functions have try/catch** or a caller that handles errors
- [ ] **New behaviour has tests**
- [ ] **A changeset** when `parser`, `parser-native` or `lien` change
      behaviour (they are a `linked` group and bump together)

### Should have
- [ ] **Single responsibility** — if it can't be described in one sentence, split it
- [ ] **Early returns** for error cases, not nested if/else
- [ ] **Descriptive names** — `processFile`, not `doIt`

---

## 🚩 Red flags

```typescript
// ❌ Treating a failed scan as a clean result
const report = analyzeComplexityFromChunks(scan.chunks); // scan.success unchecked

// ❌ Path concatenation
const fullPath = rootDir + '/' + filepath; // BREAKS ON WINDOWS

// ❌ Manual index loop over tree-sitter children
for (let i = 0; i < node.namedChildCount; i++) { ... } // use .namedChildren

// ❌ Swallowed errors
try { ... } catch (e) { } // HIDES BUGS

// ❌ Widening a published barrel for convenience
export * from './internal/thing.js'; // semver-locks every symbol in it
```

---

## 📁 Review by directory

### `packages/parser/src/`
- Zero dependency on the CLI; it must stay standalone
- `signals/` — pure, co-located tests, default off
- Barrel additions are intentional and justified

### `packages/cli/src/cli/`
- Commands honour the no-data contract for their disposition:
  `complexity` hard-errors (gate-shaped), `health`/`review` are advisory at
  exit 0
- `lien delta` is the only gate, and fires only on a threshold a function was
  **under** before

### `packages/cli/src/{config,errors,insights}/`
- Came from the deleted `@liendev/core`; keep them CLI-internal rather than
  re-exporting a new public API

---

## Before approving

1. **Does CI pass?** format, lint, typecheck, build, test, `lien delta --base`, docs-truth
2. **Is a claim in prose still true after the change?** Deleting a thing
   leaves prose describing what it was *for* — grep for that, not just its name
3. **Is this the simplest solution?**

**When in doubt: is this code a junior dev could debug at 2am?**
