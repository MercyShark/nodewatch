# Nodewatch

**A web3-native operations console for Arkiv node operators, in one container.**

Nodewatch runs next to an [Arkiv community node](https://github.com/gumb0/arkiv-community-node) and shows what
only the inside of the host can see. It tells you why the node is or isn't earning, when the disk fills up, whether
the tunnel and marketplace agreement are alive, and which query shapes are slow. It also publishes the node's
health as a self-expiring entity **on Arkiv itself**, so other operators can watch the node from anywhere.

- **Verdict engine.** One answer to "is my node serving?" (`healthy`, `lagging`, `tunnel_down`, `container_down`…),
  with the reason and the fix.
- **Host + container metrics.** CPU, memory, disk, IO and the chain volume sizes (allocated bytes; reth's `mdbx.dat`
  is sparse), with a disk-full forecast.
- **Chain view.** Head lag against the reference RPC, EL/CL peers, finality.
- **Pool view.** Community LB listing, our offer and agreement (port, time left), the call counter, the provider's
  tGLM balance.
- **RPC proxy.** Optional passive proxy in front of `:8545` for per-method latency and error rates.
- **Heartbeats on Arkiv.** A `nodewatch.heartbeat` entity renewed every 30 s with a 60-block (~2 min) expiry. When
  the host dies the entity expires, so it acts as a dead man's switch that needs no extra infrastructure.
- **Fleet view.** Live heartbeats from trusted creators, with expiry countdowns.
- **Slow-query finder.** Loads test data into your own node and times 42 query shapes over two datasets (synthetic
  `nwbench.item`, live marketplace entities) at several sizes. Three modes: **own node** (real Rabdi state, paid in
  tGLM by a dedicated writer, up to 5,000 entities), **private node** (a throwaway Arkiv dev node on the same host,
  free, up to 50,000), **live market** (read-only). Queries never go to a public endpoint. Seven views: summary with a risk map,
  shapes × datasets coverage, heatmap and log-log scaling, OFFSET vs cursor paging, a per-shape explorer (latency
  spread, fit and projection, history), run comparison, and the method. A demo-safe mode shows `shape #N` only.
  Findings stay private.
- **Swarm vault.** Diagnostic bundles encrypted to an Arkiv engineer's Ethereum key (ECIES secp256k1 + AES-256-GCM),
  uploaded to Swarm and indexed on Arkiv as `nodewatch.bundle`. Only the recipient can read them.
- **Alerts.** Telegram and PagerDuty (Events v2 trigger/resolve), with dedupe, grouping, inhibition and
  silences.
- **Backups.** Encrypted node secrets and config to local disk and Swarm.
- **Login.** Sign-In with Ethereum: a one-time, domain-bound signature from an allowlisted wallet (admin/viewer
  roles). An argon2id admin password is optional; without it, only wallets can sign in.

## Node used

| | |
|---|---|
| Network | Arkiv **Rabdi** testnet, chain id `7794095` (`0x76edaf`) |
| Node kit | `gumb0/arkiv-community-node` @ `4c9f5f2` |
| Clients | `ghcr.io/arkiv-network/arkiv-reth:v1.0.0` + `sigp/lighthouse:v8.3.1` + frpc tunnel |
| Host | AWS EC2 `r7i.2xlarge` (8 vCPU / 64 GiB), one 1,000 GiB gp3 volume, ap-south-1, no inbound ports |
| Provider | `0xbD78B7d668282b8950774aB013706237b05a1880`, in the community pool (port 20009) |

Exactly two things run on the host: the node kit stack and the `nodewatch` container.

## Quick start (one command, on a host that already runs the node kit)

```bash
curl -fsSL https://raw.githubusercontent.com/rishabh-onerx/nodewatch/main/scripts/install.sh | sudo bash -s -- 0xYourAdminWallet
```

`scripts/install.sh` reads the provider address from the kit's keystore, asks the keystore password once to sign a
**node authorisation** naming your admin wallet (signed inside the kit's own image, keystore read-only, nothing
stored), creates a heartbeat key, writes `.env` (mode 600), builds and starts. Only that wallet can sign in; the
provider key never signs in and never leaves the host. Setup guide with troubleshooting: `site/index.html`.

Manual install:

```bash
git clone <this repo> /opt/nodewatch && cd /opt/nodewatch
cp .env.example .env               # set PROVIDER_ADDRESS, INSTANCE_NAME, ADMIN_PASSWORD_HASH
pnpm install && pnpm --filter @nodewatch/server hash-password   # argon2id hash for ADMIN_PASSWORD_HASH
sudo mkdir -p /srv/nodewatch
docker compose up -d --build
./scripts/doctor.sh                # checks node + Nodewatch, prints what to fix
```

By default the UI binds to `127.0.0.1:8080` only. From your laptop, use any tunnel you trust. On AWS:

```bash
aws ssm start-session --target <instance-id> --document-name AWS-StartPortForwardingSession \
  --parameters '{"portNumber":["8080"],"localPortNumber":["8080"]}'
# open http://localhost:8080
```

**Public UI (optional):** set `HOST=0.0.0.0`, `PORT=8000`, `PUBLIC_ORIGIN=http://<public-ip>:8000` and allow your IP
in the node-host Terraform (`nodewatch_allowed_cidrs`). Sign-in is a wallet signature (SIWE) from an address on
`ADMIN_ADDRESSES` / `VIEWER_ADDRESSES`, optionally plus username + password (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`).
Leave `ADMIN_PASSWORD_HASH` empty for wallet-only login. There is no self-registration, and five wrong attempts lock
sign-in for a minute. The RPC proxy
stays on loopback (`PROXY_HOST`). The UI is plain HTTP (no ALB/ACM, EC2 only), so keep the allowlist to trusted IPs.

Building on a laptop and shipping to EC2 with **only EC2 + Session Manager** (no registry, no S3):
`./scripts/deploy.sh <instance-id> [aws-profile] [region]`. On a slow uplink add `--remote-build`: it sends the
committed source (~300 KB) and builds the image on the instance instead of uploading it (~130 MB).

Local UI development without a node: `VITE_MOCK=1 pnpm --filter @nodewatch/web dev` (mock password `nodewatch`).

**Telegram alerts:** create a bot with @BotFather, then on the host run `sudo bash scripts/setup-telegram.sh`. It
reads the token without echo, finds your chat id from a message you send the bot, sends a test message, writes
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` to `.env` (mode 600) and restarts Nodewatch.

**PagerDuty (critical alerts):** in PagerDuty create a service with an *Events API V2* integration, then on the host run
`sudo bash scripts/setup-pagerduty.sh`. It reads the integration key without echo, can send a test incident that it
resolves again, writes `PAGERDUTY_ROUTING_KEY` to `.env` (mode 600) and restarts Nodewatch.

## Reproduce the demo

1. **Healthy:** Overview shows verdict `healthy`, head lag 0, pool agreement time left.
2. **Tunnel down:** `docker stop arkiv-community-node-tunnel-1`. Within about 15 s the verdict is `tunnel_down` and
   `TunnelDown` fires to the configured channels. `docker start` it and the alert resolves.
3. **Heartbeat:** Fleet shows this node with an expiry countdown. Stop Nodewatch (`docker compose stop`). Within
   ~2 min another Nodewatch's fleet view (or the query below) shows it gone.
4. **Slow-query finder** (admin): Slow queries → switch to **Demo-safe** → Start run (Private node: free, ~40 s; Own
   node: needs the bench writer funded). Walk the
   Summary, Shapes × datasets and Shape explorer tabs. Demo-safe shows `shape #N` only.
5. **Vault:** Vault → Create a bundle (Diagnostic) → Arkiv entity + Swarm reference. Decrypt it with
   `scripts/decrypt-bundle.ts` and the demo recipient key.

## Arkiv writer addresses

| Address | Writes | Key |
|---|---|---|
| `0xc90560311310162677c50Ef4bF5ae188295f947d` | `nodewatch.heartbeat`, `nodewatch.bundle` | Nodewatch hot key (`HEARTBEAT_PRIVATE_KEY`) |
| `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` | `nwbench.item` (own-node slow-query runs, 6 h expiry) | bench writer (`BENCH_PRIVATE_KEY`) |
| `0xbD78B7d668282b8950774aB013706237b05a1880` | `rpc.offer` only (via the node kit's `marketplace.sh`) | node provider key, **never used by Nodewatch** |

## One Arkiv query you can run

All live Nodewatch heartbeats on Rabdi:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"arkiv_query\",\"params\":[\"arkiv.schema = str('nodewatch.heartbeat')\",{\"select\":{\"key\":true,\"creator\":true,\"expiresAt\":true,\"attributes\":true},\"limit\":\"0x32\"}]}"
```

Our live heartbeat entity: `0x06afbccf5b0f3ac38841b5276c478343e620b9264803ac448f8d2d36ed0d60bd`. It's one entity,
patched and extended in place every 30 s. While the node runs, `expiresAt` is always ~1–2 min ahead of the head.
Stop Nodewatch and the query returns `[]` within ~2 minutes.

Combine filters with `AND`/`OR` (`&&` is rejected) and type literals: `headLag > u64(10)`, `status = str('ok')`.
Only ours: add `AND $creator = addr(0xc90560311310162677c50Ef4bF5ae188295f947d)` to the query string.

## Layout

```
apps/server   Fastify API, collectors, SQLite time series, verdict + alert engines, Arkiv/Swarm, bench
apps/web      React 19 + Vite + Tailwind 4 + framer-motion UI
packages/shared  API contract types
scripts/      deploy.sh, doctor.sh, setup-telegram.sh, setup-pagerduty.sh, hash-password.ts, decrypt-bundle.ts
arkiv/        judging notes: friction, real use, what's new, easy to run, schema, Swarm
```

`CLAUDE.md` is the full architecture and security spec.

## Security

- Ports 8545, 5052, 7400 and 18545 are never exposed. The only inbound rule is the optional UI port, limited to an
  allowlist of IPs.
- Docker socket access goes through an in-app allowlist: reads limited to the node stack's containers, plus
  create/remove of one labelled bench sandbox with a fixed image. No other Docker write call exists.
- The provider key is never read. Heartbeats use a separate hot key.
- Mutating API routes require `x-requested-with: nodewatch` plus an Origin check.

## How AI was used

Built with **Claude Code** (Anthropic, Claude Opus). The human operator chose the track and the product, set the
requirements and constraints (one container, EC2 only, notification channels, security rules), ran and approved every
infrastructure change and on-chain write, and funded the keys. Claude wrote the spec (`CLAUDE.md`), the Terraform for
the node host (separate repo), most of the server and web code, and the tests, and ran the node and pool setup through
Session Manager under the operator's approval. All behaviour shown in the demo was verified against the live node.

## License

Apache-2.0. See `LICENSE`.
