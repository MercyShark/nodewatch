#!/usr/bin/env bash
# Connect Nodewatch's slow-request digest to Slack, on the node host:
#   sudo bash /opt/nodewatch/scripts/setup-slack.sh
# Needs an incoming webhook URL (Slack: Apps -> Incoming Webhooks -> Add to Slack -> pick a channel).
# The URL is read without echo, checked by posting one test message, and written only to /opt/nodewatch/.env
# (mode 600). It is never printed.
set -euo pipefail
ENV_FILE=${NODEWATCH_ENV:-/opt/nodewatch/.env}
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -rsp "Slack incoming webhook URL (input hidden): " URL; echo
URL=$(printf '%s' "$URL" | tr -d '[:space:]')
[[ "$URL" =~ ^https://hooks\.slack\.com/ ]] || { echo "That does not look like a Slack incoming webhook (https://hooks.slack.com/...)."; exit 1; }
export URL
NODE=$(sed -n 's/^INSTANCE_NAME=//p' "$ENV_FILE" | tail -1)

OUT=$(python3 - "${NODE:-this node}" <<'PY'
import json, os, sys, urllib.request
node = sys.argv[1]
body = {"text": f"Nodewatch on {node}: Slack connected. Requests slower than the threshold (750 ms by default) will arrive here once a minute."}
req = urllib.request.Request(os.environ["URL"], data=json.dumps(body).encode(), headers={"content-type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=15)
    print(r.status, r.read().decode()[:100])
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:100])
except Exception as e:
    print(0, type(e).__name__)
PY
)
STATUS=${OUT%% *}
case "$STATUS" in
  200) echo "Slack accepted the test message. Check the channel." ;;
  403|404) echo "Slack rejected the webhook (${OUT#* }). Create a new one and try again."; exit 1 ;;
  0)   echo "Could not reach hooks.slack.com (outbound HTTPS blocked?)."; exit 1 ;;
  *)   echo "Unexpected answer from Slack: $OUT"; exit 1 ;;
esac

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%s)"
python3 - "$ENV_FILE" <<'PY'
import os, sys
path = sys.argv[1]
lines = [l for l in open(path).read().splitlines() if not l.startswith("SLACK_WEBHOOK_URL=")]
lines.append("SLACK_WEBHOOK_URL=" + os.environ["URL"])
open(path, "w").write("\n".join(lines) + "\n")
PY
chmod 600 "$ENV_FILE"
echo "Saved SLACK_WEBHOOK_URL in $ENV_FILE (mode 600)."
cd "$(dirname "$ENV_FILE")" && docker compose up -d >/dev/null 2>&1 && echo "Nodewatch restarted. Slow requests now reach Slack once a minute (threshold: Settings -> thresholds, slowRequestMs)."
