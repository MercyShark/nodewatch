# Nodewatch

**A web3-native operations console for Arkiv node operators, in one container.**

Nodewatch runs next to an [Arkiv community node](https://github.com/gumb0/arkiv-community-node) and shows what
only the inside of the host can see. It tells you why the node is or isn't earning, when the disk fills up, whether
the tunnel and marketplace agreement are alive, and which query shapes are slow. It also publishes the node's
health as a self-expiring entity **on Arkiv itself**, so other operators can watch the node from anywhere.

- **Verdict engine.** One answer to "is my node serving?" (`healthy`, `lagging`, `tunnel_down`, `container_down`…),
  with the reason and the fix. Where the fix is safe to automate, a **Fix it** button runs it after a confirmation:
  start or restart the stopped container, restart the tunnel, or run one autopilot pass. The server re-checks the
  live verdict first, honours the kit's stop grace periods, and logs every run.
- **Updates.** Nodewatch checks Docker Hub every 6 hours and shows "Update available" in the top bar. It never updates
  on its own: Settings → Updates → **Update Nodewatch** pulls the new image and restarts into it with the same settings,
  and puts the previous version back automatically if the new one does not start healthy. The node is not touched.
- **Free up disk space.** Shows the Docker build cache and untagged images with their sizes, and frees them in one
  click. Chain data, volumes and tagged images are never touched.
- **Node profile on Arkiv.** A name, country and contact for the node, signed by the provider key (a message
  signature, no transaction) and written by the heartbeat key as `nodewatch.profile`. Fleet views show it only when
  the signature checks out, so nobody can name somebody else's node.
- **Host + container metrics.** CPU, memory, disk, IO and the chain volume sizes (allocated bytes; reth's `mdbx.dat`
  is sparse), with a disk-full forecast.
- **Chain view.** Head lag against the reference RPC, EL/CL peers, finality.
- **Pool view.** Community LB listing, our offer and agreement (port, time left), the call counter, the provider's
  tGLM balance.
- **RPC proxy.** Optional passive proxy in front of `:8545` for per-method latency and error rates.
- **Autopilot.** Keeps the node in the pool with no operator: re-posts the offer before the agreement lapses, signs
  the tunnel token and rewrites the kit's `.env` + `frpc.toml` for the new agreement, restarts the tunnel container
  when it exits. The provider key is unlocked **in memory only** (once per restart in the UI, or from
  `PROVIDER_KEYSTORE_PASSWORD`); the keystore stays encrypted on disk and nothing else in the kit is touched. Every
  action is logged with its tx. Off by default. A self-chosen node label goes into the heartbeat and the offer.
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
docker run -d --name nodewatch --restart unless-stopped \
  --network host \
  -v nodewatch:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker:/data-root:ro \
  -v /proc:/host/proc:ro -v /sys:/host/sys:ro \
  -v /:/host/root:ro,rslave \
  -v /opt/arkiv-community-node:/host/root/opt/arkiv-community-node \
  -e HOST=0.0.0.0 -e PORT=8000 \
  -e PUBLIC_ORIGIN=http://YOUR_SERVER_IP:8000 \
  -e ADMIN_ADDRESSES=0xYourWallet \
  -e TELEGRAM_BOT_TOKEN=123456:your-bot-token \
  -e PAGERDUTY_ROUTING_KEY=your-events-v2-key \
  rishabhdev04/nodewatch:latest
```

The image is public on Docker Hub ([rishabhdev04/nodewatch](https://hub.docker.com/r/rishabhdev04/nodewatch)). On
first start Nodewatch sets itself up: it creates its heartbeat wallet in the data volume (fund it with a little tGLM;
the dashboard shows the address), reads the provider address from the kit's keystore, and links Telegram when you send
`/start` to your bot. Leave out any `-e` key you don't use. The console listens on port 8000 on every interface:
allow TCP 8000 in the firewall, open `http://YOUR_SERVER_IP:8000` and sign in with the wallet you named. There is no
password; only that wallet's signature opens it. To keep it on loopback instead, drop the `HOST`, `PORT` and
`PUBLIC_ORIGIN` lines and reach it through `ssh -L 8080:127.0.0.1:8080 your-node`.

`scripts/install.sh` remains for operators who also want a **node authorisation**: it asks the keystore password once
to sign a statement binding your admin wallet to the provider (signed inside the kit's own image, nothing stored).

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

**Who can sign in:** a wallet signature (SIWE) from an address on `ADMIN_ADDRESSES` (everything) or
`VIEWER_ADDRESSES` (read-only), optionally plus a username + password (`ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH`).
With the quick-start command the port is open to the internet and that allowlist is the only gate, which the 6 Nov
end-to-end run checked from outside: anonymous 401, unlisted wallet 403, listed wallet in.
Leave `ADMIN_PASSWORD_HASH` empty for wallet-only login. There is no self-registration, and five wrong attempts lock
sign-in for a minute. The RPC proxy
stays on loopback (`PROXY_HOST`). The UI is plain HTTP (no ALB/ACM, EC2 only), so keep the allowlist to trusted IPs.

Deploying over SSH (no registry, no S3): `./scripts/deploy.sh [ssh-host]` (default host alias `nodewatch`). It sends
the committed source (~350 KB), builds the image on the host, restarts Nodewatch and waits for it to report healthy.
Add `--image` to build locally and stream the image (~130 MB) instead.

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
| `0xc90560311310162677c50Ef4bF5ae188295f947d` | `nodewatch.heartbeat`, `nodewatch.bundle`, `nodewatch.profile` | Nodewatch hot key (`HEARTBEAT_PRIVATE_KEY`) |
| `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` | `nwbench.item` (own-node slow-query runs, 6 h expiry) | bench writer (`BENCH_PRIVATE_KEY`) |
| `0xbD78B7d668282b8950774aB013706237b05a1880` | `rpc.offer` (via the node kit's `marketplace.sh`, or Nodewatch's autopilot) | node provider key; Nodewatch uses it only while an admin has unlocked it in memory (see Security) |

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
- Docker socket access goes through an in-app allowlist: reads limited to the node stack's containers; create/remove
  of one labelled bench sandbox with a fixed image; start/restart (never stop or remove) of the execution, consensus
  and tunnel containers; prune of the build cache and untagged images; and, when an admin clicks Update, a pull of the
  configured Nodewatch image plus one updater container that replaces only Nodewatch itself. No other Docker write exists.
- The provider key is never written anywhere by Nodewatch, and it is locked by default. Heartbeats, profile writes and
  benchmarks use separate hot keys. When an admin unlocks it (or sets `PROVIDER_KEYSTORE_PASSWORD`), it is decrypted
  into process memory only, for three signatures: the autopilot's offer (the only transaction it sends), the tunnel
  token, and the node profile (both message signatures, no gas). It can be locked again at any time, and every use
  is logged.
- Mutating API routes require `x-requested-with: nodewatch` plus an Origin check.

## How AI was used

Built with **Claude Code** (Anthropic, Claude Opus). The human operator chose the track and the product, set the
requirements and constraints (one container, EC2 only, notification channels, security rules), ran and approved every
infrastructure change and on-chain write, and funded the keys. Claude wrote the spec (`CLAUDE.md`), the Terraform for
the node host (separate repo), most of the server and web code, and the tests, and ran the node and pool setup through
Session Manager under the operator's approval. All behaviour shown in the demo was verified against the live node.

## License

Apache-2.0. See `LICENSE`.
