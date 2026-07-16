#!/usr/bin/env node
// Mints a short-lived GitHub App installation access token for agent-driven
// `gh`/API calls against getlien/lien, so agent actions (label, comment,
// merge, PR create) render as `lien-agents[bot]` in the audit trail instead
// of the operator's own account. See docs/development/agent-bot-identity.md
// for the app-creation checklist, the permission-to-action mapping, and the
// post-creation verification recipe.
//
// Usage (composes into any `gh` invocation):
//   GH_TOKEN=$(node scripts/dev/agent-gh-token.mjs) gh pr merge 123 --squash
//
// Prints ONLY the installation access token to stdout -- nothing else -- so
// the command above works. All diagnostics go to stderr.
//
// Config (read from the environment, or from a repo-root .env -- same
// convention as OPENROUTER_API_KEY; see packages/review/test/harness/run.ts):
//   LIEN_AGENT_APP_ID       - the GitHub App's numeric ID
//   LIEN_AGENT_APP_KEY_PATH - path to the App's PEM private key. The PEM
//                             lives OUTSIDE the repo (e.g.
//                             ~/.config/lien/agent-app.pem) -- never commit it.
//
// No npm dependencies: JWT signing uses node:crypto directly, and the
// installation-token exchange uses the global fetch() built into Node 22+.

import { createSign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../..');
const DOCS_PATH = 'docs/development/agent-bot-identity.md';
const GITHUB_ORG = 'getlien';
const GITHUB_API = 'https://api.github.com';
const CACHE_PATH = join(homedir(), '.cache', 'lien', 'agent-gh-token-cache.json');

// GitHub caps JWT lifetime at 10 minutes (exp - "now", not exp - iat) and
// recommends backdating `iat` by 60s to tolerate clock drift between this
// machine and GitHub's servers. 9 minutes keeps a safety margin under the cap
// even with the backdated `iat`. Source: GitHub's "Generating a JSON Web
// Token (JWT) for a GitHub App" docs.
const JWT_TTL_SECONDS = 9 * 60;
const JWT_CLOCK_SKEW_SECONDS = 60;

// Installation tokens last 1h; refresh once less than this remains.
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

const USER_AGENT = 'lien-agent-gh-token';

// Auto-load .env from the repo root, same convention as the review harness
// (packages/review/test/harness/run.ts). Node's loadEnvFile() does not
// override variables already set in the environment, so an inline
// `LIEN_AGENT_APP_ID=... node scripts/dev/agent-gh-token.mjs` still wins.
try {
  process.loadEnvFile(join(REPO_ROOT, '.env'));
} catch {
  /* no .env at repo root -- that's fine; rely on the inherited environment */
}

function fail(message) {
  console.error(`[agent-gh-token] ${message}`);
  console.error(`[agent-gh-token] See ${DOCS_PATH} for setup instructions.`);
  process.exit(1);
}

function expandHome(path) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function base64url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buffer.toString('base64url');
}

/**
 * Builds a signed RS256 JWT per GitHub's App-authentication spec. Exported
 * (pure, no I/O) so it can be unit-tested against a throwaway RSA keypair
 * without touching the network or a real App key.
 */
export function buildAppJwt({ appId, privateKeyPem, now = Date.now() }) {
  const nowSeconds = Math.floor(now / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iat: nowSeconds - JWT_CLOCK_SKEW_SECONDS,
    exp: nowSeconds + JWT_TTL_SECONDS,
    iss: String(appId),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

/**
 * Returns true when a cached token has more than `marginMs` left before
 * expiry. Pure and clock-injectable so cache-expiry logic is unit-testable
 * without waiting on a real clock or minting a real token.
 */
export function isTokenFresh(cacheEntry, now = Date.now(), marginMs = TOKEN_REFRESH_MARGIN_MS) {
  if (!cacheEntry || !cacheEntry.token || !cacheEntry.expiresAt) return false;
  const expiresAtMs = Date.parse(cacheEntry.expiresAt);
  if (Number.isNaN(expiresAtMs)) return false;
  return expiresAtMs - now > marginMs;
}

/** Reads the token cache. Returns null on a missing or corrupt cache file. */
export function readCache(cachePath) {
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Writes the token cache and locks it down to owner-only (0600) -- it holds
 * a live, if short-lived, API token. `writeFileSync`'s `mode` option only
 * applies when the file is newly created, so an explicit chmod covers the
 * case where a looser-permissioned cache file already exists.
 */
export function writeCache(cachePath, data) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  chmodSync(cachePath, 0o600);
}

async function githubRequest(method, path, jwt, body) {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': USER_AGENT,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${method} ${path} -> ${res.status} ${res.statusText}: ${text}`);
  }
  return res.json();
}

/** Resolves the installation id for GITHUB_ORG via GET /app/installations. */
async function resolveInstallationId(jwt) {
  const installations = await githubRequest('GET', '/app/installations', jwt);
  const match = installations.find(
    installation => installation.account?.login?.toLowerCase() === GITHUB_ORG,
  );
  if (!match) {
    const logins = installations.map(installation => installation.account?.login).join(', ');
    throw new Error(
      `no installation found for the "${GITHUB_ORG}" org (installations found: ${logins || '(none)'}). ` +
        'Has the GitHub App been installed on the org yet?',
    );
  }
  return match.id;
}

/** Exchanges the App JWT for an installation access token. */
async function mintInstallationToken(jwt, installationId) {
  return githubRequest('POST', `/app/installations/${installationId}/access_tokens`, jwt);
}

async function main() {
  const appId = process.env.LIEN_AGENT_APP_ID;
  const keyPathRaw = process.env.LIEN_AGENT_APP_KEY_PATH;

  if (!appId || !keyPathRaw) {
    fail(
      'missing LIEN_AGENT_APP_ID and/or LIEN_AGENT_APP_KEY_PATH. ' +
        'Set both in the environment, or add them to the repo-root .env file.',
    );
  }

  const keyPath = expandHome(keyPathRaw);
  if (!existsSync(keyPath)) {
    fail(`LIEN_AGENT_APP_KEY_PATH points at "${keyPath}", but no file exists there.`);
  }

  const cache = readCache(CACHE_PATH);
  if (isTokenFresh(cache)) {
    process.stdout.write(cache.token + '\n');
    return;
  }

  const privateKeyPem = readFileSync(keyPath, 'utf8');
  const jwt = buildAppJwt({ appId, privateKeyPem });

  let installationId = cache?.installationId;
  if (!installationId) {
    try {
      installationId = await resolveInstallationId(jwt);
    } catch (err) {
      fail(`could not resolve the installation id: ${err.message}`);
    }
  }

  let tokenResponse;
  try {
    tokenResponse = await mintInstallationToken(jwt, installationId);
  } catch {
    // The cached installation id may be stale (app reinstalled/uninstalled) --
    // re-resolve once before giving up.
    try {
      installationId = await resolveInstallationId(jwt);
      tokenResponse = await mintInstallationToken(jwt, installationId);
    } catch (retryErr) {
      fail(`could not mint an installation access token: ${retryErr.message}`);
    }
  }

  writeCache(CACHE_PATH, {
    installationId,
    token: tokenResponse.token,
    expiresAt: tokenResponse.expires_at,
  });

  process.stdout.write(tokenResponse.token + '\n');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch(err => fail(err.message || String(err)));
}
