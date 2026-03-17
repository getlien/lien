#!/bin/bash
set -euo pipefail

# Full production deployment to DOKS.
# Usage: ./.infra/scripts/deploy.sh <tag>
# Example: ./.infra/scripts/deploy.sh v0.1.0
#
# Required env vars:
#   APP_KEY              - Laravel application key
#   GITHUB_CLIENT_ID     - GitHub OAuth app client ID
#   GITHUB_CLIENT_SECRET - GitHub OAuth app client secret
#   LIEN_SERVICE_TOKEN   - Internal API service token

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
OVERLAY_DIR="$PROJECT_ROOT/.infra/k8s/overlays/production"
TF_DIR="$PROJECT_ROOT/.infra/terraform"
NAMESPACE="lien"

TAG="${1:?Usage: deploy.sh <tag>}"

# Validate required env vars
for var in APP_KEY GITHUB_CLIENT_ID GITHUB_CLIENT_SECRET LIEN_SERVICE_TOKEN OPENROUTER_API_KEY; do
  if [[ -z "${!var:-}" ]]; then
    echo "ERROR: Required env var '$var' is not set." >&2
    exit 1
  fi
done

echo "==> Reading Terraform outputs..."
cd "$TF_DIR"
PG_HOST=$(terraform output -raw pg_host)
PG_PORT=$(terraform output -raw pg_port)
PG_DATABASE=$(terraform output -raw pg_database)
PG_USER=$(terraform output -raw pg_user)
PG_PASSWORD=$(terraform output -raw pg_password)
VALKEY_HOST=$(terraform output -raw valkey_host)
VALKEY_PORT=$(terraform output -raw valkey_port)
VALKEY_USER=$(terraform output -raw valkey_user)
VALKEY_PASSWORD=$(terraform output -raw valkey_password)
K8S_CLUSTER_NAME=$(terraform output -raw k8s_cluster_name)
cd "$PROJECT_ROOT"

echo "==> Configuring kubectl for DOKS cluster '$K8S_CLUSTER_NAME'..."
doctl kubernetes cluster kubeconfig save "$K8S_CLUSTER_NAME"

echo "==> Building kustomize manifests..."
export PG_HOST PG_PORT PG_DATABASE VALKEY_HOST VALKEY_PORT IMAGE_TAG="$TAG"

MANIFESTS="$(mktemp)"
kubectl kustomize "$OVERLAY_DIR" \
  | envsubst '${PG_HOST} ${PG_PORT} ${PG_DATABASE} ${VALKEY_HOST} ${VALKEY_PORT} ${IMAGE_TAG}' \
  | sed -E 's/^([[:space:]]+[A-Z_]+:[[:space:]]+)([0-9]+)$/\1"\2"/' > "$MANIFESTS"

echo "==> Creating/updating laravel-secret..."
SECRET_ENV="$(mktemp)"
cat >"$SECRET_ENV" <<EOF
APP_KEY=$APP_KEY
DB_USERNAME=$PG_USER
DB_PASSWORD=$PG_PASSWORD
REDIS_USERNAME=$VALKEY_USER
REDIS_PASSWORD=$VALKEY_PASSWORD
GITHUB_CLIENT_ID=$GITHUB_CLIENT_ID
GITHUB_CLIENT_SECRET=$GITHUB_CLIENT_SECRET
GITHUB_REDIRECT_URI=https://app.lien.dev/auth/github/callback
LIEN_SERVICE_TOKEN=$LIEN_SERVICE_TOKEN
EOF

kubectl create secret generic laravel-secret \
  --namespace="$NAMESPACE" \
  --from-env-file="$SECRET_ENV" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "$SECRET_ENV"

echo "==> Creating/updating runner-secret..."
RUNNER_SECRET_ENV="$(mktemp)"
cat >"$RUNNER_SECRET_ENV" <<EOF
OPENROUTER_API_KEY=$OPENROUTER_API_KEY
EOF
kubectl create secret generic runner-secret \
  --namespace="$NAMESPACE" \
  --from-env-file="$RUNNER_SECRET_ENV" \
  --dry-run=client -o yaml | kubectl apply -f -
rm -f "$RUNNER_SECRET_ENV"

echo "==> Deleting completed jobs (immutable, must recreate)..."
kubectl delete job/nats-setup job/laravel-migrate -n "$NAMESPACE" --ignore-not-found

echo "==> Applying all manifests..."
kubectl apply -f "$MANIFESTS"

echo "==> Waiting for NATS to be ready..."
kubectl rollout status statefulset/nats -n "$NAMESPACE" --timeout=120s

echo "==> Waiting for NATS setup and migrations in parallel..."
kubectl wait --for=condition=complete job/nats-setup -n "$NAMESPACE" --timeout=120s &
PID_NATS=$!
kubectl wait --for=condition=complete job/laravel-migrate -n "$NAMESPACE" --timeout=180s &
PID_MIGRATE=$!

wait $PID_NATS || { echo "ERROR: NATS setup failed" >&2; exit 1; }
echo "    NATS setup completed."
wait $PID_MIGRATE || { echo "ERROR: Migrations failed" >&2; exit 1; }
echo "    Migrations completed."

echo "==> Restarting deployments..."
kubectl rollout restart deployment/laravel deployment/laravel-worker deployment/runner -n "$NAMESPACE"

echo "==> Waiting for rollouts..."
kubectl rollout status deployment/laravel -n "$NAMESPACE" --timeout=180s
kubectl rollout status deployment/laravel-worker -n "$NAMESPACE" --timeout=120s
kubectl rollout status deployment/runner -n "$NAMESPACE" --timeout=120s

rm -f "$MANIFESTS"

echo ""
echo "==> Deployment complete!"
LB_IP=$(kubectl get svc laravel -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "<pending>")
echo "    Load Balancer IP: $LB_IP"
echo ""
echo "    Verify with:"
echo "      kubectl get pods -n $NAMESPACE"
echo "      curl https://app.lien.dev/up"
echo ""
echo "    If this is the first deploy, create a DNS A record:"
echo "      app.lien.dev -> $LB_IP"
