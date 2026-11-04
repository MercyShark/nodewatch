#!/usr/bin/env bash
# Build Nodewatch locally and ship it to the EC2 node host using only EC2 + Session Manager:
# docker save → encrypted SSM port-forward → nc on the instance's loopback → docker load → compose up.
# Usage: scripts/deploy.sh <instance-id> [aws-profile] [region]
set -euo pipefail
ID=${1:?usage: deploy.sh <instance-id> [profile] [region]}
PROFILE=${2:-sova-profile}
REGION=${3:-ap-south-1}
AWS=(aws --profile "$PROFILE" --region "$REGION")
LOCAL_PORT=29999
REMOTE_PORT=9999
TMP=$(mktemp -d)
trap 'kill "${FWD_PID:-}" 2>/dev/null || true; rm -rf "$TMP"' EXIT

remote() { # run a bash script on the instance as root, wait, print output
  local b64 cid st
  b64=$(printf '%s' "$1" | base64 -w0)
  cid=$("${AWS[@]}" ssm send-command --instance-ids "$ID" --document-name AWS-RunShellScript \
    --parameters "$(jq -nc --arg c "echo $b64 | base64 -d | bash" '{commands:[$c]}')" \
    --query Command.CommandId --output text)
  for _ in $(seq 1 150); do
    st=$("${AWS[@]}" ssm get-command-invocation --command-id "$cid" --instance-id "$ID" --query Status --output text 2>/dev/null || echo Pending)
    case "$st" in Success|Failed|Cancelled|TimedOut) break;; esac
    sleep 2
  done
  "${AWS[@]}" ssm get-command-invocation --command-id "$cid" --instance-id "$ID" --query StandardOutputContent --output text
  [ "$st" = Success ]
}

cd "$(dirname "$0")/.."
echo "==> building image"
docker build -q -t nodewatch:local .
docker save nodewatch:local | gzip -1 > "$TMP/img.tar.gz"
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

echo "==> verifying, loading and restarting on the instance"
remote "for i in \$(seq 1 30); do pgrep -f 'nc -l 127.0.0.1 $REMOTE_PORT' >/dev/null || break; sleep 2; done
[ \"\$(sha256sum /tmp/nodewatch-image.tar.gz | cut -c1-64)\" = $SUM ] || { echo checksum mismatch; exit 1; }
gunzip -c /tmp/nodewatch-image.tar.gz | docker load && rm -f /tmp/nodewatch-image.tar.gz
cd /opt/nodewatch && docker compose up -d && sleep 15 && docker compose ps --format '{{.Name}} {{.Status}}'"
echo "==> done. Open the UI with:"
echo "aws ssm start-session --profile $PROFILE --region $REGION --target $ID --document-name AWS-StartPortForwardingSession --parameters '{\"portNumber\":[\"8080\"],\"localPortNumber\":[\"8080\"]}'"
