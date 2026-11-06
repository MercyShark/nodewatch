#!/usr/bin/env bash
# Copy deploy/grafana/server to the Grafana box over SSH and (re)start the stack. First time: run bootstrap.sh there.
#   scripts/grafana-deploy.sh [ssh-host]     (default alias: grafana)
set -euo pipefail
HOST=${1:-grafana}
HERE=$(cd "$(dirname "$0")/.." && pwd)
ssh "$HOST" 'mkdir -p ~/nodewatch-grafana'
tar -C "$HERE/deploy/grafana" -czf - server | ssh "$HOST" 'tar -C ~/nodewatch-grafana -xzf -'
if ssh "$HOST" 'test -f ~/nodewatch-grafana/server/.env'; then
  ssh "$HOST" 'cd ~/nodewatch-grafana/server && sudo docker compose up -d 2>&1 | tail -4'
else
  echo "no .env on $HOST yet: run  ssh $HOST 'cd ~/nodewatch-grafana/server && sudo bash bootstrap.sh'"
fi
