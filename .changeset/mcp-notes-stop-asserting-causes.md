---
'@liendev/lien': patch
---

Two MCP notes asserted a cause they had not established — plausible, specific,
and wrong, which is the failure mode a consuming model cannot detect.

**`list_functions` / `search_code` blamed your query for a missing index.** With
gin's index moved aside, a search for `StringToBytes` — which unquestionably
exists — returned:

```json
"results": [], "note": "0 results. Try a broader regex pattern (e.g. \".*\")
or omit the symbolType filter. ... Run \"lien index\" to enable faster
symbol-based queries."
```

Three compounding problems: the advice asserted the search had *run* and the
query was at fault; "to enable **faster** queries" framed indexing as a
performance upgrade when it was a correctness prerequisite; and `indexInfo` in the
same payload advertised an index dated *today* with `pendingFileCount: 0`, so
nothing contradicted a "fresh index, symbol absent" reading.

Both tools now call `vectorDB.hasData()` on a zero-result response. A genuinely
empty index escalates to an unmissable `⚠ Lien:` warning (new
`formatNoIndexNote()`, reusing the pattern `get_dependents` already had from
#927). An index that is present but has no match for this query hedges instead of
blaming the query — which also covers the far more common case found during the
dogfood: **an index that simply hasn't caught up with a recent edit.** Appending a
function to flask's `helpers.py` and searching for it immediately returned zero
results with the query-tuning advice, while `indexInfo` reported a 2.7-second-old
reindex and `pendingFileCount: 0`. An agent that writes a function and cannot then
find it will conclude it misnamed something.

**`get_dependents` claimed a symbol was "likely a method or constructor" when it
had never existed.** The `symbol-attribution-degraded` caveat emitted one
hardcoded explanation for at least three distinct causes — a real
method/constructor, a typo'd or hallucinated name, and a symbol that was removed.
Byte-identical wording for `totallyMadeUpSymbolXYZ123` (which appears nowhere in
the repo) and for a genuine constructor. Those readings warrant opposite next
actions: "proceed with the file-level answer" versus "check the name". The caveat
now checks whether the symbol appears anywhere in the target file's indexed chunks
and words each case honestly, keeping the genuinely useful part — that the numbers
below are file-level, not verified symbol callers — unchanged either way.

Both `SERVER_INSTRUCTIONS` and the `tools.ts` tool descriptions carried the same
overclaim and were corrected. The `tools.ts` half was itself caught by Lien Review
on the first pass of this fix, which had updated only `instructions.ts` — the two
surfaces a model reads must move together.
