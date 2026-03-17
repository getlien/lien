#!/bin/bash
set -euo pipefail

# Build and push Docker images to DOCR.
# Usage: ./.infra/scripts/push-images.sh <tag>
# Example: ./.infra/scripts/push-images.sh v0.1.0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
REGISTRY="registry.digitalocean.com/getlien"

TAG="${1:?Usage: push-images.sh <tag>}"

echo "==> Authenticating with DOCR..."
doctl registry login

PLATFORM="linux/amd64"

LIEN_REPO="$(dirname "$PROJECT_ROOT")"

if [[ ! -d "$LIEN_REPO/packages/runner" ]]; then
  echo "ERROR: packages/runner not found at $LIEN_REPO/packages/runner" >&2
  echo "       Expected monorepo root at $LIEN_REPO" >&2
  exit 1
fi

echo "==> Building images in parallel ($PLATFORM)..."
DOCKER_BUILDKIT=1 docker build --platform "$PLATFORM" -t "$REGISTRY/lien-platform:$TAG" \
  -f "$PROJECT_ROOT/docker/Dockerfile" "$PROJECT_ROOT" &
PID_PLATFORM=$!
DOCKER_BUILDKIT=1 docker build --platform "$PLATFORM" -t "$REGISTRY/lien-runner:$TAG" \
  -f "$LIEN_REPO/packages/runner/Dockerfile" "$LIEN_REPO" &
PID_RUNNER=$!

wait $PID_PLATFORM || { echo "ERROR: Platform build failed" >&2; kill $PID_RUNNER 2>/dev/null; exit 1; }
echo "    Platform image built."
wait $PID_RUNNER || { echo "ERROR: Runner build failed" >&2; exit 1; }
echo "    Runner image built."

echo "==> Pushing images..."
docker push "$REGISTRY/lien-platform:$TAG"
docker push "$REGISTRY/lien-runner:$TAG"

echo ""
echo "==> Images pushed:"
echo "    $REGISTRY/lien-platform:$TAG"
echo "    $REGISTRY/lien-runner:$TAG"
