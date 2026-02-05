# Architectural Decision Records (ADRs)

This directory contains Architectural Decision Records (ADRs) documenting significant architectural and design decisions made in the Lien project.

## What are ADRs?

An **Architectural Decision Record (ADR)** captures a single architectural decision along with its context, rationale, and consequences. ADRs help answer:

- **Why** was this decision made?
- **What** alternatives were considered?
- **What** are the trade-offs?
- **When** was this decision made?

For more information, see [adr.github.io](https://adr.github.io/).

## ADR Index

| ADR | Title | Date | Status |
|-----|-------|------|--------|
| [ADR-001](0001-split-vectordb-module.md) | Split VectorDB Module into Focused Sub-Modules | 2025-11-24 | Accepted |
| [ADR-002](0002-strategy-pattern-ast-traversal.md) | Use Strategy Pattern for Language-Specific AST Traversal | 2025-11-25 | Accepted |
| [ADR-003](0003-ast-based-chunking.md) | Use AST-Based Semantic Chunking Over Line-Based Chunking | 2025-11-23 | Accepted |
| [ADR-004](0004-test-association-detection.md) | Use Convention-Based and Import-Based Test Association Detection | 2025-11-23 | Accepted |
| [ADR-005](0005-per-language-definition-pattern.md) | Consolidate Language Support into Per-Language Definitions | 2026-02-03 | Partially Superseded |
| [ADR-006](0006-consolidated-language-files-with-import-extractors.md) | Consolidate Language Files and Add Import Extractors | 2026-02-05 | Accepted |

## ADR Format

All ADRs follow the **Y-statement format** recommended by [adr.github.io](https://adr.github.io/):

```markdown
# ADR-XXX: [Title]

**Status**: [Proposed | Accepted | Rejected | Deprecated | Superseded]
**Date**: YYYY-MM-DD
**Deciders**: [Who made this decision]
**Related**: [Related ADRs, features, versions]

## Context and Problem Statement
[What problem are we solving?]

## Decision Drivers
[What factors influenced this decision?]

## Considered Options
[What alternatives did we consider?]

## Decision Outcome
[The Y-statement: In the context of X, facing Y, we decided for Z to achieve A, accepting B]

## Consequences
### Positive
[Benefits]

### Negative
[Costs, risks]

### Neutral
[Other impacts]

## Validation
[How did we verify this worked?]

## Related Decisions
[Links to related ADRs]

## References
[External links, papers, docs]
```

## When to Create an ADR

Create an ADR when:

- ✅ Making a significant architectural change (e.g., splitting a module, changing a pattern)
- ✅ Choosing between multiple technical approaches (e.g., Strategy Pattern vs Factory)
- ✅ Adopting a new technology or library (e.g., Tree-sitter, LanceDB)
- ✅ Changing a fundamental design principle (e.g., line-based → AST-based chunking)
- ✅ Making a decision that affects future development (e.g., multi-language support)

**Don't** create ADRs for:
- ❌ Minor bug fixes
- ❌ Routine refactoring
- ❌ Code style changes
- ❌ Dependency updates

## How to Create an ADR

1. **Copy template** from an existing ADR or use the Y-statement format above
2. **Number sequentially**: Next number in the sequence (e.g., `0005-my-decision.md`)
3. **Write context**: Explain the problem and why a decision is needed
4. **List options**: Document at least 2-3 alternatives considered
5. **State decision**: Use Y-statement format for the decision outcome
6. **Document consequences**: Positive, negative, and neutral impacts
7. **Add validation**: Metrics, test results, or evidence the decision worked
8. **Link related ADRs**: Reference related decisions
9. **Commit with PR**: ADRs should go through code review like code

## Example Y-Statement

> In the context of enabling multi-language AST support,  
> facing the problem that hardcoded language logic prevents scalability,  
> we decided for implementing the Strategy Pattern with a LanguageTraverser interface  
> to achieve complete isolation of language-specific traversal logic,  
> accepting the upfront cost of interface design for long-term maintainability.

## ADR Lifecycle

- **Proposed**: Decision under discussion
- **Accepted**: Decision approved and implemented
- **Rejected**: Decision considered but not chosen
- **Deprecated**: Decision no longer applicable
- **Superseded**: Replaced by a newer ADR (link to replacement)

## Questions?

See [adr.github.io](https://adr.github.io/) for more guidance on writing ADRs, or review existing ADRs in this directory for examples.

---

**Tip**: ADRs are living documents. If a decision changes significantly, create a new ADR that supersedes the old one rather than editing the original.

