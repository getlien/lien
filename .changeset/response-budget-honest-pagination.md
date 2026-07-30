---
'@liendev/lien': minor
---

`list_functions` and `find_similar` reported result counts that could not be
trusted, and — worse — hid real truncation. **This changes the response
contract for `nextOffset`, so callers that computed their own offsets should
read the note below.**

Three distinct defects, all in `applyResponseBudget`
(`packages/cli/src/mcp/utils/response-budget.ts`), which builds its note from an
array the handler had *already* capped by the request's own `limit`:

1. **A total that tracked the request, not reality.** On sidekiq (true total:
   703 symbols) the same `pattern: ".*"` query reported `Showing 23 of 50` at
   `limit: 50` and `Showing 23 of 200` at `limit: 200`. Literally true — 23 of
   the N fetched — but any reader takes the denominator as the total, so it
   understated 703 by more than an order of magnitude. The note no longer states
   a total at all; it reports only what the size cap itself dropped.
2. **Silent truncation.** At `limit: 10` the page genuinely *was* cut off and
   the tool said nothing. `hasMore` is now forced true whenever items are
   dropped, so a stale upstream `hasMore: false` cannot survive a trim, and
   `list_functions` emits a note for the previously-silent case.
3. **A pagination cursor that skipped items.** `nextOffset` was computed as
   `offset + limit` *before* the size cap ran, so following the tool's own advice
   after a trimmed page silently skipped the dropped entries. Verified on an
   isolated sidekiq clone: page 0 returned 24 items and advised `offset: 50`,
   losing 26 real symbols. `nextOffset` is now corrected by the same drop count
   and always equals `offset + items actually delivered`.

**Contract change:** `nextOffset` is now present whenever `results` is non-empty,
**regardless of `hasMore`** — previously it appeared only when `hasMore` was true,
which meant a final page that the size cap then trimmed ended up `hasMore: true`
with no cursor at all and no way to reach the rest. `hasMore` now answers "is it
worth paging?" and `nextOffset` answers "where would I resume?". Always pass
`nextOffset` back verbatim rather than computing `offset + limit` yourself; the
size cap can shrink a page after the fact and only that field is corrected for it.
`tools.ts` documents this.

Also documented (behaviour unchanged): `list_functions` pattern matching is
case-insensitive and unranked, which was previously undocumented and interacted
badly with the bogus totals — a real `class Request` in Alamofire didn't surface
until `offset: 50`, behind lowercase test-method matches, while the "total" was
misleading throughout.
