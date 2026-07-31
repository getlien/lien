import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ATTRIBUTION_CAVEAT_REASONS,
  ATTRIBUTION_CAVEAT_REASON_TEXT,
} from './attribution-caveat-reasons.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { tools } from './tools.js';

/**
 * Guards the #980 failure mode: a model/user-facing prose surface silently
 * omitting a member of the `AttributionCaveatReason` union. #930 added
 * `dependent-attribution-partial` to the union; it never made it into
 * `site/docs/guide/mcp-tools.md`, which even asserted "reason is one of"
 * followed by only three names. Neither the "Docs Truth" CI check nor the
 * docs-drift review pass caught the omission -- both check the *accuracy*
 * of what's written, not its *completeness* against the union.
 *
 * If a fifth reason is ever added to `AttributionCaveatReason`, the tests
 * below fail loudly on every surface that hasn't been updated to mention it
 * -- rather than silently shipping documentation describing fewer reasons
 * than actually exist. (`ATTRIBUTION_CAVEAT_REASONS` itself can't silently
 * fall behind the union either -- see its doc comment in
 * `attribution-caveat-reasons.ts`.)
 */

/** Walk up from `startDir` looking for the repo root (has `packages/site/docs`). */
function findRepoRoot(startDir: string): string | null {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'packages', 'site', 'docs', 'guide', 'mcp-tools.md'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

const repoRoot = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const getDependentsTool = tools.find(t => t.name === 'get_dependents');
if (!getDependentsTool) {
  throw new Error('get_dependents tool definition not found in tools.ts');
}
const getDependentsDescription = getDependentsTool.description;

describe('AttributionCaveatReason union completeness across prose surfaces', () => {
  it('ATTRIBUTION_CAVEAT_REASON_TEXT has an entry for every reason (sanity check)', () => {
    for (const reason of ATTRIBUTION_CAVEAT_REASONS) {
      expect(ATTRIBUTION_CAVEAT_REASON_TEXT[reason]).toBeTruthy();
    }
  });

  it.each(ATTRIBUTION_CAVEAT_REASONS)(
    'SERVER_INSTRUCTIONS (instructions.ts) mentions "%s"',
    reason => {
      expect(SERVER_INSTRUCTIONS).toContain(reason);
    },
  );

  it.each(ATTRIBUTION_CAVEAT_REASONS)(
    'the get_dependents tool description (tools.ts) mentions "%s"',
    reason => {
      expect(getDependentsDescription).toContain(reason);
    },
  );

  if (!repoRoot) {
    it.skip('SKIPPED: repo root not found by walking up from this file — not running inside a lien repo checkout', () => {});
  } else {
    const docsPath = join(repoRoot, 'packages', 'site', 'docs', 'guide', 'mcp-tools.md');
    const docsText = readFileSync(docsPath, 'utf8');

    it.each(ATTRIBUTION_CAVEAT_REASONS)(
      'the public docs page (site/docs/guide/mcp-tools.md) mentions "%s"',
      reason => {
        expect(docsText).toContain(reason);
      },
    );
  }
});
