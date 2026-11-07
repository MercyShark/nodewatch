# Nodewatch

**A web3-native operations console for Arkiv node operators, in one container.**

| Live | URL |
|---|---|
| Nodewatch console | http://13.205.125.33:8000 |
| Fleet Grafana | http://13.207.201.4:3000/ |

**Nodewatch login for the pitch:** today only, any wallet can sign in to the Nodewatch console with read-only
access. Open the link, connect a browser wallet such as MetaMask and sign the message. No transaction or gas is
needed.

**Grafana login for the pitch:** username `admin`, password `ePI8Tk8OIJfFLUXcewkZ`. This password is for today's pitch
only and will be deactivated afterwards.

## About

Nodewatch is an ops console for Arkiv community nodes. It runs as one extra Docker container on the same host as the
node kit, needs no changes to the node, and gives the operator one screen for everything that normally gets watched by
hand: whether the node is healthy and in sync, whether it is still in the load balancer's rotation, how full the disk
will be next week, and what the pool is actually asking the node.

**The problem:** the community node kit is easy to start and hard to keep alive. The tunnel to the load balancer dies,
the disk fills up, a container restarts, and the node silently drops out of rotation. Operators usually find out when
payouts stop. Nobody can see which queries the pool sends to a node or which ones are slow.

**What Nodewatch does:**

1. **Watches the node.** Execution, consensus and tunnel containers, head lag, peers, CPU, memory and disk, with a
   disk-full forecast, and the node's public status on the Arkiv node list.
2. **Alerts you.** Every failed check goes to Telegram. Critical ones (a container down, the node out of rotation, a
   request slower than 3 seconds) open a PagerDuty incident that rings your phone and reads the incident out. Alerts
   resolve themselves and can be silenced from the console.
3. **Fixes things.** For every failure the dashboard shows the exact command and a one-click fix: restart whichever
   container is down (tunnel, execution or consensus), and the same flow for a major outage where the whole node kit
   has to come back. Updating Nodewatch itself is also one click.
4. **Live queries.** Nodewatch sits inline on the tunnel between the load balancer and the node, times every read
   request the pool sends, keeps the query text, and shows requests per minute, average and p95 latency, error rate,
   and the slowest query shapes. Any request over 750 ms is sent to Telegram with its text.
5. **Fleet view.** A small Grafana Alloy container on each node pushes metrics and the per-request log to one central
   Grafana, so several nodes fit on one screen: who is slow, who is failing, what the pool is asking.
6. **Slow-query benchmarks.** Nodewatch writes private datasets of 500 to 5,000 entities to Arkiv and runs 29 query
   shapes against them, measuring p95 per shape and how latency grows with dataset size. The report shows which shapes
   scale linearly, which ones to optimise, and the exact query text behind each number.

Also: a heartbeat entity written to Arkiv so the node proves it is alive on-chain, backups, and wallet (SIWE) login for
the console.

Everything in the demo video ran on a live Rabdi node during the hackathon: the tunnel was stopped on purpose, the node
left rotation, Nodewatch flagged it, the Telegram message and the PagerDuty phone call arrived, and the node came back
after the one-click restart.

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
