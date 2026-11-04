#!/usr/bin/env bash
# Nodewatch doctor: run on the node host. Checks the node kit stack and Nodewatch, read-only,
# and prints a fix for every failure. Exit code = number of failed checks.
# Usage: sudo ./scripts/doctor.sh
set -uo pipefail
EL=${EL_RPC_URL:-http://127.0.0.1:8545}
CL=${CL_API_URL:-http://127.0.0.1:5052}
FRP=${TUNNEL_STATUS_URL:-http://127.0.0.1:7400/api/status}
NW=${NODEWATCH_URL:-http://127.0.0.1:8080}
PROJECT=${NODE_COMPOSE_PROJECT:-arkiv-community-node}
CHAIN=0x76edaf
FAIL=0

ok()   { printf '  \033[32mok\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n        fix: %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mwarn\033[0m  %s\n        hint: %s\n' "$1" "$2"; }
rpc()  { curl -s -m 5 -X POST -H 'Content-Type: application/json' \
           --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}" "$EL"; }
field(){ sed -n "s/.*\"$1\":\"\{0,1\}\([^\",}]*\).*/\1/p" | head -1; }

echo "== host"
command -v docker >/dev/null && ok "docker $(docker version -f '{{.Server.Version}}' 2>/dev/null)" \
  || bad "docker not installed" "install Docker Engine 24+"
command -v curl >/dev/null || { echo "curl is required"; exit 99; }
if timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes; then ok "clock synchronized"
else bad "clock not NTP-synchronized" "enable chrony/systemd-timesyncd (consensus needs accurate time)"; fi
used=$(df --output=pcent / | tail -1 | tr -dc 0-9)
avail=$(df -BG --output=avail / | tail -1 | tr -dc 0-9)
if [ "$used" -lt 85 ]; then ok "root disk ${used}% used, ${avail} GiB free"
else bad "root disk ${used}% used" "grow the volume (gp3 can grow online) or prune old Docker images"; fi
memfree=$(awk '/MemAvailable/{print int($2/1048576)}' /proc/meminfo)
[ "$memfree" -ge 2 ] && ok "memory available ${memfree} GiB" || warn "only ${memfree} GiB memory available" "Nodewatch needs up to 3 GiB"

echo "== node kit containers ($PROJECT)"
for svc in execution consensus tunnel; do
  st=$(docker ps -a --filter "label=com.docker.compose.project=$PROJECT" \
        --filter "label=com.docker.compose.service=$svc" --format '{{.State}} {{.Status}}' 2>/dev/null | head -1)
  case "$st" in
    running*) ok "$svc: ${st#running }" ;;
    "")       bad "$svc: no container" "cd /opt/arkiv-community-node && ./setup.sh" ;;
    *)        bad "$svc: $st" "docker compose -p $PROJECT logs --tail 100 $svc; then docker compose -p $PROJECT up -d $svc" ;;
  esac
done
oom=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" | xargs -r docker inspect -f '{{.Name}} {{.State.OOMKilled}}' | grep true)
[ -z "$oom" ] && ok "no OOM kills" || bad "OOM killed: $oom" "give the host more memory or lower reth cache settings"

echo "== execution (reth) $EL"
cid=$(rpc eth_chainId | field result)
if [ -z "$cid" ]; then bad "EL RPC not answering" "check the execution container logs; the port must be 127.0.0.1:8545"
else
  [ "$cid" = "$CHAIN" ] && ok "chain id $cid (Rabdi)" || bad "chain id $cid, expected $CHAIN" "NETWORK in the node kit .env must be rabdi"
  syncing=$(rpc eth_syncing | field result)
  [ "$syncing" = "false" ] && ok "not syncing" || warn "still syncing" "wait; snapshot restore takes ~5-10 minutes"
  head=$(( $(rpc eth_blockNumber | field result) ))
  ref=$(curl -s -m 8 -X POST -H 'Content-Type: application/json' \
         --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
         https://rpc.rabdi.db-chain.testnet.arkiv.network | field result)
  if [ -n "$ref" ]; then
    lag=$(( $(printf '%d' "$ref") - head ))
    [ "$lag" -le 10 ] && ok "head $head, lag $lag vs reference" || bad "head $head is $lag blocks behind" "check peers and consensus; restart consensus if el_offline"
  else warn "reference RPC unreachable" "outbound HTTPS blocked or rate-limited"; fi
  peers=$(( $(rpc net_peerCount | field result) ))
  [ "$peers" -gt 0 ] && ok "EL peers $peers" || bad "EL has 0 peers" "allow outbound TCP/UDP 30303 and check the bootnodes"
fi

echo "== consensus (lighthouse) $CL"
code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$CL/eth/v1/node/health")
case "$code" in
  200) ok "beacon healthy" ;;
  206) warn "beacon syncing (206)" "wait for sync" ;;
  *)   bad "beacon health $code" "check consensus logs; it must reach the EL engine API" ;;
esac
clp=$(curl -s -m 5 "$CL/eth/v1/node/peer_count" | field connected)
[ "${clp:-0}" -gt 0 ] && ok "CL peers $clp" || bad "CL has 0 peers" "allow outbound 9000 TCP/UDP"

echo "== tunnel (frpc) $FRP"
t=$(curl -s -m 5 "$FRP")
tst=$(printf '%s' "$t" | field status)
if [ "$tst" = "running" ]; then ok "tunnel running, remote $(printf '%s' "$t" | field remote_addr)"
elif [ -z "$t" ]; then warn "no tunnel status" "not in the community pool yet: ./marketplace.sh offer, then ./start-tunnel.sh"
else bad "tunnel status '$tst': $(printf '%s' "$t" | field err)" "./start-tunnel.sh in the node kit; check the agreement has not expired"; fi

echo "== nodewatch $NW"
nws=$(docker ps -a --filter name=^nodewatch$ --format '{{.Status}}')
case "$nws" in
  *healthy*|Up*) ok "container: $nws" ;;
  "") bad "nodewatch container missing" "cd /opt/nodewatch && docker compose up -d" ;;
  *)  bad "container: $nws" "docker logs --tail 100 nodewatch" ;;
esac
h=$(curl -s -m 5 "$NW/api/health")
if [ -z "$h" ]; then bad "UI/API not answering on $NW" "check HOST/PORT in /opt/nodewatch/.env and docker logs nodewatch"
else
  down=$(printf '%s' "$h" | grep -o '"[a-z-]*":{"ok":false' | cut -d'"' -f2 | tr '\n' ' ')
  [ -z "$down" ] && ok "api/health ok, all collectors ok" || bad "collectors failing: $down" "open the UI → Settings → collectors, or docker logs nodewatch"
fi
if [ -f /opt/nodewatch/.env ]; then
  perm=$(stat -c %a /opt/nodewatch/.env)
  [ "$perm" = 600 ] && ok ".env mode 600" || bad ".env mode $perm" "chmod 600 /opt/nodewatch/.env"
  grep -q '^HOST=127.0.0.1' /opt/nodewatch/.env && ok "bound to loopback" || warn "HOST is not 127.0.0.1" "keep Nodewatch on loopback and tunnel to it"
fi
exposed=$(ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ':(8545|5052|7400|8080)$' | grep -vE '^(127\.0\.0\.1|\[::1\]):' || true)
[ -z "$exposed" ] && ok "8545/5052/7400/8080 on loopback only" || bad "exposed on a public interface: $exposed" "bind these ports to 127.0.0.1"

echo
[ "$FAIL" -eq 0 ] && echo "All checks passed." || echo "$FAIL check(s) failed."
exit "$FAIL"
