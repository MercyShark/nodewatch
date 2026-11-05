#!/usr/bin/env bash
# Connect Nodewatch critical alerts to PagerDuty, on the node host. Run it in a Session Manager shell:
#   sudo bash /opt/nodewatch/scripts/setup-pagerduty.sh
# Needs an Events API v2 integration key (PagerDuty: Services -> your service -> Integrations -> Events API V2).
# The key is read without echo, checked by sending (and immediately resolving) a test event, and written only to
# /opt/nodewatch/.env (mode 600). It is never printed.
set -euo pipefail
ENV_FILE=${NODEWATCH_ENV:-/opt/nodewatch/.env}
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -rsp "PagerDuty Events API v2 integration key (input hidden): " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[[ "$KEY" =~ ^[0-9a-fA-F]{32}$ ]] || { echo "That does not look like an Events v2 integration key (32 hex characters)."; exit 1; }
export KEY
NODE=$(sed -n 's/^INSTANCE_NAME=//p' "$ENV_FILE" | tail -1)

pd() { # pd <event_action> <dedup_key> ; prints status + body. The key stays out of argv and logs.
  python3 - "$1" "$2" "${NODE:-this node}" <<'PY'
import json, os, sys, urllib.request
action, dedup, node = sys.argv[1], sys.argv[2], sys.argv[3]
body = {"routing_key": os.environ["KEY"], "event_action": action, "dedup_key": dedup}
if action == "trigger":
    body["payload"] = {"summary": f"Nodewatch on {node}: PagerDuty connected (setup test, auto-resolves)", "source": node, "severity": "info", "component": "arkiv-node", "group": "nodewatch"}
req = urllib.request.Request("https://events.pagerduty.com/v2/enqueue", data=json.dumps(body).encode(), headers={"content-type": "application/json"})
try:
    r = urllib.request.urlopen(req, timeout=15)
    print(r.status, r.read().decode()[:200])
except urllib.error.HTTPError as e:
    print(e.code, e.read().decode()[:200])
except Exception as e:
    print(0, type(e).__name__)
PY
}

DEDUP="nodewatch-setup-$(date +%s)"
OUT=$(pd trigger "$DEDUP")
STATUS=${OUT%% *}
case "$STATUS" in
  202) echo "PagerDuty accepted the test event (dedup $DEDUP)."
       echo "Note: PagerDuty answers 202 even for an unknown key. Check your service's incident list for"
       echo "'Nodewatch ... setup test' (it triggers, then resolves) to be sure the key is the right one." ;;
  400) echo "PagerDuty rejected the key or payload: ${OUT#* }"; exit 1 ;;
  0)   echo "Could not reach events.pagerduty.com (outbound HTTPS blocked?)."; exit 1 ;;
  *)   echo "Unexpected answer from PagerDuty: $OUT"; exit 1 ;;
esac
# Resolve it right away so the test leaves no open incident.
pd resolve "$DEDUP" >/dev/null && echo "Test event resolved."

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%s)"
python3 - "$ENV_FILE" <<'PY'
import os, sys
path = sys.argv[1]
lines = [l for l in open(path).read().splitlines() if not l.startswith("PAGERDUTY_ROUTING_KEY=")]
lines.append("PAGERDUTY_ROUTING_KEY=" + os.environ["KEY"])
open(path, "w").write("\n".join(lines) + "\n")
PY
chmod 600 "$ENV_FILE"
echo "Saved PAGERDUTY_ROUTING_KEY in $ENV_FILE (mode 600)."
cd "$(dirname "$ENV_FILE")" && docker compose up -d >/dev/null 2>&1 && echo "Nodewatch restarted. Critical alerts (container down, OOM, disk critical, tunnel down) now page PagerDuty and resolve themselves."
