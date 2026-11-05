#!/usr/bin/env bash
# Connect Nodewatch alerts to Telegram, on the node host. Run it in a Session Manager shell:
#   sudo bash /opt/nodewatch/scripts/setup-telegram.sh
# The bot token is read without echo, checked with Telegram, and written only to /opt/nodewatch/.env (mode 600).
# It is never printed. The chat id is found from the message you send to the bot.
set -euo pipefail
ENV_FILE=${NODEWATCH_ENV:-/opt/nodewatch/.env}
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash $0"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE not found"; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required"; exit 1; }

read -rsp "Telegram bot token (from @BotFather, input hidden): " TOKEN; echo
TOKEN=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
[[ "$TOKEN" =~ ^[0-9]{5,15}:[A-Za-z0-9_-]{30,64}$ ]] || { echo "That does not look like a bot token (digits:letters)."; exit 1; }
export TOKEN

tg() { # tg <method> [json body] ; prints the JSON reply. The token stays out of argv and logs.
  python3 - "$1" "${2:-}" <<'PY'
import json, os, sys, urllib.request
method, body = sys.argv[1], sys.argv[2]
req = urllib.request.Request(f"https://api.telegram.org/bot{os.environ['TOKEN']}/{method}",
                             data=body.encode() if body else None, headers={"content-type": "application/json"})
try:
    print(urllib.request.urlopen(req, timeout=15).read().decode())
except urllib.error.HTTPError as e:
    print(e.read().decode())
except Exception as e:
    print(json.dumps({"ok": False, "description": type(e).__name__}))
PY
}

ME=$(tg getMe)
BOT=$(printf '%s' "$ME" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d["result"]["username"] if d.get("ok") else "")')
[ -n "$BOT" ] || { echo "Telegram rejected the token: $(printf '%s' "$ME" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("description","unknown error"))')"; exit 1; }
echo "Token OK: bot @$BOT"

if [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  CHAT=$TELEGRAM_CHAT_ID
else
  echo
  echo "Now, in Telegram: open @$BOT and press Start (or send it any message)."
  echo "For a group: add @$BOT to the group and send a message there."
  read -rp "Press Enter once you have sent the message... " _
  CHATS=$(tg getUpdates | python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("ok"):
    print("ERR " + d.get("description", "getUpdates failed")); sys.exit()
seen = {}
for u in reversed(d.get("result", [])):
    for k in ("message", "channel_post", "my_chat_member", "edited_message"):
        c = (u.get(k) or {}).get("chat")
        if c and c["id"] not in seen:
            name = c.get("title") or " ".join(x for x in (c.get("first_name"), c.get("last_name")) if x) or c.get("username") or "?"
            seen[c["id"]] = "\t".join([str(c["id"]), str(c.get("type")), name])
print("\n".join(seen.values()))')
  case "$CHATS" in
    ERR*) echo "${CHATS#ERR }. If the bot uses a webhook, remove it (deleteWebhook) or pass TELEGRAM_CHAT_ID=... yourself."; exit 1 ;;
    "") echo "No message found yet. Send /start to @$BOT and run this again."; exit 1 ;;
  esac
  echo; echo "Chats that wrote to the bot (newest first):"
  printf '%s\n' "$CHATS" | nl -w2 -s') '
  N=$(printf '%s\n' "$CHATS" | wc -l)
  PICK=1
  [ "$N" -gt 1 ] && read -rp "Which one gets the alerts? [1-$N] " PICK
  CHAT=$(printf '%s\n' "$CHATS" | sed -n "${PICK}p" | cut -f1)
  [ -n "$CHAT" ] || { echo "No such entry."; exit 1; }
fi
[[ "$CHAT" =~ ^-?[0-9]+$ ]] || { echo "Chat id must be a number."; exit 1; }

HOST=$(sed -n 's/^INSTANCE_NAME=//p' "$ENV_FILE" | tail -1)
BODY=$(python3 -c 'import json,sys;print(json.dumps({"chat_id":sys.argv[1],"text":"Nodewatch on "+(sys.argv[2] or "this node")+": Telegram alerts are connected."}))' "$CHAT" "$HOST")
SENT=$(tg sendMessage "$BODY" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("ok" if d.get("ok") else d.get("description","failed"))')
[ "$SENT" = ok ] || { echo "Could not send to chat $CHAT: $SENT"; exit 1; }
echo "Test message sent to chat $CHAT."

cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date +%s)"
CHAT="$CHAT" python3 - "$ENV_FILE" <<'PY'
import os, sys
path = sys.argv[1]
want = {"TELEGRAM_BOT_TOKEN": os.environ["TOKEN"], "TELEGRAM_CHAT_ID": os.environ["CHAT"]}
lines, done = [], set()
for line in open(path).read().splitlines():
    key = line.split("=", 1)[0]
    if key in want:
        lines.append(f"{key}={want[key]}"); done.add(key)
    else:
        lines.append(line)
lines += [f"{k}={v}" for k, v in want.items() if k not in done]
open(path, "w").write("\n".join(lines) + "\n")
PY
chmod 600 "$ENV_FILE"
echo "Saved TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in $ENV_FILE (mode 600)."

cd "$(dirname "$ENV_FILE")" && docker compose up -d >/dev/null 2>&1 && echo "Nodewatch restarted. Use Alerts -> Telegram -> Send test to check it end to end."
