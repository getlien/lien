#!/usr/bin/env bash
#
# Post-publish registry smoke test for @liendev packages.
#
# WHY THIS EXISTS: the CI `release-smoke-test` job (.github/workflows/ci.yml)
# installs packed LOCAL tarballs into a scratch project, which proves the
# packages install together as a *matched set* -- but it can never catch
# resolution skew against whatever is already live on the npm registry. That
# blind spot is exactly what shipped @liendev/core 0.55.0/0.56.0: they
# imported `getIndexDir` from @liendev/parser, but parser had not been
# republished with that export, so every fresh `npx @liendev/lien@latest
# serve` crashed at startup with a missing-export SyntaxError. This script
# installs the just-published version(s) FROM THE REGISTRY, in a directory
# with no workspace/lockfile to fall back on, and boot-probes the result --
# the same path a real first-time `npx @liendev/lien` user takes.
#
# Usage:
#   PUBLISHED_PACKAGES='[{"name":"@liendev/lien","version":"1.2.3"}]' \
#     .github/scripts/registry-smoke.sh
#
#   LIEN_VERSION=1.2.3 .github/scripts/registry-smoke.sh   # manual/local override,
#                                                           # skips PUBLISHED_PACKAGES parsing
#
# A non-zero exit here means the just-published release is broken for fresh
# installs. It cannot be rolled back (npm publishes are immutable) -- see the
# remediation banner below.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REGISTRY="https://registry.npmjs.org/"
PROBE_TIMEOUT_MS="${MCP_PROBE_TIMEOUT_MS:-90000}"
CONSUMER_DIR=""

remediation() {
  cat >&2 <<'EOF'

================================================================================
POST-PUBLISH REGISTRY SMOKE TEST FAILED.

The just-published @liendev package(s) are broken for a fresh registry
install. This CANNOT be rolled back -- npm publishes are immutable. The
manual remediation is to deprecate the broken version(s) so npm/npx warns
consumers away from them, e.g.:

  npm deprecate @liendev/lien@<version>   "broken release, use <next-version> instead"
  npm deprecate @liendev/core@<version>   "broken release, use <next-version> instead"
  npm deprecate @liendev/parser@<version> "broken release, use <next-version> instead"

then ship a fixed patch release through the normal changesets flow.
================================================================================
EOF
}

cleanup() {
  [ -n "$CONSUMER_DIR" ] && rm -rf "$CONSUMER_DIR"
}

trap cleanup EXIT
trap remediation ERR

echo "== Resolving target @liendev/lien version to smoke-test =="

if [ -n "${LIEN_VERSION:-}" ]; then
  REQUESTED="$LIEN_VERSION"
  echo "Using explicit override LIEN_VERSION=$REQUESTED"
elif [ -n "${PUBLISHED_PACKAGES:-}" ]; then
  REQUESTED="$(node -e "
    const pkgs = JSON.parse(process.env.PUBLISHED_PACKAGES);
    if (!Array.isArray(pkgs)) {
      throw new Error('PUBLISHED_PACKAGES is not a JSON array: ' + process.env.PUBLISHED_PACKAGES);
    }
    const lien = pkgs.find(p => p && p.name === '@liendev/lien');
    if (lien && typeof lien.version !== 'string') {
      throw new Error('publishedPackages entry for @liendev/lien has no version: ' + JSON.stringify(lien));
    }
    console.log(lien ? lien.version : 'latest');
  ")"
  if [ "$REQUESTED" = "latest" ]; then
    echo "@liendev/lien was not among the published packages -- falling back to the" \
      "'latest' dist-tag to verify it pulls in the newly published sibling(s) via" \
      "its semver ranges."
  else
    echo "@liendev/lien@$REQUESTED was published -- smoke-testing that exact version."
  fi
else
  echo "Neither LIEN_VERSION nor PUBLISHED_PACKAGES was provided." >&2
  exit 1
fi

echo "== Waiting for registry propagation =="
V=""
for attempt in $(seq 1 10); do
  if RESOLVED="$(npm view --registry "$REGISTRY" "@liendev/lien@${REQUESTED}" version 2>/dev/null)" \
    && [ -n "$RESOLVED" ]; then
    V="$RESOLVED"
    echo "Resolved @liendev/lien@${REQUESTED} -> $V (attempt $attempt/10)"
    break
  fi
  echo "  attempt $attempt/10: @liendev/lien@${REQUESTED} not visible on the registry yet, retrying in 30s..."
  sleep 30
done

if [ -z "$V" ]; then
  echo "FAIL: @liendev/lien@${REQUESTED} never became visible on the registry after 10 attempts (5 minutes)." >&2
  exit 1
fi

echo "== Installing @liendev/lien@$V into a fresh, workspace-free consumer directory =="
CONSUMER_DIR="$(mktemp -d)"
(
  cd "$CONSUMER_DIR"
  npm init -y >/dev/null
  npm install --registry "$REGISTRY" --no-audit --no-fund "@liendev/lien@$V"
)

echo "== Probe 1: import integrity (the exact failure mode from the 0.55/0.56 incident) =="
cat >"$CONSUMER_DIR/probe-imports.mjs" <<'EOF'
const [core, parser] = await Promise.all([import('@liendev/core'), import('@liendev/parser')]);
if (typeof core !== 'object' || typeof parser !== 'object') {
  throw new Error('unexpected module shape from @liendev/core or @liendev/parser');
}
console.log('import probe OK');
EOF
(cd "$CONSUMER_DIR" && node probe-imports.mjs)

ACTUAL_VERSION="$("$CONSUMER_DIR/node_modules/.bin/lien" --version)"
if [ "$ACTUAL_VERSION" != "$V" ]; then
  echo "FAIL: expected 'lien --version' to print $V, got '$ACTUAL_VERSION'" >&2
  exit 1
fi
echo "lien --version OK ($ACTUAL_VERSION)"

echo "== Probe 2: MCP stdio boot (initialize handshake) =="
MCP_PROBE_TIMEOUT_MS="$PROBE_TIMEOUT_MS" node "$SCRIPT_DIR/mcp-initialize-probe.mjs" \
  "$CONSUMER_DIR/node_modules/.bin/lien" serve --root "$CONSUMER_DIR"

echo "== Registry smoke test passed for @liendev/lien@$V =="
