---
'@liendev/lien': minor
---

Add `lien health`, which ranks the functions that are risky to change rather than listing everything over a threshold.

`lien complexity` orders violations by how far over a line they sit, which says nothing about whether anything depends on the code or whether a test would catch you breaking it. `lien health` joins three axes — cognitive complexity, fan-in, and test associations — and prints five, with the shape of that triple driving the recommendation: complex and widely depended on and untested means test it first; the same with tests means split before extending; simple but widely depended on and untested is a cheap win.

It reads the working tree directly, with no persisted index, and never exits non-zero because of what it found — `lien complexity --fail-on` and `lien delta` remain the gates. (A bad flag still exits 1, as any CLI should.) Flags: `--top`, `--path`, `--include-tests`, `--format text|json`.
