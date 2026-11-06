#!/usr/bin/env bash
# Attach this node to the fleet Grafana. Run on the node host:
#   GRAFANA_HOST=1.2.3.4 PUSH_PASSWORD=... sudo -E bash run.sh
# Reads the node's Nodewatch data volume (requests.jsonl) read-only and talks to Nodewatch on loopback.
set -euo pipefail
: "${GRAFANA_HOST:?GRAFANA_HOST (the Grafana box address) is required}"
: "${PUSH_PASSWORD:?PUSH_PASSWORD (printed by bootstrap.sh on the Grafana box) is required}"
PUSH_USER=${PUSH_USER:-nodewatch}
NODEWATCH_PORT=${NODEWATCH_PORT:-8000}
VOLUME=${NODEWATCH_VOLUME:-nodewatch}          # docker run install; /srv/nodewatch for the compose install
HERE=$(cd "$(dirname "$0")" && pwd)
docker rm -f nodewatch-agent >/dev/null 2>&1 || true
docker run -d --name nodewatch-agent --restart unless-stopped --network host \
  -v "$HERE/config.alloy:/etc/alloy/config.alloy:ro" \
  -v "$VOLUME:/data:ro" \
  -v nodewatch-agent:/var/lib/alloy/data \
  -e GRAFANA_HOST="$GRAFANA_HOST" -e PUSH_USER="$PUSH_USER" -e PUSH_PASSWORD="$PUSH_PASSWORD" \
  -e NODEWATCH_PORT="$NODEWATCH_PORT" -e METRICS_TOKEN="${METRICS_TOKEN:-}" \
  --log-opt max-size=20m --log-opt max-file=3 \
  grafana/alloy:v1.21.3 run /etc/alloy/config.alloy --storage.path=/var/lib/alloy/data --server.http.listen-addr=127.0.0.1:12345 >/dev/null
echo "nodewatch-agent started; it pushes to $GRAFANA_HOST. Check: docker logs nodewatch-agent --tail 20"
