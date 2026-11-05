#!/usr/bin/env bash
# Connect Nodewatch critical alerts to PagerDuty (Events API v2), on the node host. Run it in a Session Manager shell:
#   sudo bash /opt/nodewatch/scripts/setup-pagerduty.sh
# The integration (routing) key is read without echo and written only to /opt/nodewatch/.env (mode 600). Never printed.
# Optional test: sends one "trigger" and, right after, its "resolve", so a test incident opens and closes by itself.
set -euo pipefail
ENV_FILE=${NODEWATCH_ENV:-/opt/nodewatch/.env}
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -rsp "PagerDuty integration key (Events API v2, input hidden): " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[[ "$KEY" =~ ^[A-Za-z0-9]{32}$ ]] || { echo "That does not look like an Events API v2 integration key (32 letters/digits)."; exit 1; }
export KEY

pd() { # pd trigger|resolve <dedup_key> ; prints status
  python3 - "$1" "$2" <<'PY'
import json, os, socket, sys, urllib.request
action, dedup = sys.argv[1], sys.argv[2]
ev = {"routing_key": os.environ["KEY"], "event_action": action, "dedup_key": dedup}
if action == "trigger":
    ev["payload"] = {"summary": f"Nodewatch test on {socket.gethostname()}: PagerDuty is connected (auto-resolves)",
                     "source": socket.gethostname(), "severity": "info", "component": "arkiv-node", "group": "nodewatch"}
req = urllib.request.Request("https://events.pagerduty.com/v2/enqueue", data=json.dumps(ev).encode(),
                             headers={"content-type": "application/json"})
try:
    r = json.loads(urllib.request.urlopen(req, timeout=15).read().decode())
    print(r.get("status", "?"))
except urllib.error.HTTPError as e:
    body = e.read().decode()[:200]
    print(f"HTTP {e.code} {body}")
except Exception as e:
    print(type(e).__name__)
PY
}

read -rp "Send a test incident now (it is resolved again within seconds)? [Y/n] " ANS
if [[ ! "$ANS" =~ ^[Nn] ]]; then
  D="nodewatch-setup-test-$(date +%s)"
  T=$(pd trigger "$D"); [ "$T" = success ] || { echo "PagerDuty refused the key: $T"; exit 1; }
  echo "Test incident triggered. Resolving it..."
  sleep 5
  R=$(pd resolve "$D"); echo "Resolve: $R"
fi

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%s)"
python3 - "$ENV_FILE" <<'PY'
import os, sys
path, key = sys.argv[1], os.environ["KEY"]
lines, done = [], False
for line in open(path).read().splitlines():
    if line.split("=", 1)[0] == "PAGERDUTY_ROUTING_KEY":
        lines.append(f"PAGERDUTY_ROUTING_KEY={key}"); done = True
    else:
        lines.append(line)
if not done:
    lines.append(f"PAGERDUTY_ROUTING_KEY={key}")
open(path, "w").write("\n".join(lines) + "\n")
PY
chmod 600 "$ENV_FILE"
echo "Saved PAGERDUTY_ROUTING_KEY in $ENV_FILE (mode 600)."
cd "$(dirname "$ENV_FILE")" && docker compose up -d >/dev/null 2>&1 && echo "Nodewatch restarted. PagerDuty now gets critical alerts (trigger + resolve)."
