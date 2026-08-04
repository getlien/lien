---
"@liendev/core": patch
"@liendev/lien": patch
---

`search_code`'s ranking now demotes test files by a fixed 0.8x multiplier (borrowed from zoekt's `_test.go` ranker rule), on top of the existing structural-importance boost. Global-centrality measurements across real corpora repeatedly surfaced test helpers and fixtures above the real source they exist to test — e.g. a heavily-cross-referenced test-database helper outranking the production class it configures. The demotion nudges ties and near-ties; it never excludes a test file from results, and a query naming a test file directly still finds it. Set `LIEN_TEST_FILE_RANKING=off` to disable it independently of the existing `LIEN_STRUCTURAL_RANKING` switch.
