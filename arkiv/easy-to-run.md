# Easy to run

## Requirements

| | Minimum | Ours |
|---|---|---|
| Host | the node kit's own requirements + 2 vCPU / 3 GiB for Nodewatch | `r7i.2xlarge` (8 vCPU / 64 GiB) |
| Disk | room for chain growth; Nodewatch itself uses < 1 GiB (`/srv/nodewatch`) | 1,000 GiB gp3, 12k IOPS |
| Software | Docker Engine 24+ with compose v2, `curl` | Docker 29.9.2, Ubuntu 24.04 |
| Network | outbound only; nothing inbound | security group with no inbound rules |
| Node | Arkiv node kit running (`arkiv-community-node`) | commit `4c9f5f2`, Rabdi |

## Install

```bash
git clone <this repo> /opt/nodewatch && cd /opt/nodewatch
cp .env.example .env && chmod 600 .env     # set INSTANCE_NAME, PROVIDER_ADDRESS, ADMIN_PASSWORD_HASH
sudo mkdir -p /srv/nodewatch
docker compose up -d --build
./scripts/doctor.sh
```

## Timings (measured on our host, Nov 4, 2026)

| Step | Time |
|---|---|
| EC2 boot → node kit cloned → snapshot restored → synced (block 171,553) | ~6 min |
| Offer posted → agreement accepted → tunnel `SERVING` | ~2 min |
| Image build on a laptop (cached layers) | ~1–2 min |
| Image transfer over a Session Manager port-forward (136 MB gzip) | ~5 min (299 s) |
| `docker compose up -d` → `/api/health` ok, all collectors green | < 30 s |
| `doctor.sh` full run | ~5 s |

_Pending: one timed end-to-end run on a clean host, from `git clone` to a logged-in dashboard, recorded for the demo._

## `scripts/doctor.sh`

Read-only. Run on the host. It checks the host (Docker, NTP, disk, memory), the three node kit containers and OOM
kills, the EL (chain id, sync, lag vs reference, peers), the CL (health, peers), the tunnel, the Nodewatch container
and API, `.env` permissions and loopback binding, and that 8545/5052/7400/8080 aren't exposed. Every failure prints a
fix. The exit code is the number of failures, so it works in CI and cron.

Our node: **20 checks, all passed.**

## When it fails

| Symptom | Likely cause | Fix |
|---|---|---|
| Verdict `container_down` | a node kit container exited | `docker compose -p arkiv-community-node logs --tail 100 <svc>` then `up -d <svc>` |
| Verdict `wrong_chain` | node kit `.env` has the wrong `NETWORK` | set `NETWORK=rabdi`, re-run `setup.sh` |
| Verdict `lagging` | few peers, or CL not driving the EL | check peers. Restart consensus if `el_offline` |
| Verdict `tunnel_down` | agreement expired, or frpc can't reach the LB | `./start-tunnel.sh`. Check the Pool view for agreement time left |
| Verdict `no_agreement` | offer not accepted yet / pool full | wait, or re-post the offer with `./marketplace.sh offer` |
| Verdict `low_gas` | Nodewatch hot key below `LOW_GAS_THRESHOLD_GLM` | claim tGLM for the heartbeat address from the faucet |
| Docker collector red | socket not mounted | keep `/var/run/docker.sock` in `compose.yaml` |
| Volume sizes 0 | `/var/lib/docker` not mounted at `/data-root` | keep the `:ro` mount in `compose.yaml` |
| Password login returns "password login is not configured" | `ADMIN_PASSWORD_HASH` not set (and no `ADMIN_ADDRESSES` for SIWE) | `pnpm --filter @nodewatch/server hash-password` |
| Mutating actions return 403 "cross-site request refused" | wrong `PUBLIC_ORIGIN` | set it to the URL in your browser bar (e.g. `http://localhost:8080`) |
| Heartbeat disabled | `HEARTBEAT_ENABLED=false` or key unfunded | fund the address, set `true`, `docker compose up -d` |
