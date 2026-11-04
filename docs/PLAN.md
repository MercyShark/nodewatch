# Nodewatch — Project Init

> A dashboard inside the car for Arkiv node operators: it says what is wrong
> before the node dies, and proves to everyone, through self-expiring
> heartbeats on Arkiv, which nodes are truly alive.

- **Event:** ETHGlobal Mumbai 2026 (workshops Thu Nov 5; hacking after)
- **Target prizes:** Arkiv **Node tooling** ($2,000) + **Arkiv + Swarm bonus** ($500; does not use another partner pick)
- **Status of this file:** design and plan only. Written before the event; no project code exists yet.

---

## 0. Rules we must respect (read first)

| Rule | Source | What it means for us |
|---|---|---|
| Built from scratch at ETHGlobal Mumbai, **a new repo** that runs next to the node | Node tooling track | Create the repo **at the event**. Keep this file outside the repo until then; add it in the first commit as `docs/PLAN.md`. A PR to an existing repo does not count. |
| Works against an Arkiv node in the demo; a node on our own machine is enough | Node tooling track | The Rabdi node on our VM is the demo target. |
| **Slow query shapes go to Arkiv privately**, never into the public repo, `friction.md` or the demo | Node tooling track | The slow-query finder writes findings to a local, git-ignored file and to an **encrypted** Swarm bundle. The demo uses synthetic data only. |
| Run the slow-query finder **only on our own node**, never on a public endpoint | Node tooling track | Hard-code a guard: refuse to run unless the target is `127.0.0.1` or a local dev node. |
| Public repo with an open-source license; **say how AI was used** | ETHGlobal + Arkiv | `LICENSE` (Apache-2.0) and an "AI usage" section in the README. |
| One file per judging criterion | Node tooling track | `/arkiv/friction.md`, `/arkiv/real-use.md`, `/arkiv/whats-new.md`, `/arkiv/easy-to-run.md` |
| If the tool writes Arkiv entities: README lists the writing wallet address(es), plus `/arkiv/schema.md` | Node tooling track | We write heartbeats, so both are required. |
| Swarm bonus: `/arkiv/swarm.md` with the listed fields | Arkiv + Swarm bonus | See section 7. |
| **An encrypted Swarm reference contains its key; Arkiv entities are public** | Arkiv + Swarm bonus | Never store an encrypted reference in an entity as-is. Encrypt it to the recipient first, or keep it off Arkiv. |
| Each team can win **one** Arkiv track prize | Arkiv | Submit to Node tooling only, plus the Swarm bonus. |

---

## 1. The problem

- Community operators run Arkiv nodes behind a load balancer (`community.rpc.arkiv.network`).
- nodes.arkiv.network sees nodes **from the outside only**: answered or not, in rotation or not. On Nov 1 it showed **7 of 9 nodes in rotation**, 2 "behind the network, health checks not passing", with no reason given.
- The node kit's only on-box monitoring is Docker health badges and optional Uptime Kuma (keyword checks on 3 URLs). There is **no disk forecast, no per-method view, no explanation of why a node left rotation**.
- The kit's README: chain state "grows by **tens of GB a day** on a busy network, so plan for 1 TB". Disk is the most likely silent killer.

## 2. What Nodewatch does (MVP)

1. **Disk forecast**: days until the disk is full, with alerts at < 7 days (warning) and < 2 days (critical).
2. **Why am I out of rotation?** One plain-language verdict from ordered rules (section 5).
3. **Requests and latency per method** via an optional reverse proxy in front of the node's RPC.
4. **Peers, sync, head lag, CPU, memory, container restarts** in one dashboard.
5. **Heartbeats on Arkiv**: a short-lived `nodewatch.heartbeat` entity renewed every ~30s. A dead node stops renewing and its heartbeat **expires everywhere**.
6. **Encrypted diagnostic bundle on Swarm**: logs, metrics snapshot and `status.sh` output, shared privately with Arkiv engineers (Swarm bonus).

**Stretch:** slow-query finder (synthetic data, own node only), a Telegram bot with `/status`, and a public "fleet view" page that reads every node's heartbeat from Arkiv.

---

## 3. Environment

### Our node machine
- 4–8 cores, **16 GB RAM**, **1 TB SSD**. This meets the kit's comfortable level (8 GB RAM) and recommended disk (1,000 GB).
- Node kit: https://github.com/gumb0/arkiv-community-node with `NETWORK=rabdi`
- Compose project name: `arkiv-community-node`

### What we read from (all loopback-only on the node)

| Source | Address | Use |
|---|---|---|
| Execution JSON-RPC (Arkiv reth) | `http://127.0.0.1:8545` | `eth_chainId` (expect `0x76edaf`), `eth_blockNumber`, `eth_syncing`, `net_peerCount`, `web3_clientVersion`, `arkiv_query` |
| Consensus Beacon API (Lighthouse) | `http://127.0.0.1:5052` | `/eth/v1/node/syncing` (is_syncing, sync_distance, el_offline), `/eth/v1/node/peer_count`, `/eth/v1/node/health`, `/eth/v1/node/version` |
| Tunnel client (frpc) status | `http://127.0.0.1:7400/api/status` | Tunnel connected? (Kuma's keyword is `running`) |
| Docker Engine API | `/var/run/docker.sock` (mount **read-only**) | Container state, restarts, CPU and memory stats, events |
| Docker volumes | `arkiv-community-node_el-data`, `arkiv-community-node_cl-data` under Docker's data root | Volume size over time (disk forecast) |
| Filesystem holding Docker's data root | `statfs` on the data-root mount | Free bytes (disk forecast) |
| Official reference RPC | `https://rpc.rabdi.db-chain.testnet.arkiv.network` | Network head for lag. **Rate-limited**: sample at most every 60s and use our access key. |
| `./status.sh` output | Node kit | Pool, agreement and SERVING state (parse it or run it for the bundle) |

### Rabdi network
| | |
|---|---|
| Chain ID | `7794095` (`0x76edaf`) |
| Block time | 2 s (43,200 blocks per day) |
| Gas token | tGLM (faucet: https://hub.arkiv.network/faucet) |
| Access keys | https://hub.arkiv.network/access-keys |
| Explorer | https://rabdi.explorer.arkiv.network |

### To verify on hacking day (unknowns)
- [ ] Exact `arkiv_query` JSON-RPC params (docs: `/json-rpc/querying-data/`). Test one call against our node.
- [ ] Whether the load balancer's `/nodes` and `/health` admin API is publicly reachable (its README mentions it). If yes, use it to confirm "in rotation".
- [ ] Whether reth's Prometheus `--metrics` endpoint can be enabled through the kit's override without breaking `setup.sh` re-renders. If not, rely on the proxy and the APIs above.
- [ ] Swarm upload path: our own Bee node, or a postage batch from the Arkiv/Swarm booth (section 7).

---

## 4. Architecture

```
                        ┌──────────────── node machine ────────────────┐
 load balancer ──tunnel──► frpc ──► [ nodewatch-proxy :18545 ] ──► execution :8545
                        │              │ method, latency, status,       │
                        │              │ arkiv_query shape               │
                        │              ▼                                 │
                        │   [ nodewatch-agent ] ◄── docker.sock (ro)     │
                        │      collectors      ◄── consensus :5052       │
                        │      analyzer        ◄── frpc :7400            │
                        │      /metrics        ◄── volumes + statfs      │
                        │      heartbeat ──────────────► ARKIV (Rabdi)   │
                        │      bundle ─────────────────► SWARM (encrypted)
                        │         │                                      │
                        │         ▼                                      │
                        │   Prometheus ─► Grafana dashboard              │
                        │        └──────► Alertmanager ─► Telegram       │
                        └────────────────────────────────────────────────┘
```

### Proxy modes
- **Passive (default, zero risk):** the proxy is not in the paid traffic path. It measures our own test and probe traffic only.
- **Inline (opt-in):** point frpc's local target at the proxy so it sees real load-balancer traffic. The proxy is then in the paid path: it must be tiny, stream bodies, add no buffering beyond what's needed, and **fail open**. Document how to revert in one command.

### Stack
| Part | Choice | Why |
|---|---|---|
| Agent and proxy | **TypeScript on Node.js 22+** | The official Arkiv SDK (`@arkiv-network/sdk` + `viem`) is TypeScript. One language for everything. |
| Metrics | `prom-client` | Standard Prometheus exposition |
| Docker access | `dockerode` (read-only socket) | Container state, stats, events |
| Dashboards and alerts | Prometheus + Grafana + Alertmanager (Telegram receiver) | Operators already know them; provisioned from files so they work with zero clicks |
| Swarm | `@ethersphere/bee-js` against a Bee node | Official client |
| Packaging | One `compose.yaml` with a `nodewatch` profile that joins the node's network | "Easy to run" is 25% of the score |

---

## 5. Analyzer logic

### Disk forecast
- Sample every 5 minutes: `el-data` bytes, `cl-data` bytes, filesystem free bytes.
- Growth rate = linear regression of used bytes over the last 6 h (fast) and 24 h (stable). Report both and alert on the 6 h value.
- `days_to_full = free_bytes / max(rate_per_day, ε)`
- **Ignore step jumps** (snapshot restore, `--wipe`): a sample-to-sample jump of more than 5 GB resets the window.
- Alerts: `< 7 d` warning, `< 2 d` critical, `free < 20 GB` critical regardless of rate.

### "Why am I out of rotation?" (first matching rule wins)
1. Container `execution` or `consensus` not running, or restarting in a loop → "Container X is down or restart-looping (last error: …)"
2. Kernel OOM kills seen → "Out of memory: the execution client is being killed"
3. Disk free < 2% → "Disk full"
4. `eth_chainId` ≠ `0x76edaf` → "Wrong chain"
5. Beacon `el_offline = true` → "Consensus cannot reach the execution client"
6. `is_syncing = true` or lag vs reference > N blocks → "N blocks behind (catching up at X blocks/min, ETA …)"
7. Peers = 0 → "No peers: run `./setup.sh --refresh` (network files may have moved)"
8. Tunnel profile on but frpc status not `running` → "Tunnel down: see `docker compose logs tunnel`"
9. No agreement in `status.sh` → "Not in the pool: offer missing or expired (offers live 1 day)"
10. Otherwise → "Healthy and serving" (with requests per minute if the proxy is inline)

### Metrics to export (prefix `nodewatch_`)
`disk_free_bytes`, `volume_bytes{volume}`, `disk_growth_bytes_per_day{window}`, `disk_days_to_full`, `head_block`, `reference_head_block`, `head_lag_blocks`, `cl_sync_distance`, `peers{layer="el|cl"}`, `container_up{service}`, `container_restarts_total{service}`, `container_cpu_ratio{service}`, `container_mem_bytes{service}`, `tunnel_up`, `rpc_requests_total{method,status}`, `rpc_latency_seconds{method}` (histogram), `arkiv_query_latency_seconds{shape_id}` (private builds only), `heartbeat_last_success_timestamp`, `verdict{code}`.

---

## 6. Arkiv usage: heartbeats

### Schema `nodewatch.heartbeat`
| Column | Type | Indexed | Notes |
|---|---|---|---|
| `provider` | `addr` | yes | The node's provider address (from `./marketplace.sh create-key` output) |
| `status` | `str` | yes | `ok` / `degraded` / `down` |
| `verdict` | `str` | yes | The rotation rule code, e.g. `lag`, `tunnel`, `disk` |
| `headLag` | `u64` | yes | Blocks behind the reference |
| `peers` | `u64` | no | |
| `diskDaysLeft` | `dec` | yes | |
| `client` | `str` | no | `web3_clientVersion` (≤ 128 bytes) |
| `agentVersion` | `str` | no | |

- **Expiry: 60 blocks (~2 minutes). Renew every ~30 s.** Missing renewals mean the heartbeat expires and the node reads as dead. Arkiv emits no expiry event, so readers query for live entities.
- **Writer key:** a **separate hot key** funded with tGLM. **Never** use the provider key (it holds payouts). The `provider` field is a claim; a stretch goal is a signature from the provider key binding the two.
- **Cost control:** patch one long-lived entity per node with `extendEntity` + `patchEntity` in one `executeBatch`, or create short-lived ones. Measure both, choose the cheaper, and write the numbers into `friction.md`.
- **Fleet query (the payoff):** `select().from(Heartbeat).where(eq("status","ok"))` returns every live node with Nodewatch, worldwide, without any central server.
- **Trust:** filter by known writer addresses (`$creator`), because anyone can write entities with the same schema tag.

### Required in README
- Writer wallet address(es)
- One runnable query (copy-pasteable)

---

## 7. Swarm usage: diagnostic bundles (bonus)

- **Bundle contents:** last N lines of each container's logs, a metrics snapshot, `status.sh` output, the verdict history, versions. Strip secrets: no `.env`, tunnel token or keystore.
- **Private mode (real use):** upload **encrypted**. The reference is encrypted to the recipient (Arkiv engineers) before it is stored anywhere, or it is sent off-chain. Never place the raw encrypted reference in a public entity.
- **Public mode (for judges):** a **sanitized** sample bundle uploaded **unencrypted**, with its plain reference stored in an Arkiv entity field `bundleRef`, so judges can open the link (required in `swarm.md`).
- **Postage stamps:** get a batch ID. Option A: our own Bee node with a purchased batch. Option B: ask at the Arkiv/Swarm booth (the bonus rules allow "who gave you the batch").
- `/arkiv/swarm.md` must contain: what is on Swarm vs Arkiv; which entity field holds the reference; one entity key plus the reference it points to, with a link; the batch ID and the wallet that bought it (or who gave it); the Bee node or service used; the repo files that upload and read; steps for one upload and one read; the timestamp in the demo video; what got in our way.

---

## 8. Repo layout (create at the event)

```
nodewatch/
├── README.md                 # what, quick start, node used, demo reproduction, writer addresses, one query, AI usage
├── LICENSE                   # Apache-2.0
├── compose.yaml              # nodewatch profile: agent, proxy, prometheus, grafana, alertmanager
├── .env.example              # TELEGRAM_*, ARKIV_ACCESS_KEY, HEARTBEAT_KEY, BEE_URL, STAMP_ID …
├── agent/                    # TypeScript: collectors, analyzer, metrics, heartbeat, bundle
│   ├── src/collectors/       # docker.ts, disk.ts, el.ts, cl.ts, tunnel.ts, reference.ts
│   ├── src/analyzer/         # forecast.ts, verdict.ts
│   ├── src/arkiv/            # schema.ts, heartbeat.ts, fleet.ts
│   └── src/swarm/            # bundle.ts
├── proxy/                    # TypeScript reverse proxy (fail-open, streaming)
├── grafana/                  # provisioned datasource + dashboard JSON
├── prometheus/               # prometheus.yml, alert rules
├── alertmanager/             # alertmanager.yml (Telegram)
├── scripts/                  # install.sh, doctor.sh, demo-fill-disk.sh (test volume only)
├── docs/PLAN.md              # this file
└── arkiv/
    ├── friction.md   real-use.md   whats-new.md   easy-to-run.md
    ├── schema.md     swarm.md
```

`.gitignore` must include: `.env`, `secrets/`, `findings/` (slow-query results stay private), `*.keystore`, `bundles/`.

---

## 9. Judging files: what each must prove

| File (25% each) | Our answer, with evidence |
|---|---|
| `friction.md` | Every snag from node setup to SDK writes, each with *expected / happened / reproduce*. Started **before** the event in `friction-notes.md`. |
| `real-use.md` | The 2 of 9 nodes out of rotation with no reason; "tens of GB a day" disk growth; faucet and tunnel waits from the operator guide. Who uses it: every pool operator plus Arkiv engineers (via bundles). |
| `whats-new.md` | A side-by-side with Docker badges, Uptime Kuma and nodes.arkiv.network: disk forecast, per-method view, verdict engine, heartbeats on Arkiv, private bundles. None exist today. |
| `easy-to-run.md` | Install in under 5 minutes from the README (time it on a fresh VM and record the number), the prerequisites list, and a "when it fails" table. `scripts/doctor.sh` checks everything. |

---

## 10. Build plan (~36 h)

| Hours | Goal | Done when |
|---|---|---|
| 0–2 | Repo, license, compose skeleton, `.env.example`; verify the section 3 unknowns | `docker compose --profile nodewatch up` starts empty services |
| 2–8 | Collectors: docker, disk, EL, CL, tunnel, reference; `/metrics` | Prometheus scrapes real values from our node |
| 8–12 | Analyzer: disk forecast + verdict engine | Grafana shows days-to-full and a verdict; alerts fire on Telegram |
| 12–16 | Arkiv heartbeat (schema, writer, expiry) + fleet query | Our heartbeat visible via query; stopping the agent makes it expire in ~2 min |
| 16–20 | Proxy (passive), per-method metrics | Per-method panel populated |
| 20–24 | Swarm bundle: public sample + private encrypted mode | `swarm.md` complete with a working link |
| 24–28 | Grafana polish, `install.sh`, `doctor.sh`, timed fresh install | Fresh VM to dashboard in < 5 min |
| 28–32 | All `/arkiv/*.md` files, README, architecture diagram | Every required field filled |
| 32–35 | Demo video (< 3 min) + rehearsal | Uploaded |
| 35–36 | Submit (Node tooling + Swarm bonus) | ✅ |

**Cut order if behind:** slow-query finder → inline proxy mode → Telegram bot → Swarm private mode (keep the public sample for the bonus) → per-method panel. **Never cut:** disk forecast, verdict, heartbeat on Arkiv, easy install.

Commit early and often (sponsors check for steady history, not one big upload).

---

## 11. Demo script (≤ 3 min)

1. **Problem (20 s):** nodes.arkiv.network shows nodes out of rotation with no reason. Operators find out too late.
2. **Install (20 s):** one command, dashboard appears.
3. **Dashboard (30 s):** healthy node, real traffic, disk "31 days left", verdict "Healthy and serving".
4. **Disk alert (30 s):** run `demo-fill-disk.sh` on a **small test volume** (never the real node). The forecast drops and a Telegram alert arrives.
5. **Tunnel failure (30 s):** stop the tunnel. Verdict: "Tunnel down". Heartbeat stops renewing, and the fleet query shows the node **disappear after ~2 minutes** (Arkiv expiry).
6. **Help (20 s):** one click creates a diagnostic bundle on Swarm. Show the public sample link.
7. **Recovery (10 s):** restart the tunnel, everything turns green.
8. **Close (20 s):** what's new compared with badges, Kuma and nodes.arkiv.network.

---

## 12. Before the event (infrastructure and notes only, no project code)

- [ ] Node synced on `rabdi`: `./status.sh` clean, both badges healthy, chain ID `0x76edaf`
- [ ] Provider key created, backed up, funded; offer posted; tunnel started; **SERVING** (real traffic for the demo)
- [ ] Record a disk baseline daily (`docker system df -v`) to have real growth data
- [ ] Arkiv access key obtained; a separate heartbeat key generated and funded with tGLM
- [ ] One manual SDK write and query done (learning, not project code)
- [ ] Swarm: decide Bee node vs booth batch; read the bee-js docs
- [ ] Telegram bot token created (BotFather) for alerts
- [ ] `friction-notes.md` started, with every snag timestamped
- [ ] Attend the Arkiv workshop and talk to the team at their booth: confirm the private channel for slow-query findings and the Swarm batch question

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Testnet hiccups or rate limits during the demo | Access key; a recorded backup video; the agent tolerates reference outages (no lag verdict, not a false alarm) |
| The inline proxy breaks paid serving | Passive by default; inline is opt-in and fails open; one-command revert |
| Heartbeat gas cost | Batch writes; measure and report in `friction.md` |
| Leaking secrets in bundles | Allowlist of files; never `.env`, token or keystore; tests for the redaction |
| Slow-query findings leak | Git-ignored `findings/`; demo uses synthetic data; findings sent privately |
| Disk-fill demo damages the node | Demo script refuses to run unless the target is a dedicated small test volume |
