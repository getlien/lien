# @liendev/action

## 0.1.11

### Patch Changes

- Updated dependencies [ead2bc9]
  - @liendev/parser@0.67.0
  - @liendev/review@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies [8175bf5]
  - @liendev/parser@0.66.0
  - @liendev/review@0.1.10

## 0.1.9

### Patch Changes

- Updated dependencies [c6abb00]
  - @liendev/parser@0.64.0
  - @liendev/review@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies [2b2e259]
  - @liendev/parser@0.62.0
  - @liendev/review@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies [5789e1c]
- Updated dependencies [e6efbb3]
- Updated dependencies [a39644a]
  - @liendev/parser@0.61.0
  - @liendev/review@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [68e98ef]
  - @liendev/parser@0.59.0
  - @liendev/review@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [6e502dd]
  - @liendev/parser@0.58.0
  - @liendev/review@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies [d36fb55]
  - @liendev/parser@0.57.0
  - @liendev/review@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies [297883e]
  - @liendev/parser@0.52.0
  - @liendev/review@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies [57d1529]
  - @liendev/parser@0.51.2
  - @liendev/review@0.1.2

## 0.1.1

### Patch Changes

- ca61516: Pin `@liendev/*` sibling dependencies to a real semver range instead of `"*"`.

  `packages/cli/package.json` (published as `@liendev/lien`) declared `@liendev/core` and `@liendev/parser` as `"*"`, and `packages/core/package.json` declared `@liendev/parser` as `"*"`. Since `"*"` is never rewritten at publish time, npm installs of `@liendev/lien` could resolve to whatever `@liendev/core`/`@liendev/parser` happens to be latest on npm at install time — not the versions `lien` was actually built and tested against. This is the same `"*"`-in-published-package.json family as the earlier phantom `@liendev/review` dependency bug (#620).

  It worked so far mostly by luck (packages are usually published together in the same release), but the drift is real: `@liendev/parser` is currently stuck at `0.50.0` on npm while `@liendev/core`/`@liendev/lien` are at `0.51.0`.

  Fixed by replacing every `"*"` cross-package reference with the actual current semver range (e.g. `^0.51.0`), for both published packages (`cli`, `core`) and private ones (`review`, `action`) for consistency. `changeset`'s `updateInternalDependencies: "patch"` will now correctly keep these ranges in sync on future releases, since a `"*"` range is never considered "violated" and was silently defeating that mechanism.

  Note: `workspace:*` (the pnpm/yarn workspace protocol) is not usable here — this repo uses plain npm workspaces, and npm has no equivalent rewrite step; `npm install --package-lock-only` fails immediately with `EUNSUPPORTEDPROTOCOL` if you try it. A real pinned range is the correct fix for npm workspaces.

- Updated dependencies [ca61516]
  - @liendev/review@0.1.1
