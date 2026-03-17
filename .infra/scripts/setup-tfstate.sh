#!/bin/bash
set -euo pipefail

# One-time setup: create DO Space for Terraform state storage.
# Prerequisites:
#   - doctl CLI installed and authenticated
#   - SPACES_ACCESS_KEY and SPACES_SECRET_KEY env vars set (separate from DO API token)

BUCKET="getlien-tfstate"
REGION="fra1"

echo "==> Creating Spaces bucket '$BUCKET' in $REGION..."

if doctl compute cdn list 2>/dev/null | grep -q "$BUCKET"; then
  echo "    Bucket already exists."
else
  # s3cmd is used because doctl doesn't support Spaces bucket creation directly
  if ! command -v s3cmd &>/dev/null; then
    echo "ERROR: s3cmd is required. Install with: brew install s3cmd" >&2
    exit 1
  fi

  s3cmd mb "s3://$BUCKET" \
    --region="$REGION" \
    --host="${REGION}.digitaloceanspaces.com" \
    --host-bucket="%(bucket)s.${REGION}.digitaloceanspaces.com" \
    --access_key="$SPACES_ACCESS_KEY" \
    --secret_key="$SPACES_SECRET_KEY"

  echo "    Bucket created."
fi

echo ""
echo "==> Setup complete."
echo "    Configure your S3 backend with:"
echo "      AWS_ACCESS_KEY_ID=\$SPACES_ACCESS_KEY"
echo "      AWS_SECRET_ACCESS_KEY=\$SPACES_SECRET_KEY"
