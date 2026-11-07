# Nodewatch

**A web3-native operations console for Arkiv node operators, in one container.**

| Live | URL |
|---|---|
| Nodewatch console | http://13.205.125.33:8000 |
| Fleet Grafana | http://13.207.201.4:3000/ |

Nodewatch runs next to an [Arkiv community node](https://github.com/gumb0/arkiv-community-node). It tells you whether
the node is earning, why not, and how to fix it. It also publishes the node's health as a self-expiring entity
**on Arkiv itself**, so anyone can watch the node from anywhere.

## Features

- **Verdict engine.** One answer to "is my node serving?" with the reason, and a **Fix it** button for safe fixes.
- **Autopilot.** Keeps the node in the pool: re-posts the offer, renews the tunnel token, restarts the tunnel.
- **Heartbeats on Arkiv.** A `nodewatch.heartbeat` entity renewed every 30 s with a ~2 min expiry: a dead man's switch.
- **Fleet view.** Live heartbeats and signed node profiles from other operators.
- **Slow-query finder.** Times 42 query shapes on your own node, a private dev node, or the live market.
- **Live queries.** Latency, errors and the slowest real pool requests, kept 48 h on your node.
- **Metrics.** Host, containers, chain lag, peers, pool agreement and a disk-full forecast.
- **Swarm vault.** Diagnostic bundles encrypted to an engineer's Ethereum key, stored on Swarm, indexed on Arkiv.
- **Alerts.** Telegram and PagerDuty, with dedupe, grouping and silences.
- **Login.** Sign-In with Ethereum from an allowlisted wallet. No passwords required.
- **Self-update and disk cleanup** in one click, with automatic rollback.

## Quick start

On a host that already runs the node kit:

```bash
docker run -d --name nodewatch --restart unless-stopped \
  --network host \
  -v nodewatch:/app/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker:/data-root:ro \
  -v /proc:/host/proc:ro -v /sys:/host/sys:ro \
  -v /:/host/root:ro,rslave \
  -v /opt/arkiv-community-node:/host/root/opt/arkiv-community-node \
  -e INSTANCE_NAME=my-node \
  -e HOST=0.0.0.0 -e PORT=8000 \
  -e PUBLIC_ORIGIN=http://YOUR_SERVER_IP:8000 \
  -e ADMIN_ADDRESSES=0xYourWallet \
  rishabhdev04/nodewatch:latest
```

Open `http://YOUR_SERVER_IP:8000` and sign in with the wallet you listed. Fund the heartbeat wallet shown on the
dashboard with a little tGLM. Alerts are set up with `scripts/setup-telegram.sh` and `scripts/setup-pagerduty.sh`.
For several nodes, see [deploy/grafana/README.md](deploy/grafana/README.md).

## Node used

| | |
|---|---|
| Network | Arkiv **Rabdi** testnet, chain id `7794095` |
| Node kit | `gumb0/arkiv-community-node` @ `4c9f5f2` |
| Clients | `arkiv-reth:v1.0.0` + `lighthouse:v8.3.1` + frpc tunnel |
| Host | AWS EC2 `r7i.2xlarge`, 1,000 GiB gp3, ap-south-1 |
| Provider | `0xbD78B7d668282b8950774aB013706237b05a1880`, community pool port 20009 |

## Try it on Arkiv

All live Nodewatch heartbeats on Rabdi:

```bash
curl -s https://rpc.rabdi.db-chain.testnet.arkiv.network \
  -H 'Content-Type: application/json' \
  --data "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"arkiv_query\",\"params\":[\"arkiv.schema = str('nodewatch.heartbeat')\",{\"select\":{\"key\":true,\"creator\":true,\"expiresAt\":true,\"attributes\":true},\"limit\":\"0x32\"}]}"
```

Stop Nodewatch and the query returns `[]` within about 2 minutes.

| Writer | Writes |
|---|---|
| `0xc90560311310162677c50Ef4bF5ae188295f947d` | `nodewatch.heartbeat`, `nodewatch.bundle`, `nodewatch.profile` |
| `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` | `nwbench.item` (slow-query runs) |
| `0xbD78B7d668282b8950774aB013706237b05a1880` | `rpc.offer` (node provider) |

## Security

- Node ports 8545, 5052, 7400 and 18545 are never exposed.
- Docker access goes through a strict in-app allowlist. Nodewatch never stops or removes node containers.
- The provider key stays encrypted on disk and is unlocked in memory only, on admin request. Every use is logged.

## Repo

```
apps/server      Fastify API, collectors, verdict and alert engines, Arkiv/Swarm
apps/web         React 19 + Vite + Tailwind UI
packages/shared  API types
scripts/         deploy, doctor, alert setup
arkiv/           judging notes
```

`CLAUDE.md` holds the full architecture and security spec.

## How AI was used

Built with **Claude Code** (Anthropic). The operator chose the product, set the requirements, and approved every
infrastructure change and on-chain write. Claude wrote the spec, most of the code and tests, and ran the node setup
under the operator's approval. Everything in the demo was verified against the live node.

## License

Apache-2.0. See `LICENSE`.
