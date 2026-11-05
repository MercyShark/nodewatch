#!/usr/bin/env bash
# Build Nodewatch locally and ship it to the EC2 node host using only EC2 + Session Manager:
# docker save → encrypted SSM port-forward → nc on the instance's loopback → docker load → compose up.
# Usage: scripts/deploy.sh [--remote-build] <instance-id> [aws-profile] [region]
#   --remote-build  send the committed source (git archive HEAD, ~300 KB) instead of the image (~130 MB) and build
#                   on the instance. Use it on slow uplinks. Uncommitted changes are not deployed.
set -euo pipefail
MODE=image
if [ "${1:-}" = "--remote-build" ]; then MODE=source; shift; fi
ID=${1:?usage: deploy.sh [--remote-build] <instance-id> [profile] [region]}
PROFILE=${2:-sova-profile}
REGION=${3:-ap-south-1}
AWS=(aws --profile "$PROFILE" --region "$REGION")
LOCAL_PORT=29999
REMOTE_PORT=9999
TMP=$(mktemp -d)
trap 'kill "${FWD_PID:-}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

remote() { # run a bash script on the instance as root, wait (up to $2 x 2 s, default 150), print output
  local b64 cid st polls=${2:-150}
  b64=$(printf '%s' "$1" | base64 -w0)
  cid=$("${AWS[@]}" ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript \
    --parameters "$(jq -nc --arg c "echo $b64 | base64 -d | bash" '{commands:[$c]}')" \
    --query Command.CommandId --output text)
  for _ in $(seq 1 "$polls"); do
    st=$("${AWS[@]}" ssm get-command-invocation --command-id "$cid" --instance-id "$ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Success|Failed|Cancelled|TimedOut) break;; esac
    sleep 2
  done
  "${AWS[@]}" ssm get-command-invocation --command-id "$cid" --instance-id "$ID" --query StandardOutputContent --output text
  [ "$st" = Success ]
}

cd "$(dirname "$0")/.."
if [ "$MODE" = source ]; then
  [ -z "$(git status --porcelain)" ] || echo "    note: uncommitted changes are NOT deployed (git archive HEAD)"
  echo "==> packing source $(git rev-parse --short HEAD)"
  git archive --format=tar.gz HEAD > "$TMP/img.tar.gz"
else
  echo "==> building image"
  docker build -q -t nodewatch:local .
  docker save nodewatch:local | gzip -1 > "$TMP/img.tar.gz"
fi
SUM=$(sha256sum "$TMP/img.tar.gz" | cut -c1-64)
echo "    $(du -h "$TMP/img.tar.gz" | cut -f1) sha256 $SUM"

echo "==> starting loopback receiver on the instance"
remote "rm -f /tmp/nodewatch-image.tar.gz; setsid nohup bash -c 'nc -l 127.0.0.1 $REMOTE_PORT > /tmp/nodewatch-image.tar.gz' >/dev/null 2>&1 < /dev/null & sleep 1; ss -ltn | grep -q ':$REMOTE_PORT '"

echo "==> opening Session Manager port-forward"
"${AWS[@]}" ssm start-session --target "$ID" --document-name AWS-StartPortForwardingSession \
  --parameters "{\"portNumber\":[\"$REMOTE_PORT\"],\"localPortNumber\":[\"$LOCAL_PORT\"]}" > "$TMP/fwd.log" 2>&1 &
FWD_PID=$!
for _ in $(seq 1 30); do grep -q "Waiting for connections" "$TMP/fwd.log" && break; sleep 1; done

echo "==> streaming image"
cat "$TMP/img.tar.gz" > "/dev/tcp/127.0.0.1/$LOCAL_PORT"
kill "$FWD_PID" 2>/dev/null || true

VERIFY="for i in \$(seq 1 30); do pgrep -f 'nc -l 127.0.0.1 $REMOTE_PORT' >/dev/null || break; sleep 2; done
[ \"\$(sha256sum /tmp/nodewatch-image.tar.gz | cut -c1-64)\" = $SUM ] || { echo checksum mismatch; exit 1; }"
RESTART="cd /opt/nodewatch && docker compose up -d && sleep 15 && docker compose ps --format '{{.Name}} {{.Status}}'"
if [ "$MODE" = source ]; then
  echo "==> verifying, building on the instance and restarting (a few minutes)"
  remote "$VERIFY
SRC=/opt/nodewatch/src && rm -rf \$SRC && mkdir -p \$SRC && tar -xzf /tmp/nodewatch-image.tar.gz -C \$SRC && rm -f /tmp/nodewatch-image.tar.gz
cd \$SRC && nice -n 10 docker build -q -t nodewatch:local . && cd / && rm -rf \$SRC && docker image prune -f >/dev/null
$RESTART" 450
else
  echo "==> verifying, loading and restarting on the instance"
  remote "$VERIFY
gunzip -c /tmp/nodewatch-image.tar.gz | docker load && rm -f /tmp/nodewatch-image.tar.gz
$RESTART"
fi
PORT=$(remote "sed -n 's/^PORT=//p' /opt/nodewatch/.env | tail -1" | tr -d '[:space:]'); PORT=${PORT:-8080}
echo "==> done. UI on port $PORT. Through Session Manager:"
echo "aws ssm start-session --profile $PROFILE --region $REGION --target $ID --document-name AWS-StartPortForwardingSession --parameters '{\"portNumber\":[\"$PORT\"],\"localPortNumber\":[\"$PORT\"]}'"
