---
"@liendev/lien": patch
---

Fix `get_dependents`'s `attributionCaveat.reason` prose, which had drifted
out of sync across its five model-facing surfaces (#980). `#941` wrote the
explanation into three surfaces at once; `#951` fixed two of them and
needed a second sub-commit for the third; two surfaces were never revisited
and were still wrong at HEAD:

- The `symbol` parameter's JSON Schema description (read by every MCP
  client on connect) still had the pre-`#951` unhedged wording — it didn't
  mention that an unconfirmed symbol may simply be a typo, a hallucinated
  name, or a removed one, rather than always a real method/constructor.
- The `AttributionCaveatReason` type's JSDoc (dev-facing) had the same gap.

Both now carry the same hedge already present in the tool description and
server instructions.

Consolidated all four reasons' explanatory text into one exported record
(`ATTRIBUTION_CAVEAT_REASON_TEXT` in `packages/cli/src/mcp/attribution-caveat-reasons.ts`,
keyed by `AttributionCaveatReason` so the compiler rejects a stale entry
count), and had the tool description, server instructions, and JSON Schema
description all interpolate it instead of hand-writing the explanation
again — closing off the exact drift pattern that caused this bug three
times in a row.

Also fixes the public docs page
(`packages/site/docs/guide/mcp-tools.md`), which asserted `reason` is "one
of" a list of exactly three names — `dependent-attribution-partial`
(added by `#930`) appeared zero times in the file, leaving no documented
way to interpret the `confidence: "inferred"` entries that reason implies.
Added a test (`attribution-caveat-reasons.test.ts`) asserting the docs
page, the server instructions, and the tool description each mention
every member of the `AttributionCaveatReason` union, so a future fifth
reason fails CI on any surface that isn't updated, rather than shipping
silently incomplete.
