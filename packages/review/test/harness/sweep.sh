#!/usr/bin/env bash
# Multi-model sweep across all canary fixtures.
# Usage: OPENROUTER_API_KEY=… ./sweep.sh [model1 model2 ...]
# Default models: google/gemini-2.5-flash google/gemini-3-flash-preview
#
# A calibration that misses the 9/10 bar exits non-zero — that's expected
# data, not a script error. So we deliberately do NOT use `set -e` here.
set -uo pipefail

# Fail-fast preconditions — these surface clearly instead of producing
# misleading "writing results to /tmp/sweep-…" with no actual results.

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "sweep.sh: could not resolve repository root (is this a git checkout?)" >&2
  exit 1
}
cd "$REPO_ROOT" || {
  echo "sweep.sh: could not cd to $REPO_ROOT" >&2
  exit 1
}

# OpenRouter mode (which is what sweep.sh drives) auto-loads
# OPENROUTER_API_KEY from .env via process.loadEnvFile() in run.ts. If
# neither env nor .env supplies it, fail before burning subprocess startup
# time.
if [ -z "${OPENROUTER_API_KEY:-}" ] && [ ! -f "$REPO_ROOT/.env" ]; then
  echo "sweep.sh: OPENROUTER_API_KEY is not set and no .env found at repo root" >&2
  echo "         (set it inline, in your shell rc, or in .env at the repo root)" >&2
  exit 1
fi

ROOT=packages/review/test/harness/fixtures
if [ "$#" -gt 0 ]; then
  MODELS=("$@")
else
  MODELS=(google/gemini-2.5-flash google/gemini-3-flash-preview)
fi

# Portable equivalent of `mapfile` (bash 3.2 on macOS lacks it).
FIXTURES=()
while IFS= read -r line; do
  FIXTURES+=("$line")
done < <(find "$ROOT" -name "*.fixture.json" ! -name "placeholder*" | sort)

if [ ${#FIXTURES[@]} -eq 0 ]; then
  echo "No fixtures found under $ROOT (regenerate via capture-pr.ts)" >&2
  exit 1
fi

OUT="${SWEEP_OUT:-/tmp/sweep-$(date +%Y%m%d-%H%M%S).txt}"
> "$OUT"
echo "writing results to $OUT" >&2

for fixture in "${FIXTURES[@]}"; do
  rel=${fixture#"$ROOT/"}
  rel=${rel%.fixture.json}
  for model in "${MODELS[@]}"; do
    {
      echo "=== $rel × $model ==="
      # `|| true` so a sub-9/10 calibration (npm exit 1) doesn't stop the sweep.
      # `grep` may also exit 1 if no lines matched (rare); tolerate that too.
      npm run test:harness -w @liendev/review --silent -- \
        --fixture "$fixture" --calibrate 10 --model "$model" 2>&1 \
        | grep -E "passed|failures|Total cost|first failure" || true
      echo ""
    } | tee -a "$OUT"
  done
done

echo "=== final ===" | tee -a "$OUT"
