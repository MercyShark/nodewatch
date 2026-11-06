#!/usr/bin/env bash
# First run on the Grafana box (Ubuntu): generate passwords, write .env (600), start the stack.
# Prints the push password ONCE so you can paste it into each node's agent; it is not stored in clear.
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo "install Docker first (see the node host bootstrap)"; exit 1; }
if [ -f .env ]; then echo ".env exists; delete it to regenerate"; exit 1; fi
ADMIN=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
PUSH=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-28)
HASH=$(docker run --rm caddy:2.11.9 caddy hash-password --plaintext "$PUSH" | sed 's/\$/$$/g')   # $ doubled: compose reads .env
umask 077
printf 'GRAFANA_ADMIN_PASSWORD=%s\nPUSH_USER=nodewatch\nPUSH_PASSWORD_HASH=%s\n' "$ADMIN" "$HASH" > .env
docker compose up -d
TOKEN=$(curl -s -m 2 -X PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 60" || true)
PUBIP=$(curl -s -m 2 -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4 || true)
echo "Grafana:  http://${PUBIP:-THIS_HOST}:3000  user admin  password $ADMIN"
echo "Push credentials for the node agents (shown once):  PUSH_USER=nodewatch  PUSH_PASSWORD=$PUSH"
