#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
NAMESPACE="lien"
IMAGE="lien-platform:latest"
RUNNER_IMAGE="lien-runner:latest"
LIEN_REPO="$(dirname "$PROJECT_ROOT")"
ENV_FILE="$PROJECT_ROOT/.env"

# Read a value from the .env file (returns empty string if key not found)
env_val() {
  local line
  line=$(grep -E "^${1}=" "$ENV_FILE" | head -1) || true
  if [[ -z "$line" ]]; then
    echo ""
    return
  fi
  echo "$line" | cut -d= -f2- | sed 's/^"\(.*\)"$/\1/' | sed "s/^\([^\"]*\)$/\1/"
}

# Guard: refuse to run against a production cluster
KUBE_CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
if [[ "$KUBE_CONTEXT" == *"digitalocean"* || "$KUBE_CONTEXT" == *"doks"* || "$KUBE_CONTEXT" == *"lien-k8s"* ]]; then
  echo "ERROR: kubectl context '$KUBE_CONTEXT' looks like production." >&2
  echo "       This script is for local development only." >&2
  echo "       Production deploys happen via GitHub Actions (deploy.yml)." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: .env file not found at $ENV_FILE" >&2
  echo "       Run 'cp .env.example .env' and fill in your values." >&2
  exit 1
fi

# Validate required keys
REQUIRED_KEYS=(APP_KEY APP_URL DB_USERNAME DB_PASSWORD GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET LIEN_SERVICE_TOKEN)
for key in "${REQUIRED_KEYS[@]}"; do
  val=$(env_val "$key")
  if [[ -z "$val" ]]; then
    echo "ERROR: Required key '$key' is missing or empty in $ENV_FILE" >&2
    exit 1
  fi
done

echo "==> Building Docker images in parallel..."
if [[ ! -d "$LIEN_REPO/packages/runner" ]]; then
  echo "ERROR: packages/runner not found at $LIEN_REPO/packages/runner" >&2
  echo "       Expected monorepo root at $LIEN_REPO" >&2
  exit 1
fi
DOCKER_BUILDKIT=1 docker build -t "$IMAGE" -f "$PROJECT_ROOT/docker/Dockerfile" "$PROJECT_ROOT" &
PID_PLATFORM=$!
DOCKER_BUILDKIT=1 docker build -t "$RUNNER_IMAGE" -f "$LIEN_REPO/packages/runner/Dockerfile" "$LIEN_REPO" &
PID_RUNNER=$!

wait $PID_PLATFORM || { echo "ERROR: Platform image build failed" >&2; kill $PID_RUNNER 2>/dev/null; exit 1; }
echo "    Platform image built."
wait $PID_RUNNER || { echo "ERROR: Runner image build failed" >&2; exit 1; }
echo "    Runner image built."

echo "==> Applying namespace and configmap..."
kubectl apply -f "$SCRIPT_DIR/base/namespace.yaml"
kubectl apply -f "$SCRIPT_DIR/base/configmap.yaml"

echo "==> Creating secret from .env..."
SECRET_ENV="$(mktemp)"
cat >"$SECRET_ENV" <<EOF
APP_KEY=$(env_val APP_KEY)
DB_USERNAME=$(env_val DB_USERNAME)
DB_PASSWORD=$(env_val DB_PASSWORD)
REDIS_USERNAME=$(env_val REDIS_USERNAME)
REDIS_PASSWORD=$(env_val REDIS_PASSWORD)
GITHUB_CLIENT_ID=$(env_val GITHUB_CLIENT_ID)
GITHUB_CLIENT_SECRET=$(env_val GITHUB_CLIENT_SECRET)
GITHUB_REDIRECT_URI=$(env_val APP_URL)/auth/github/callback
LIEN_SERVICE_TOKEN=$(env_val LIEN_SERVICE_TOKEN)
EOF

kubectl create secret generic laravel-secret \
  --namespace="$NAMESPACE" \
  --from-env-file="$SECRET_ENV" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "$SECRET_ENV"

RUNNER_SECRET_ENV="$(mktemp)"
cat >"$RUNNER_SECRET_ENV" <<EOF
OPENROUTER_API_KEY=$(env_val OPENROUTER_API_KEY)
EOF
kubectl create secret generic runner-secret \
  --namespace="$NAMESPACE" \
  --from-env-file="$RUNNER_SECRET_ENV" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "$RUNNER_SECRET_ENV"

echo "==> Deploying infrastructure (PostgreSQL, Valkey, NATS)..."
kubectl apply -f "$SCRIPT_DIR/overlays/local/postgres.yaml"
kubectl apply -f "$SCRIPT_DIR/overlays/local/valkey.yaml"
kubectl apply -f "$SCRIPT_DIR/base/nats.yaml"

echo "    Waiting for all infrastructure..."
kubectl rollout status statefulset/postgres -n "$NAMESPACE" --timeout=120s &
PID_PG=$!
kubectl rollout status statefulset/valkey -n "$NAMESPACE" --timeout=120s &
PID_VK=$!
kubectl rollout status statefulset/nats -n "$NAMESPACE" --timeout=120s &
PID_NATS=$!

wait $PID_PG || { echo "ERROR: PostgreSQL failed to start" >&2; exit 1; }
wait $PID_VK || { echo "ERROR: Valkey failed to start" >&2; exit 1; }
wait $PID_NATS || { echo "ERROR: NATS failed to start" >&2; exit 1; }
echo "    All infrastructure ready."

echo "==> Running NATS setup and database migrations in parallel..."
kubectl delete job/nats-setup -n "$NAMESPACE" --ignore-not-found
kubectl delete job/laravel-migrate -n "$NAMESPACE" --ignore-not-found
kubectl apply -f "$SCRIPT_DIR/base/nats-setup-job.yaml"
kubectl apply -f "$SCRIPT_DIR/base/migrate-job.yaml"

kubectl wait --for=condition=complete job/nats-setup -n "$NAMESPACE" --timeout=120s &
PID_NATS_SETUP=$!
kubectl wait --for=condition=complete job/laravel-migrate -n "$NAMESPACE" --timeout=120s &
PID_MIGRATE=$!

wait $PID_NATS_SETUP || { echo "ERROR: NATS setup failed" >&2; exit 1; }
echo "    NATS setup completed."
wait $PID_MIGRATE || { echo "ERROR: Migrations failed" >&2; exit 1; }
echo "    Migrations completed."

echo "==> Deploying Laravel app and worker..."
kubectl apply -f "$SCRIPT_DIR/base/laravel.yaml"
kubectl apply -f "$SCRIPT_DIR/base/worker.yaml"
# Force restart needed locally because imagePullPolicy=Never with :latest tag
kubectl rollout restart deployment/laravel deployment/laravel-worker -n "$NAMESPACE"

echo "==> Deploying runner..."
kubectl apply -f "$SCRIPT_DIR/base/runner.yaml"
# Force restart needed locally because imagePullPolicy=Never with :latest tag
kubectl rollout restart deployment/runner -n "$NAMESPACE"

echo "==> Waiting for deployment rollouts..."
kubectl rollout status deployment/laravel -n "$NAMESPACE" --timeout=120s
kubectl rollout status deployment/runner -n "$NAMESPACE" --timeout=120s

echo ""
echo "==> Deployment complete!"
echo "    URL: http://lien.k8s.orb.local"
echo ""
echo "    Verify with:"
echo "      kubectl get pods -n $NAMESPACE"
echo "      curl http://lien.k8s.orb.local/up"
