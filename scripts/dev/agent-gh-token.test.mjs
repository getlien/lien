// Unit tests for agent-gh-token.mjs's pure/injectable pieces: JWT
// construction and token-cache expiry/round-trip logic. No real GitHub API
// calls and no real App key -- the JWT test signs against a throwaway RSA
// keypair generated in-process, and the cache tests use a temp directory.
//
// Run: node --test scripts/dev/agent-gh-token.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildAppJwt, isTokenFresh, readCache, writeCache } from './agent-gh-token.mjs';

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

test('buildAppJwt produces a header/payload/signature that verifies against the public key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const nowMs = Date.parse('2026-07-16T12:00:00.000Z');

  const jwt = buildAppJwt({ appId: 123456, privateKeyPem: privateKey, now: nowMs });
  const [headerSeg, payloadSeg, signatureSeg] = jwt.split('.');

  const header = decodeSegment(headerSeg);
  assert.equal(header.alg, 'RS256');
  assert.equal(header.typ, 'JWT');

  const payload = decodeSegment(payloadSeg);
  const nowSeconds = Math.floor(nowMs / 1000);
  assert.equal(payload.iss, '123456');
  assert.equal(payload.iat, nowSeconds - 60, 'iat should be backdated 60s for clock drift');
  assert.equal(
    payload.exp,
    nowSeconds + 9 * 60,
    'exp should be 9 minutes out (under the 10min cap)',
  );
  assert.ok(payload.exp - payload.iat <= 600, "lifetime must not exceed GitHub's 10-minute cap");

  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = Buffer.from(signatureSeg, 'base64url');
  const verifier = createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  assert.ok(verifier.verify(publicKey, signature), 'signature must verify against the public key');
});

test('buildAppJwt coerces a string appId into the iss claim unchanged', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = buildAppJwt({ appId: '999', privateKeyPem: privateKey, now: Date.now() });
  const payload = decodeSegment(jwt.split('.')[1]);
  assert.equal(payload.iss, '999');
});

test('isTokenFresh: null/undefined cache entries are never fresh', () => {
  assert.equal(isTokenFresh(null), false);
  assert.equal(isTokenFresh(undefined), false);
  assert.equal(isTokenFresh({}), false);
  assert.equal(isTokenFresh({ token: 'abc' }), false, 'missing expiresAt');
  assert.equal(isTokenFresh({ expiresAt: '2026-07-16T12:00:00.000Z' }), false, 'missing token');
});

test('isTokenFresh: malformed expiresAt is treated as not fresh', () => {
  const entry = { token: 'abc', expiresAt: 'not-a-date' };
  assert.equal(isTokenFresh(entry, Date.now()), false);
});

test('isTokenFresh: respects the refresh margin with an injected clock', () => {
  const now = Date.parse('2026-07-16T12:00:00.000Z');
  const margin = 5 * 60 * 1000;

  const wellWithinExpiry = {
    token: 'abc',
    expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
  };
  assert.equal(isTokenFresh(wellWithinExpiry, now, margin), true);

  const withinMargin = { token: 'abc', expiresAt: new Date(now + 4 * 60 * 1000).toISOString() };
  assert.equal(isTokenFresh(withinMargin, now, margin), false, '<5min left should not be fresh');

  const alreadyExpired = { token: 'abc', expiresAt: new Date(now - 60 * 1000).toISOString() };
  assert.equal(isTokenFresh(alreadyExpired, now, margin), false);

  const exactlyAtMargin = { token: 'abc', expiresAt: new Date(now + margin).toISOString() };
  assert.equal(
    isTokenFresh(exactlyAtMargin, now, margin),
    false,
    'boundary must not count as fresh',
  );
});

test('writeCache/readCache round-trip and lock the file to owner-only permissions', t => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-gh-token-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cachePath = join(dir, 'nested', 'agent-gh-token-cache.json');

  const data = { installationId: 42, token: 'ghs_fake', expiresAt: '2026-07-16T13:00:00.000Z' };
  writeCache(cachePath, data);

  assert.deepEqual(readCache(cachePath), data);

  if (process.platform !== 'win32') {
    const mode = statSync(cachePath).mode & 0o777;
    assert.equal(mode, 0o600, 'cache file must be owner-read/write only');
  }
});

test('readCache returns null for a missing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-gh-token-test-'));
  try {
    assert.equal(readCache(join(dir, 'does-not-exist.json')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readCache returns null for corrupt JSON instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-gh-token-test-'));
  try {
    const cachePath = join(dir, 'corrupt.json');
    writeFileSync(cachePath, '{ not valid json');
    assert.equal(readCache(cachePath), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeCache overwrites permissions to 0600 even if the file pre-existed with looser perms', t => {
  if (process.platform === 'win32') {
    t.skip('POSIX file mode assertions do not apply on win32');
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), 'agent-gh-token-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cachePath = join(dir, 'agent-gh-token-cache.json');

  writeFileSync(cachePath, '{}', { mode: 0o644 });
  writeCache(cachePath, { installationId: 1, token: 'x', expiresAt: '2026-07-16T13:00:00.000Z' });

  const mode = statSync(cachePath).mode & 0o777;
  assert.equal(mode, 0o600);
});
