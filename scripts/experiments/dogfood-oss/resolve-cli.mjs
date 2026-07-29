/**
 * Single source of truth for WHICH lien build the dogfood kit measures.
 *
 * Every script here used to compute this itself as
 * `path.join(REPO, 'packages/cli/dist/index.js')`, where REPO is resolved from the
 * script's own location. That silently measures whichever worktree the script was
 * copied into, and it cannot target a published artifact at all — the two failure
 * modes that produced false conclusions in round 1 of the foreign-repo dogfood
 * (a working fix reported as broken, twice) and again in round 2 (a stale ambient
 * build's answers attributed to the current release).
 *
 * `mcp-call.mjs` was fixed in isolation first, which left `trial.mjs` and
 * `provision.mjs` on the old hardcoded path — Lien Review caught exactly that on
 * the PR and the finding was dismissed as noise; hours later a trial run hit it and
 * had to hand-patch a copy of `trial.mjs` to point at the published build. Hence one
 * shared resolver rather than three conditionals: the whole class of bug this kit
 * keeps rediscovering is "a decision implemented at N sites, fixed at fewer than N."
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolve the CLI entry point under measurement.
 *
 * Precedence:
 *   1. LIEN_DOGFOOD_CLI  — the target build (e.g. a published npm install)
 *   2. LIEN_MCP_CLI      — legacy alias, kept because it is documented in PR #944
 *                          and in the round-2 report; prefer the name above
 *   3. <repoRoot>/packages/cli/dist/index.js — this checkout's local build
 *
 * @param {string} repoRoot absolute path to the lien checkout the caller belongs to
 * @returns {{ cli: string, source: 'LIEN_DOGFOOD_CLI'|'LIEN_MCP_CLI'|'local-build' }}
 */
export function resolveCli(repoRoot) {
  const override = process.env.LIEN_DOGFOOD_CLI || process.env.LIEN_MCP_CLI;
  if (override) {
    return {
      cli: path.resolve(override),
      source: process.env.LIEN_DOGFOOD_CLI ? 'LIEN_DOGFOOD_CLI' : 'LIEN_MCP_CLI',
    };
  }
  return { cli: path.join(repoRoot, 'packages/cli/dist/index.js'), source: 'local-build' };
}

/**
 * Fail loudly when the resolved CLI does not exist, naming the override that chose
 * it. A missing published artifact and a missing local build need different fixes,
 * so the message has to say which one was asked for.
 *
 * @param {{ cli: string, source: string }} resolved
 * @param {string} scriptName for the error prefix
 */
export function assertCliExists(resolved, scriptName) {
  if (fs.existsSync(resolved.cli)) return;
  const hint =
    resolved.source === 'local-build'
      ? 'run `npm run build` first, or set LIEN_DOGFOOD_CLI to a built artifact'
      : `from ${resolved.source}`;
  console.error(`${scriptName}: CLI not found at ${resolved.cli} — ${hint}`);
  process.exit(1);
}
