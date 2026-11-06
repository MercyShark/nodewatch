#!/usr/bin/env bash
# Ship Nodewatch to the node host over SSH and restart it.
# Usage: scripts/deploy.sh [--image] [ssh-host]
#   ssh-host   an SSH destination: a ~/.ssh/config alias or user@ip (default: nodewatch). The user needs passwordless sudo.
#   default    send the committed source (git archive HEAD, ~350 KB) and build the image on the host.
#              Uncommitted changes are not deployed.
#   --image    build the image locally and stream it (~130 MB) instead. Use it when the host should not build.
# Everything travels inside the SSH connection; no extra port is opened.
set -euo pipefail
MODE=source
if [ "${1:-}" = "--image" ]; then MODE=image; shift; fi
HOST=${1:-nodewatch}
REV=$(git -C "$(dirname "$0")/.." rev-parse --short HEAD)   # baked into the image; shown under Settings → Updates
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST")

cd "$(dirname "$0")/.."
echo "==> checking SSH to $HOST"
"${SSH[@]}" 'sudo -n true' || { echo "cannot reach $HOST with passwordless sudo (key, port 22 rule, or IP changed?)"; exit 1; }

if [ "$MODE" = source ]; then
  [ -z "$(git status --porcelain)" ] || echo "    note: uncommitted changes are NOT deployed (git archive HEAD)"
  echo "==> sending source $(git rev-parse --short HEAD) and building on $HOST (a few minutes)"
  git archive --format=tar.gz HEAD | "${SSH[@]}" 'set -e
SRC=$(mktemp -d /tmp/nodewatch-src.XXXXXX)
trap "sudo rm -rf $SRC" EXIT
tar -xzf - -C "$SRC"
cd "$SRC" && sudo nice -n 10 docker build -q --build-arg GIT_SHA='"$REV"' -t nodewatch:local . >/dev/null
sudo docker image prune -f >/dev/null
echo "    image built"'
else
  echo "==> building image locally"
  docker build -q --build-arg GIT_SHA="$REV" -t nodewatch:local . >/dev/null
  echo "==> streaming image to $HOST"
  docker save nodewatch:local | gzip -1 | "${SSH[@]}" 'gunzip -c | sudo docker load'
fi

if ssh "$HOST" 'sudo grep -q "localPort = 18545" /opt/arkiv-community-node/frpc.toml 2>/dev/null'; then
  echo "    note: Live queries is inline; paid serving pauses while the container restarts (~10 s), then the tunnel reconnects"
fi
echo "==> restarting Nodewatch"
"${SSH[@]}" 'set -e
cd /opt/nodewatch && sudo docker compose up -d --force-recreate nodewatch 2>&1 | tail -1
for i in $(seq 1 40); do
  s=$(sudo docker inspect -f "{{.State.Health.Status}}" nodewatch 2>/dev/null || echo missing)
  [ "$s" = healthy ] && break; sleep 3
done
echo "    health: $s"
[ "$s" = healthy ]'

PORT=$("${SSH[@]}" 'sudo sed -n "s/^PORT=//p" /opt/nodewatch/.env | tail -1' | tr -d '[:space:]'); PORT=${PORT:-8080}
echo "==> done. Open the UI through an SSH tunnel:"
echo "ssh -N -L $PORT:127.0.0.1:$PORT $HOST    # then http://localhost:$PORT"
