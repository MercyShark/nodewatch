#!/usr/bin/env bash
# Build the marketing site (site-app) and publish it to S3 + CloudFront.
# Usage: scripts/site-deploy.sh [aws-profile]   (bucket and distribution come from ../nodewatch-site-infra outputs)
set -euo pipefail
PROFILE=${1:-sova-profile}
HERE=$(cd "$(dirname "$0")/.." && pwd)
INFRA=${SITE_INFRA_DIR:-$HERE/../nodewatch-site-infra}

BUCKET=$(terraform -chdir="$INFRA" output -raw bucket)
DIST=$(terraform -chdir="$INFRA" output -raw distribution_id)

echo "==> building site-app"
(cd "$HERE/site-app" && pnpm install --ignore-workspace --frozen-lockfile >/dev/null && pnpm build >/dev/null)

echo "==> uploading to s3://$BUCKET"
# Hashed assets: cache for a year. HTML and everything else: revalidate.
aws --profile "$PROFILE" s3 sync "$HERE/site-app/out/_next/static" "s3://$BUCKET/_next/static" --delete --cache-control "public,max-age=31536000,immutable" --only-show-errors
aws --profile "$PROFILE" s3 sync "$HERE/site-app/out" "s3://$BUCKET" --delete --exclude "_next/static/*" --cache-control "public,max-age=0,must-revalidate" --only-show-errors

echo "==> invalidating CloudFront $DIST"
aws --profile "$PROFILE" cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Id' --output text
echo "==> done: https://$BUCKET"
