#!/usr/bin/env bash
# One-command Nodewatch install, on a host that already runs the Arkiv node kit.
#
#   curl -fsSL https://raw.githubusercontent.com/<owner>/nodewatch/main/scripts/install.sh | sudo bash -s -- 0xYourAdminWallet
#   # or, from a clone:  sudo scripts/install.sh 0xYourAdminWallet
#
# What it does, in order:
#   1. finds the node kit (/opt/arkiv-community-node) and reads the provider address from its keystore;
#   2. asks the keystore password ONCE, to sign the node authorisation that names your admin wallet.
#      The signing runs in the node kit's own marketplace image with the keystore mounted read-only;
#      the password and the provider key never leave that process and are never written anywhere;
#   3. creates a heartbeat hot key, writes /opt/nodewatch/.env (mode 600), builds and starts Nodewatch;
#   4. prints the URL. Only your wallet can sign in; the login page shows which node it belongs to.
#
# Re-running is safe: an existing .env keeps its values; only missing ones are added.
set -euo pipefail

ADMIN=${1:-${NODEWATCH_ADMIN:-}}
KIT=${NODE_KIT_DIR:-/opt/arkiv-community-node}
DEST=${NODEWATCH_DIR:-/opt/nodewatch}
REPO=${NODEWATCH_REPO:-https://github.com/rishabh-onerx/nodewatch.git}
PORT=${NODEWATCH_PORT:-8000}
HOST_BIND=${NODEWATCH_HOST:-0.0.0.0}
CHAIN_ID=7794095

say()  { printf '\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "run as root: sudo bash install.sh 0xYourAdminWallet"
command -v docker >/dev/null || fail "Docker is required (https://docs.docker.com/engine/install/)"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
command -v git >/dev/null || fail "git is required"
[ -d "$KIT" ] || fail "node kit not found at $KIT (set NODE_KIT_DIR if it lives elsewhere)"
[ -f "$KIT/secrets/provider-key.json" ] || fail "no provider keystore at $KIT/secrets/provider-key.json: run the kit's ./marketplace.sh create-key first"

# The provider address is in the keystore in clear (no password needed).
PROVIDER=$(python3 -c 'import json,sys;a=json.load(open(sys.argv[1]))["address"];print(("0x"+a) if not a.startswith("0x") else a)' "$KIT/secrets/provider-key.json")
say "node kit at $KIT, provider address $PROVIDER"

if [ -z "$ADMIN" ]; then
  read -rp "Admin wallet address (the MetaMask/hardware wallet that will sign in, NOT the provider key): " ADMIN
fi
[[ "$ADMIN" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "'$ADMIN' is not an Ethereum address"
[ "${ADMIN,,}" != "${PROVIDER,,}" ] || fail "the admin wallet must not be the provider key: use a separate wallet"

# ---- 1. node authorisation: the provider key signs, once, who may administer Nodewatch ----
if [ -f "$DEST/.env" ] && grep -q '^NODE_AUTHORIZATION=' "$DEST/.env"; then
  say "node authorisation already present in $DEST/.env (delete that line to re-sign)"
  AUTH=$(sed -n 's/^NODE_AUTHORIZATION=//p' "$DEST/.env" | tail -1)
else
  IMAGE=$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -m1 'arkiv-community-node-marketplace' || true)
  [ -n "$IMAGE" ] || fail "the node kit's marketplace image is not built yet: run ./marketplace.sh status once in $KIT"
  read -rsp "Keystore password for the provider key (used once, in memory, to sign the authorisation; not stored): " KS_PASS; echo
  [ -n "$KS_PASS" ] || fail "empty password"
  ISSUED=$(date +%s)
  # The statement text is identical to apps/server/src/auth/nodeAuth.ts authorizationMessage().
  AUTH=$(KS_PASS="$KS_PASS" docker run --rm -i \
      -e KS_PASS -e ADMIN="$ADMIN" -e ISSUED="$ISSUED" -e CHAIN_ID="$CHAIN_ID" \
      -v "$KIT/secrets/provider-key.json:/ks.json:ro" --entrypoint node "$IMAGE" -e '
const { Wallet, getAddress } = require("ethers");
const fs = require("fs");
(async () => {
  const w = await Wallet.fromEncryptedJson(fs.readFileSync("/ks.json", "utf8"), process.env.KS_PASS);
  const admin = getAddress(process.env.ADMIN), issued = Number(process.env.ISSUED), chain = Number(process.env.CHAIN_ID);
  const msg = [
    "Nodewatch node authorization", "",
    `I run the Arkiv node with provider address ${w.address}.`,
    `I authorize the wallet ${admin} to administer Nodewatch for this node.`,
    "", `Chain ID: ${chain}`, `Issued At: ${new Date(issued * 1000).toISOString()}`,
  ].join("\n");
  const sig = await w.signMessage(msg);
  process.stdout.write(`${w.address}:${admin}:${issued}:${sig}`);
})().catch((e) => { console.error(e.message.includes("password") ? "wrong keystore password" : e.message); process.exit(1); });
') || fail "could not sign the authorisation (wrong password?)"
  unset KS_PASS
  say "authorisation signed by $PROVIDER for admin $ADMIN"
fi

# ---- 2. source ----
if [ -d "$DEST/.git" ]; then
  say "updating $DEST"; git -C "$DEST" pull -q --ff-only || true
elif [ -f "$(dirname "$0")/../compose.yaml" ] && [ "$(cd "$(dirname "$0")/.." && pwd)" != "$DEST" ]; then
  say "copying source to $DEST"; mkdir -p "$DEST"; cp -a "$(cd "$(dirname "$0")/.." && pwd)/." "$DEST/"
elif [ ! -f "$DEST/compose.yaml" ]; then
  say "cloning $REPO into $DEST"; git clone -q "$REPO" "$DEST"
fi
cd "$DEST"

# ---- 3. configuration ----
mkdir -p /srv/nodewatch
touch .env; chmod 600 .env
setenv() { # setenv KEY VALUE: add if missing, never overwrite
  grep -q "^$1=" .env || printf '%s=%s\n' "$1" "$2" >> .env
}
PUBLIC_IP=$(curl -s -m 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)
HEARTBEAT_KEY=$(docker run --rm --entrypoint node "$IMAGE" -e 'process.stdout.write(require("ethers").Wallet.createRandom().privateKey)' 2>/dev/null \
  || python3 -c 'import secrets;print("0x"+secrets.token_hex(32))')
setenv HOST "$HOST_BIND"
setenv PORT "$PORT"
setenv PROXY_HOST 127.0.0.1
setenv INSTANCE_NAME "$(hostname -s)"
setenv NODE_KIT_DIR "$KIT"
setenv PROVIDER_ADDRESS "$PROVIDER"
setenv NODE_AUTHORIZATION "$AUTH"
setenv HEARTBEAT_PRIVATE_KEY "$HEARTBEAT_KEY"
setenv HEARTBEAT_ENABLED false
setenv PUBLIC_ORIGIN "http://${PUBLIC_IP:-localhost}:$PORT"
chmod 600 .env

# ---- 4. build and start ----
say "building and starting Nodewatch (a few minutes the first time)"
docker compose up -d --build >/dev/null
for _ in $(seq 1 40); do curl -sf -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 3; done
curl -sf -m 3 "http://127.0.0.1:$PORT/api/health" >/dev/null || { docker logs --tail 40 nodewatch; fail "Nodewatch did not come up; see the log above"; }

HB_ADDR=$(docker exec -w /app/server nodewatch node -e 'const {privateKeyToAccount}=require("viem/accounts");process.stdout.write(privateKeyToAccount(process.env.HEARTBEAT_PRIVATE_KEY).address)')
cat <<EOF

$(printf '\033[1;32mNodewatch is running.\033[0m')

  URL:            http://${PUBLIC_IP:-<this host>}:$PORT   (also http://localhost:$PORT over an SSM port-forward)
  Node:           $PROVIDER
  Sign in with:   $ADMIN  (Sign in with Ethereum; no password exists)
  Heartbeat key:  $HB_ADDR  -> fund it with tGLM from the faucet, then set HEARTBEAT_ENABLED=true in $DEST/.env
                  and run: cd $DEST && docker compose up -d

  Open the port:  allow TCP $PORT inbound to this host (security group / firewall). Nothing else needs opening;
                  the node's 8545/5052/7400 stay on loopback. Only the wallet above can sign in.
  Alerts:         sudo bash $DEST/scripts/setup-telegram.sh
  Health check:   sudo bash $DEST/scripts/doctor.sh
EOF
