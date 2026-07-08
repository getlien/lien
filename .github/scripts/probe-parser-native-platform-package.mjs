#!/usr/bin/env node
// Probes that @liendev/parser-native resolved its per-platform npm package
// (index.js's resolution order #1), not the local-dev-binary fallback (#2).
// Used by ci.yml's release-smoke-test job: the scratch consumer it runs in
// has no ./parser-native.node anywhere, so a successful parseTree() call
// here is only reachable via the platform-package require() path.
//
// Deliberately imports @liendev/parser-native directly rather than going
// through @liendev/parser with LIEN_PARSER=native: that flag and the
// @liendev/parser adapter swap don't exist yet -- ADR-013 stages them for
// Phase 3 ("flagged swap"). This probe is for Phase 1 ("foundation").
// Revisit once Phase 3 lands.
//
// Run with cwd = the scratch consumer directory that installed
// @liendev/parser-native + its platform package (see ci.yml).

import { parseTree } from '@liendev/parser-native';

const wire = JSON.parse(parseTree('javascript', 'const x = 1;'));
if (wire.type !== 'program') {
  throw new Error('unexpected root node type: ' + wire.type);
}
console.log('parser-native platform-package probe OK');
