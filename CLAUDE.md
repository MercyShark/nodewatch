# CLAUDE.md — Nodewatch

Instructions for Claude Code (and humans) building **Nodewatch** at ETHGlobal Mumbai 2026.
Read this whole file before writing code. The schedule and judging context live in `docs/PLAN.md`
(copied from `nodewatch-init.md`). **Where the two differ, this file wins** (for example: one container, no Prometheus/Grafana).

---

## 0. Hard rules (never break)

### Hackathon rules
1. **Built from scratch at the event, in a new repo.** No Nodewatch code may exist before hacking starts.
   Node-host infrastructure (section 9.1) is not Nodewatch code and may be prepared earlier, in a separate repo.
2. **Slow-query findings are private.** Never commit them, never put them in `arkiv/friction.md`, never show raw
   query shapes in the demo video. Findings go to `findings/` (git-ignored) and to Arkiv engineers only, through the
   encrypted Swarm vault (section 5.7).
3. **The slow-query finder sends queries only to our own node** (`EL_RPC_URL`, or the optional sandbox chain).
   Enforce this in code: refuse any other target.
4. The README states **how AI was used** (ETHGlobal rule) and lists the **wallet addresses that wrote Arkiv entities**.
5. Commit small and often. Sponsors check for steady history, not one upload at the end.
6. Two branches. `dev` is where work lands, commit by commit. `main` is what runs on the node and what judges read:
   fast-forward `dev` into `main` when a deploy goes out (`git switch main && git merge --ff-only dev`). Never commit
   straight to `main`; never force-push either.

### Security rules
- Never commit `.env`, `secrets/`, keystores, tunnel tokens, `frpc.toml`, Terraform state, or AWS credentials.
- **The node's provider key** (it receives payouts) is never written anywhere by Nodewatch and never used for heartbeats,
  benchmarks or bundles, which use separate hot keys. One exception, decided Nov 5: the **autopilot** may decrypt the
  keystore into process memory only, for the two signatures the pool structurally requires from the provider (the
  offer, the tunnel token). It is off by default, lockable at any time, and every use is logged with its tx.
- Never expose ports 8545, 5052 or 7400 publicly. They stay on loopback.
- SSH on the node is key-only. Never enable password or keyboard-interactive login, and never add keys other than the user's own.
- An **encrypted Swarm reference contains its key**. Never store one in an Arkiv entity. Our design stores references to
  **ciphertext that only the recipient can decrypt**, so the reference itself is safe (section 5.7).
- **The Docker socket is root-equivalent, and `:ro` on the mount does not restrict API calls.** Nodewatch wraps Docker
  access in an internal allowlist: read-only endpoints for the node containers; create/remove only for the optional
  bench sandbox (fixed image, fixed labels); start/restart (never stop or remove) of the node's execution, consensus
  and tunnel containers, checked by compose labels and honouring their stop grace period ("Fix it", autopilot); and
  prune of the build cache and untagged images only ("Free up disk space"); and self-update: pull of the one
  configured image (`NODEWATCH_IMAGE`) plus one labelled, auto-removed updater container that swaps only Nodewatch's own
  container and rolls back if the new one is not healthy. Updates run only when an admin clicks. No other Docker writes.
- Never run `docker compose down -v` on the node stack. It deletes the synced chain.
- **Ask the user before** `terraform apply`, `terraform destroy`, anything that costs money, posting to external services,
  or writing to Arkiv/Swarm with funded keys.

---

## 1. What we are building

Nodewatch is a **web3-native operations console for Arkiv node operators**, shipped as **one container** that runs next
to an Arkiv node and shows what only the inside can see:

| Capability | One line |
|---|---|
| **Verdict** | "Why am I out of rotation?" in one plain sentence, with the fix command |
| **Resources** | CPU, memory, disk, storage, I/O, network for the host and each node container |
| **Disk forecast** | Days until full, with alerts |
| **Chain health** | Head lag vs the network, peers (execution and consensus), finality, sync |
| **Pool and earnings** | Offer and agreement status, expiry countdowns, requests served, GLM payouts (from Arkiv marketplace entities) |
| **Live queries** | The pool's real read queries, timed one by one: requests/min, average/p95/max, error rate, slowest query shapes (literals replaced), slowest requests, live feed; one-click **inline** switch |
| **RPC traffic** | Requests and latency per JSON-RPC method (built-in proxy listener) |
| **Slow-query finder** | Which Arkiv query shapes get slow, with graphs (private) |
| **Heartbeats on Arkiv** | Self-expiring liveness entities; a fleet view of every node running Nodewatch |
| **Encrypted Swarm vault** | Diagnostic bundles and findings that **only Arkiv engineers can open** |
| **Alerts** | Telegram, PagerDuty (built-in engine); the public Arkiv heartbeat is the out-of-band signal |
| **Backups** | Keys and config (encrypted) on the instance's disk and on Swarm |

> **AWS scope: EC2 only.** The only AWS services used are EC2 (instance, EBS, security group, IAM instance role).
> Access is **SSH with key-only login** (host alias `nodewatch`); Session Manager stays available as a fallback.
> **No S3, CloudWatch, SNS, Lambda, DLM, ALB/ACM, SSM Parameter Store or AWS SDK calls.** Deploys go over SSH.
| **Login** | Sign-In with Ethereum (admin wallet allowlist) with a password fallback; admin and viewer roles |

Target prizes: **Arkiv Node tooling** + **Arkiv + Swarm bonus**.

---

## 2. Architecture

### 2.1 Runtime layout: exactly two things on the host

```
┌──────────────────────────── EC2 r7i.2xlarge (ap-south-1) ─────────────────────────────┐
│                                                                                       │
│  ① ARKIV NODE  (node kit stack, used as-is, never modified)                           │
│     execution  (Arkiv reth)   127.0.0.1:8545  JSON-RPC                                │
│     consensus  (Lighthouse)   127.0.0.1:5052  Beacon API                              │
│     tunnel     (frpc)         127.0.0.1:7400  status ──────► community load balancer  │
│     chain data → Docker volumes on the 1 TB gp3 root volume                           │
│                                                                                       │
│  ② NODEWATCH  (ONE container, everything else)                   127.0.0.1:8080       │
│     ┌───────────────────────────────────────────────────────────────────────────┐     │
│     │ one Node.js process (tini as PID 1)                                        │     │
│     │  • collectors   host /proc /sys, Docker API, EL, CL, frpc, reference RPC   │     │
│     │  • time-series  SQLite (raw 15 s × 48 h, 5-min rollups × 30 d)             │     │
│     │  • analyzer     disk forecast, verdict engine, anomalies                   │     │
│     │  • alert engine rules → Telegram / PagerDuty, silences, history            │     │
│     │  • proxy        :18545 JSON-RPC listener (per-method metrics, fail-open)   │     │
│     │  • arkiv        heartbeats, fleet view, bundle index, marketplace reader   │     │
│     │  • vault        ECIES encryption → Swarm (Bee: external URL or embedded)   │     │
│     │  • bench        slow-query finder (own node only)                          │     │
│     │  • backup       local disk / Swarm (encrypted)                             │     │
│     │  • api + ui     Fastify REST + SSE, serves the React app, SIWE login       │     │
│     │  • /metrics     optional Prometheus endpoint for operators who have one    │     │
│     │ optional child process: `bee` (only when BEE_MODE=embedded)                │     │
│     └───────────────────────────────────────────────────────────────────────────┘     │
│     persistent state → /srv/nodewatch on EBS (bind mount)                             │
└───────────┬───────────────────────────────────────────────┬───────────────────────────┘
            │ heartbeats, bundle index (Arkiv Rabdi)         │ ciphertext (Swarm)
            ▼                                                ▼
     ARKIV (DB-chain, replicated)                      SWARM (decentralised storage)

 AWS: EC2 only (access over SSH; Session Manager as fallback). No S3, CloudWatch, Lambda, ALB or other services.
```

### 2.2 Why one container works
| Former sidecar | Replaced by (inside Nodewatch) |
|---|---|
| Prometheus | SQLite time-series tables with rollups; `/metrics` still exposed for external scrapers |
| node-exporter | Parsers for `/host/proc/{stat,meminfo,loadavg,diskstats,net/dev}` and `statfs` on `/host/root` |
| cAdvisor | Docker stats API (`GET /containers/{id}/stats?stream=false`) for the node containers |
| Alertmanager | Built-in alert engine: `for` durations, grouping, dedupe, inhibition, silences, resolve notifications |
| Grafana | Our own React UI (the product) |
| Caddy | No reverse proxy; the UI is served on its own port (wallet sign-in) or through an SSH tunnel |
| Bee container | `BEE_MODE=external` (a Bee node or service URL) or `embedded` (bee binary in the image, supervised child process) |
| Separate proxy | A second listener (`:18545`) in the same process; **passive by default** (section 5.3) |
| Dev-chain container | Bench targets our own Rabdi node by default; an optional **on-demand sandbox** is created and removed by Nodewatch only while a benchmark runs |

### 2.3 Data flow summary
- **Collect** (every 10–15 s; reference RPC ≤ 1/min; marketplace ≤ 1/5 min) → write samples to SQLite.
- **Analyze** → forecast, verdict, anomalies → SQLite (history) and in-memory state.
- **Alert** → rule evaluation every 15 s → notifiers.
- **Publish** → heartbeat to Arkiv every 30 s; bundles to Swarm on demand or on critical alerts.
- **Show** → the UI reads `/api/*` and `/api/stream` (Server-Sent Events) for live updates.

---

## 3. Repository layout

```
nodewatch/
├── CLAUDE.md                     # this file
├── README.md                     # quick start, node used, demo repro, writer addresses, one Arkiv query, AI usage
├── LICENSE                       # Apache-2.0
├── Dockerfile                    # multi-stage: build web → build server → runtime (+ bee binary)
├── compose.yaml                  # ONE service: nodewatch
├── .env.example
├── pnpm-workspace.yaml
├── apps/
│   ├── server/                   # everything except the UI (TypeScript)
│   │   └── src/
│   │       ├── index.ts          # boot: config, db, workers, http, proxy listener, bee child
│   │       ├── config.ts         # zod-validated env
│   │       ├── db/               # SQLite schema + migrations (better-sqlite3 + drizzle)
│   │       ├── tsdb/             # write samples, rollups, retention, range queries
│   │       ├── auth/             # siwe.ts, password.ts, session.ts, rbac.ts
│   │       ├── docker/           # allowlisted Docker client wrapper
│   │       ├── collectors/       # host.ts, containers.ts, volumes.ts, el.ts, cl.ts, tunnel.ts, reference.ts, marketplace.ts, balances.ts
│   │       ├── analyzer/         # forecast.ts, verdict.ts, anomalies.ts
│   │       ├── alerts/           # engine.ts, rules.ts, silences.ts, notifiers/index.ts (telegram, pagerduty)
│   │       ├── proxy/            # rpcProxy.ts (fail-open), shape.ts
│   │       ├── arkiv/            # client.ts, schemas.ts, heartbeat.ts, fleet.ts, bundleIndex.ts
│   │       ├── swarm/            # vault.ts, ecies.ts, recipients.ts, bee.ts (external/embedded)
│   │       ├── bench/            # guard.ts, dataset.ts, shapes.ts, runner.ts, analyze.ts, sandbox.ts
│   │       ├── backup/           # local.ts, swarm.ts, restore.md
│   │       ├── metrics.ts        # optional /metrics exposition (prom-client)
│   │       └── routes/           # REST + SSE
│   └── web/                      # React + Vite + Tailwind + shadcn/ui + Framer Motion
│       └── src/{pages,components,charts,lib,styles}
├── packages/shared/              # types, zod schemas, Arkiv entity schemas, verdict + alert codes
├── scripts/                      # deploy.sh (ship source over SSH, build on the host), install.sh, doctor.sh, demo-fill-disk.sh, hash-password.ts, decrypt-bundle.ts
├── docs/{PLAN.md,ARCHITECTURE.md,RUNBOOK.md}
├── arkiv/                        # judging files (section 11)
└── findings/                     # GIT-IGNORED: private slow-query results
```

---

## 4. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language | **TypeScript (strict), Node.js 22+** | The Arkiv SDK is TypeScript |
| Monorepo | pnpm workspaces | |
| API | Fastify + zod (`fastify-type-provider-zod`) | SSE for live updates |
| Storage | SQLite (`better-sqlite3`, WAL mode) + drizzle | App data **and** time series, one file on EBS |
| Arkiv | `@arkiv-network/sdk` + `viem` | |
| Swarm | `@ethersphere/bee-js` | Against `BEE_API_URL` |
| Encryption | `eciesjs` (secp256k1 ECIES) + AES-256-GCM | Recipients are Ethereum keys (section 5.7) |
| Auth | `siwe`, `@node-rs/argon2`, `iron-session` | |
| Docker | `dockerode`, wrapped by our allowlist | |
| Proxy | `undici` | Streaming, fail-open |
| Notifiers | `fetch` to the Telegram Bot API and PagerDuty Events API v2 | No SDKs needed |
| UI | React 19 + Vite + Tailwind + shadcn/ui + **Framer Motion** + Lucide icons | |
| Charts | **Recharts** (lines, areas, bars), **ECharts** (heatmap, large series) | |
| Process | `tini` as PID 1 | Clean signals; supervises the optional bee child |
| Tests | vitest; Playwright for one login → overview smoke test | |
| Logs | pino (JSON) | |
| IaC | **Terraform ≥ 1.6**, AWS provider ~> 5 | |

---

## 5. Components (implementation contract)

### 5.1 Collectors (`apps/server/src/collectors`)

| Collector | Source | Interval | Produces |
|---|---|---|---|
| host | `/host/proc/stat`, `meminfo`, `loadavg`, `diskstats`, `net/dev`; `statfs` on `/host/root` | 15 s | CPU %, load, memory, swap, disk free per mount, disk IOPS/throughput, network |
| containers | Docker stats API for `execution`, `consensus`, `tunnel` (compose project `arkiv-community-node`) | 15 s | CPU %, memory, block IO, network per container |
| docker | Docker inspect + events for the same containers | 10 s + events | up, restarts, health badge, `State.OOMKilled`, last error log line |
| volumes | Size of `arkiv-community-node_el-data` / `_cl-data` under `/data-root/volumes` (periodic walk, cached) | 5 min | bytes per volume |
| el | `EL_RPC_URL`: `eth_chainId` (expect `0x76edaf`), `eth_blockNumber`, `eth_syncing`, `net_peerCount`, `web3_clientVersion` | 10 s | head, peers, version, sync |
| cl | `CL_API_URL`: `/eth/v1/node/syncing`, `/eth/v1/node/peer_count`, `/eth/v1/node/health`, `/eth/v1/node/version`, `/eth/v1/beacon/states/head/finality_checkpoints` | 10 s | sync distance, `el_offline`, CL peers, finalized epoch |
| tunnel | `TUNNEL_STATUS_URL` (`/api/status`) | 15 s | tunnel state |
| reference | `ARKIV_REFERENCE_RPC` with the access key | **60 s max** | network head, so lag = ref − ours |
| marketplace | Arkiv entities **created by the LB address** (offer, agreement, counter) and by the settle address (receipts); spec in arkiv-community-lb `docs/ENTITIES.md` | 5 min | agreement expiry, tunnel port, requests counted, payouts |
| balances | `eth_getBalance` for the provider and heartbeat addresses | 5 min | tGLM balances (low-gas alert) |

Rules: every collector has a timeout, never throws into the event loop, and records `last_success` plus `last_error`.
A failing reference RPC means **no lag verdict**, not a false "behind" alarm.

### 5.2 Time series (`apps/server/src/tsdb`)
- Table `samples(ts INTEGER, metric TEXT, labels TEXT, value REAL)` with index `(metric, labels, ts)`; WAL mode; batched inserts every 15 s.
- Retention: raw for **48 h**; 5-minute rollups (avg, max) for **30 d** in `rollups_5m`. A job runs every 5 minutes.
- Range queries pick raw or rollup by range (≤ 6 h → raw). The API never exposes SQL; it maps named panels to queries.

### 5.3 Analyzer

**Disk forecast** (`forecast.ts`)
- Every 5 minutes: used bytes (`el-data` + `cl-data`) and free bytes on the root volume.
- Linear regression over 6 h (alerting) and 24 h (display). `days_to_full = free / max(rate, ε)`.
- A step of more than 5 GB between samples (snapshot restore, wipe) resets the window.
- Thresholds: warning < 7 d; critical < 2 d or free < 20 GB.

**Verdict engine** (`verdict.ts`): ordered rules, first match wins. Each verdict has a `code`, `severity`, `title`,
`detail`, and `fix` (exact command).

| # | Code | Condition | Fix shown |
|---|---|---|---|
| 1 | `container_down` | execution/consensus not running or restart-looping | `docker compose logs <svc>`; `./setup.sh` |
| 2 | `oom` | OOMKilled or kernel OOM | Check the memory panel; add memory |
| 3 | `disk_full` | free < 2 % | Grow the gp3 volume: raise `root_volume_gib`, `terraform apply`, then `growpart` + `resize2fs` |
| 4 | `wrong_chain` | chainId ≠ `0x76edaf` | Check `NETWORK=rabdi`; `./setup.sh --refresh` |
| 5 | `el_offline` | CL reports `el_offline` | Restart execution |
| 6 | `lagging` | syncing, or lag > 10 blocks | Shows ETA from the catch-up rate |
| 7 | `no_peers` | EL or CL peers = 0 | `./setup.sh --refresh` |
| 8 | `tunnel_down` | tunnel profile on, frpc not running | `docker compose logs tunnel`; `./marketplace.sh start-tunnel` |
| 9 | `no_agreement` | no live agreement entity | `./marketplace.sh post-offer` |
| 10 | `low_gas` | heartbeat or provider key < threshold | Faucet link |
| 11 | `healthy` | none of the above | Shows requests/min if the proxy is inline |

**Anomalies**: latency or CPU z-score > 3 over a 1 h baseline adds a marker on charts (shape marker, not colour only).

### 5.4 Proxy listener and inline mode (`apps/server/src/proxy`)
- Listener on `127.0.0.1:18545` in the same process; forwards to `EL_RPC_URL`; streams bodies; parses only `method`
  (and `params[0]` for `arkiv_query`); handles batch requests.
- Records per-method count, errors, p50/p95/avg/max latency into the time series every 15 s (`rpcProxy.ts`), and per
  request into `LiveQueries` (`live.ts`): a 500-entry ring for the live feed (SSE event `rpc`, batched 1/s), per-shape
  counters in `rpc_shapes` (normalised shape text, count, errors, avg, max; p50/p95 from an in-memory reservoir), and
  every request in `rpc_requests_log` (48 h) from which the slowest list and the per-method errors are read.
- **Fail-open**: if parsing or recording fails, forward untouched. Never rewrite payloads.
- **Passive** (kit default): frpc's local target is `execution:8545`; the proxy only sees probes, benchmarks and
  local tools. **Inline** (`inline.ts`, Live queries → "Switch to inline"): Nodewatch rewrites the two target lines
  of the kit's `frpc.toml` to the compose network's gateway (`172.18.0.1`) and `:18545`, opens a second listener on
  that gateway address (reachable only from the kit's bridge; 8545 stays loopback), restarts the tunnel through the
  Docker allowlist and waits for frpc to report `running`; on failure the file is restored and the tunnel restarted
  again. The mode is **detected from frpc.toml**, never from an env var (`PROXY_MODE` is accepted and ignored). The
  stored flag survives re-renders: Autopilot re-applies it after writing a new agreement, and an `inline-watch` job
  (60 s) re-applies it if `setup.sh --refresh` regenerated the file (the kit then warns about the changed sha).
- Telegram slow-request messages (`alerts/slow-digest.ts`, job `slow-digest` every 10 s): one message per request over `thresholds.slowRequestMs` (750 ms) since the last tick (ms, method, the node's answer, the actual text); flood guard 20 a minute then one "N more" line; honours silences on `SlowRequests`.
- While inline, a Nodewatch restart (deploy, self-update) pauses paid serving for the restart time; the tunnel
  reconnects by itself. The Update card and `scripts/deploy.sh` say so.
- Every request is logged to `rpc_requests_log` (48 h, 100k rows): method, timing, the node's error, and the request
  text (the `arkiv_query` string, or the params JSON). It is the operator's own node traffic on the operator's own
  disk. Admins see it behind a "Query text" toggle; viewers get shapes only (the API and the stream strip text per
  role). Shapes (`rpc_shapes`) keep counters and the latest example.

### 5.5 Slow-query finder (`apps/server/src/bench`)

Goal: find which **Arkiv query shapes** get slow as data grows, and show it with graphs. Private by design.

1. **Guard** (`guard.ts`): queries go only to `EL_RPC_URL` (our node) or the sandbox. Anything else is refused.
2. **Targets**
   - **Default: our own Rabdi node.** Dataset writes are signed transactions sent through our node (they land on the
     public chain under schema `nwbench.item`, short expiry); **all benchmark queries hit only our node**. Size is
     limited by tGLM, so 500–5,000 entities.
   - **Optional sandbox:** if the `arkiv-reth-dev` image runs a single-node dev chain (verify on day 1), Nodewatch
     creates a labelled, resource-limited container **only for the duration of a run** and removes it afterwards.
     Free gas allows 10k–50k entities. The permanent footprint stays at two things.
3. **Dataset** (`dataset.ts`): schema `nwbench.item`. Indexed: `cat:str`, `n:u64`, `score:dec`, `owner:addr`, `tag:str`.
   Stored: `blob:bytes`. Written with `executeBatch`, expiry 6 h, fixed salt seed for reproducibility.
4. **Shape catalog** (`shapes.ts`): generated from the query grammar: `=` on indexed str; range `>` and `BETWEEN` on
   u64/dec; `STARTSWITH`; `EXISTS`; `TYPEOF`; `AND` chains of 2–5 terms; `OR` fan-out 2–8; mixed `AND`/`OR` with
   parentheses; `ORDER BY` indexed vs non-indexed; keys-only vs `bytes` selection; `$owner` filters; deep `offset`
   vs key-cursor paging.
5. **Runner** (`runner.ts`): each shape × dataset size, 30 runs (5 warm-up); records p50/p95/p99, rows, response bytes,
   errors. Raw query strings go through the SDK's raw query function against the target RPC.
   **Checks node health first and pauses automatically** if head lag grows or host CPU > 85 %.
6. **Analysis** (`analyze.ts`): fit `log(latency) ~ k·log(size)`. Flag **slow** if p95 > 250 ms at the largest size or
   k > 1.2 (super-linear). Compare paging methods.
7. **Storage**: `bench_results` in SQLite (shape text **encrypted at rest**) and `findings/*.json` (git-ignored).
8. **Graphs** (admin only): heatmap (shape × size → p95), log-log scaling curves for the top 8 shapes, p95 ranking bars,
   offset-depth vs cursor paging line, sortable table + CSV export.
9. **Reporting**: "Send to Arkiv" encrypts the findings to the Arkiv recipient and uploads them through the vault (5.8).
   Public views and the demo show `shape #N` only.

### 5.6 Heartbeats on Arkiv (`apps/server/src/arkiv/heartbeat.ts`)

Schema `nodewatch.heartbeat` (named schema, so 31 columns max):

| Column | Type | Indexed |
|---|---|---|
| `provider` | addr | ✓ |
| `status` | str (`ok`/`degraded`/`down`) | ✓ |
| `verdict` | str (verdict code) | ✓ |
| `headLag` | u64 | ✓ |
| `diskDaysLeft` | dec | ✓ |
| `peersEl`, `peersCl` | u64 | |
| `client` | str (≤ 128 bytes) | |
| `agentVersion` | str | |

- Expiry **60 blocks (~2 min)**, renewed every **30 s** via `executeBatch` (patch + extend). Three failed writes in a row raise `HeartbeatFailing`.
- Writer: `HEARTBEAT_PRIVATE_KEY` (separate hot key, funded with tGLM). The README lists its address.
- **Fleet view** (`fleet.ts`): query every live `nodewatch.heartbeat`; trust only `$creator` values the user pins or an allowlist; show expiry countdowns.
- No event fires on expiry, so readers poll. Absence means down.

### 5.7 Bundle index on Arkiv

Schema `nodewatch.bundle` (30 d): `provider:addr✓`, `kind:str✓` (`diagnostic`/`findings`/`backup`/`sample`),
`recipient:addr✓`, `swarmRef:str` (plain reference **to ciphertext**), `sha256:str`,
`scheme:str` (`ecies-secp256k1-v1`, or `none` for `sample`), `sizeBytes:u64`.

### 5.8 Swarm vault: "only Arkiv can read it" (`apps/server/src/swarm`)

**Model: envelope encryption to the recipient's Ethereum key, then a normal Swarm upload.**

```
bundle.tar.gz ──► random AES-256-GCM key K ──► ciphertext C
K ──► ECIES(secp256k1) to each recipient public key ──► wrapped keys
envelope = { v:1, scheme, recipients:[{addr, wrappedKey}], iv, tag, C }
envelope ──► Bee upload (postage batch) ──► swarmRef   (reference to CIPHERTEXT)
swarmRef + sha256 + recipient ──► nodewatch.bundle entity on Arkiv
```

- **The reference is safe to publish**, because the content is ciphertext only the recipient's private key can open. This satisfies the bonus rule ("encrypt it first") while `swarm.md` can still show an entity → reference link.
- **Getting the recipient's public key (web3-native):** the Arkiv engineer signs a fixed message with their wallet; we recover the public key from the signature (`viem` `recoverPublicKey`) and store `{address, publicKey}`. No key files are exchanged.
- Multiple recipients (Arkiv engineer + the operator). `scripts/decrypt-bundle.ts` decrypts with a private key, so judges can verify with a demo recipient.
- **Public sample:** a sanitized bundle uploaded unencrypted (`kind=sample`, `scheme=none`) so judges get a link that opens.
- Bundle contents (allowlist only): last 500 log lines per node container (secrets redacted), 24 h of verdict history, a metrics snapshot, `status.sh` output, versions. **Never**: `.env`, `secrets/`, `frpc.toml`, tokens. Unit-test the redaction.
- **Bee modes:** `BEE_MODE=external` (default) uses `BEE_API_URL` (our own Bee elsewhere, or a service/batch provided at the Arkiv/Swarm booth). `BEE_MODE=embedded` runs the bee binary bundled in the image as a supervised child process with data in `/srv/nodewatch/bee`. Either way, still one container.
- Postage batch `BEE_POSTAGE_BATCH_ID`. `swarm.md` records the batch ID, who provided it, and the Bee node or service used.
- Optional, after checking the Bee version: Swarm **ACT** grantee lists as a second layer.

### 5.9 Alert engine and notifications (`apps/server/src/alerts`)

Built in, so there's no Alertmanager:
- Rules are code (`rules.ts`) with config overrides for thresholds. Evaluated every **15 s**. States: `inactive → pending (for N) → firing → resolved`.
- **Dedupe key** = `rule + node`; **grouping** within 30 s into one message; **inhibition** (e.g. `ContainerDown` suppresses `NodeLagging`); **resolve** messages; **silences** (rule or all, N minutes) stored in SQLite.
- Notifier retries with exponential backoff; every send is logged to `alerts_log`.

| Severity | Telegram | PagerDuty |
|---|---|---|
| `info` | ✓ | — |
| `warning` | ✓ | — |
| `critical` | ✓ | ✓ (Events API v2 `trigger`/`resolve`, `dedup_key` = dedupe key) |

- Config from env (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `PAGERDUTY_ROUTING_KEY`). A missing value disables that channel. The UI shows the status per channel plus a **Send test** button.
- Rules (minimum): `DiskDaysLeftLow` (< 7 d, warning), `DiskDaysLeftCritical` (< 2 d), `NodeLagging` (> 10 blocks for 5 m), `NoPeers`, `ContainerDown`, `OOMKilled`, `TunnelDown`, `AgreementExpiringSoon` (< 2 h), `HeartbeatFailing`, `LowGas`, `BackupFailed`, `RPCErrorRateHigh` (> 5 % for 5 m), `RPCLatencyHigh` (p95 > 1 s), `SlowRequestCritical` (one request ≥ 3 s in 5 m, critical → PagerDuty), `HostCPUHigh` (> 90 % for 10 m), `HostMemoryHigh` (> 90 %).
- **Out-of-band (no extra AWS services):** if the whole host dies, Nodewatch can't alert. The public `nodewatch.heartbeat` entity is the dead man's switch: it expires on Arkiv within ~2 minutes, so any other Nodewatch's **fleet view** (e.g. a teammate's laptop) shows the node as gone and can alert.

### 5.10 Authentication and roles
- **Primary: Sign-In with Ethereum (SIWE).** `ADMIN_ADDRESSES` → `admin`; `VIEWER_ADDRESSES` → `viewer`.
- **Fallback: password** (`ADMIN_PASSWORD_HASH`, argon2id, created by `scripts/hash-password.ts`).
- Session: `iron-session`, httpOnly + Secure + SameSite=Lax cookie, 12 h. Login rate limit 5/min/IP. CSRF protection on mutating routes. SIWE nonces single-use and domain-bound.
- **admin** can do everything (bench, findings, backups, silences, bundles, settings). **viewer** (e.g. judges) gets a read-only dashboard with **no findings text, no secrets, no destructive actions**.

### 5.11 Backups

| What | Why | Where | How |
|---|---|---|---|
| Provider keystore, node `.env`, `frpc.toml` | Losing these loses the node's identity and payouts | **Local** (`/srv/nodewatch/backups`) and/or **Swarm** | Envelope-encrypted to the **operator's** wallet key (same ECIES scheme) before writing; double-encrypted, since the keystore already has a password. Download a copy off the box. |
| Nodewatch SQLite + settings | History and configuration | Local / Swarm | Nightly + on demand (`sqlite3 .backup` first) |
| Chain data | Not backed up | — | Reproducible with `./setup.sh` (Arkiv snapshot restore + sync) |

- UI **Backups** page: last success per target, size, location, **Run now**, restore guide, and **test restore** (decrypt to a temp dir, verify checksum).
- `BackupFailed` alert if a backup fails or the newest is older than 26 h.

### 5.12 HTTP API (`/api`)

| Route | Role | Purpose |
|---|---|---|
| `POST /auth/siwe/nonce`, `POST /auth/siwe/verify`, `POST /auth/password`, `POST /auth/logout`, `GET /auth/me` | public / any | Auth |
| `GET /overview` | viewer | Verdict, KPIs, status |
| `GET /stream` | viewer | SSE: verdict changes, heartbeats, alerts, metric ticks |
| `GET /resources?range=` | viewer | Host + container CPU/mem/disk/IO/network |
| `GET /disk/forecast` | viewer | Samples + regression + days left |
| `GET /chain` | viewer | Head, lag, peers, finality, sync |
| `GET /pool` | viewer | Offer/agreement, expiry, requests served, payouts |
| `GET /rpc?range=` | viewer | Per-method traffic and latency |
| `GET /fleet` | viewer | Arkiv heartbeats of all nodes |
| `GET /alerts`, `POST /alerts/test/:channel`, `POST /alerts/silences`, `DELETE /alerts/silences/:id` | viewer / admin | Alerts |
| `GET /bench/runs`, `POST /bench/runs`, `GET /bench/runs/:id` | **admin** | Slow-query finder |
| `GET /vault/bundles`, `POST /vault/bundles`, `POST /vault/recipients` | admin | Swarm vault |
| `GET /backups`, `POST /backups/run`, `POST /backups/test-restore` | admin | Backups |
| `GET /health`, `GET /metrics` | internal | Liveness; optional Prometheus exposition |

### 5.13 SQLite tables
`users`, `sessions`, `settings`, `samples`, `rollups_5m`, `disk_samples`, `verdicts`, `alerts_state`, `alerts_log`,
`silences`, `heartbeats_sent`, `bench_runs`, `bench_results` (shape text encrypted at rest), `bundles`, `recipients`, `backups`.

---

## 6. UI and UX (React + Tailwind + shadcn/ui + Framer Motion)

Design direction comes from the **ui-ux-pro-max** skill ("Real-Time / Operations" pattern, **Dark Mode (OLED)** style,
web3/crypto typography). Before building or changing any screen, re-run the skill and **dataviz** skill guidance, and
treat its Quick Reference §1–§3 (accessibility, interaction, performance) as blocking checks.

### 6.1 Design tokens (dark-first; the skill's palette adapted for dark mode)

| Token | Value | Use |
|---|---|---|
| `--bg` | `#070B14` | App background |
| `--surface` | `#0E1525` | Cards |
| `--surface-2` | `#141D33` | Raised panels, popovers |
| `--border` | `#22304D` | Dividers |
| `--fg` | `#E6ECF7` | Primary text (≥ 7:1 on `--bg`) |
| `--fg-muted` | `#93A3BF` | Secondary text (≥ 4.5:1) |
| `--primary` | `#3B82F6` | Primary actions, focus ring |
| `--primary-strong` | `#1E40AF` | Pressed state |
| `--accent` | `#F59E0B` | Highlights, CTA (amber) |
| `--ok` / `--warn` / `--crit` | `#22C55E` / `#F59E0B` / `#EF4444` | Status, **always paired with an icon and text** |
| `--chart-1..6` | `#3B82F6, #22D3EE, #A78BFA, #F59E0B, #34D399, #F472B6` | Series (vary line style too) |

Typography: **Orbitron** for the logo and page titles only; **Exo 2** for UI text; **JetBrains Mono** with `tabular-nums`
for numbers, hashes, addresses and block heights. Base 16 px, scale 12/14/16/18/24/32. Icons: **Lucide** only (no emoji).
Spacing 4/8 px. Breakpoints 375/768/1024/1440. Sidebar navigation at ≥ 1024 px.

### 6.2 Pages

| Page | Content |
|---|---|
| **Login** | "Sign in with Ethereum" (primary), password (secondary, collapsed) |
| **Overview** | **Verdict hero** (status + one sentence + fix command with copy), KPI tiles (head lag, peers, disk days left, CPU, memory, requests/min, tGLM balance), live heartbeat indicator, recent alerts |
| **Resources** | Host and per-container CPU, memory, disk, IO, network; **disk forecast** (actual line + dashed projection to the "full" point, threshold bands) |
| **Chain** | Head vs reference (two lines), lag area, EL/CL peers, finality, sync ETA |
| **Pool & earnings** | Agreement card with expiry countdown, requests served per day, payouts (GLM) with explorer links |
| **Live queries** | Mode card (inline/passive switch with confirm dialog), KPI tiles, requests/min by group, latency avg/p95/max, error rate, slowest shapes table, slowest requests, SSE live feed |
| **RPC traffic** | Requests/s per method (stacked area), p95 per method, error rate, proxy mode badge |
| **Fleet** | Every node publishing heartbeats on Arkiv: status, lag, disk days, **expiry countdown ring**, entity link |
| **Slow queries** (admin) | Run controls (target: own node / sandbox), **heatmap**, log-log scaling curves, ranking bars, paging comparison, table + CSV |
| **Alerts** | Channels (Telegram/PagerDuty) with **Send test**, routing, history, silences |
| **Backups** | Targets, last run, Run now, test restore, restore guide |
| **Swarm vault** | Recipients (add via signature), bundles (kind, size, recipient, Swarm ref, Arkiv entity), Create bundle, public sample link |
| **Settings** | Admin addresses, thresholds, intervals, proxy mode, Bee mode, about |

### 6.3 Charts
- Time series: Recharts line/area; **dashed projection** for forecasts; threshold bands; anomaly markers use **shapes**, not colour alone.
- Heatmap and large series (> 1,000 points): ECharts canvas; aggregate beyond 10k points.
- Every chart: legend, tooltip with units, axis labels with units, granularity switch (1 h / 6 h / 24 h / 7 d / 30 d), loading skeleton, empty state, error state with retry, and a **table view toggle**.
- Live charts: **pause/resume**; frozen under reduced motion.

### 6.4 Animation (Framer Motion): motion must mean something
- Tokens: micro 150 ms, standard 220 ms, complex ≤ 350 ms; ease-out to enter, ease-in to exit (exit ≈ 65 % of enter); springs for layout changes.
- **Meaningful motions only:**
  - **Heartbeat pulse** on the status dot fires **only when a heartbeat transaction lands**.
  - **Verdict change:** crossfade + slight upward slide of the hero; the severity colour transitions.
  - **KPI numbers:** count-up on change (tabular nums, no layout shift).
  - **Card entrance:** 40 ms stagger, first load only.
  - **Expiry ring:** countdown arc until a heartbeat expires.
  - **Alerts:** toast from the top-right, auto-dismiss after 4 s, `aria-live="polite"`.
- At most 1–2 animated elements per view; transform and opacity only; never block input.
- **`prefers-reduced-motion`:** no pulses, count-ups or chart animations; instant state changes.

### 6.5 Accessibility and quality gates (blocking)
Contrast ≥ 4.5:1, visible focus rings, keyboard navigation, `aria-label` on icon buttons, skip link, sequential headings,
touch targets ≥ 44 px, skeletons for loads over 300 ms, no horizontal scroll at 375 px, confirmation dialogs for destructive actions.

---

## 7. Configuration (`.env.example`)

```bash
# Node (the node kit binds to host loopback; Nodewatch uses host networking to reach it)
NODE_COMPOSE_PROJECT=arkiv-community-node
EL_RPC_URL=http://127.0.0.1:8545
CL_API_URL=http://127.0.0.1:5052
TUNNEL_STATUS_URL=http://127.0.0.1:7400/api/status
PROVIDER_ADDRESS=0x...

# Arkiv
ARKIV_CHAIN_ID=7794095
ARKIV_REFERENCE_RPC=https://rpc.rabdi.db-chain.testnet.arkiv.network
ARKIV_ACCESS_KEY=
HEARTBEAT_PRIVATE_KEY=            # separate hot key, never the provider key
LB_ADDRESS=                       # from the node kit's marketplace/addresses.json
SETTLE_ADDRESS=

# Swarm
BEE_MODE=external                 # external | embedded
BEE_API_URL=http://127.0.0.1:1633
BEE_POSTAGE_BATCH_ID=
ARKIV_RECIPIENT_ADDRESS=          # filled after the signature handshake

# Auth
ADMIN_ADDRESSES=0x...
VIEWER_ADDRESSES=
ADMIN_PASSWORD_HASH=
SESSION_SECRET=                   # 32+ random bytes
PUBLIC_ORIGIN=http://localhost:8080

# Alerts
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
PAGERDUTY_ROUTING_KEY=

# Backups (local + Swarm only)
BACKUP_SWARM_ENABLED=true

# Bench
BENCH_SANDBOX_IMAGE=ghcr.io/arkiv-network/arkiv-reth-dev:latest   # verify on day 1
```

Secrets live only in `/opt/nodewatch/.env` on the instance (root, mode 600), created by `scripts/install.sh`. No AWS secret services.

---

## 8. Compose: one service

```yaml
services:
  nodewatch:
    image: nodewatch:local
    build: .
    network_mode: host            # reach the node's loopback ports; UI binds to 127.0.0.1:8080 only
    restart: unless-stopped
    init: true
    env_file: .env
    cpus: 2.0
    mem_limit: 3g
    volumes:
      - /srv/nodewatch:/app/data                         # SQLite, findings, bee data (persistent EBS)
      - /var/run/docker.sock:/var/run/docker.sock        # wrapped by the allowlist (section 0)
      - /var/lib/docker:/data-root:ro                    # volume sizes
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/host/root:ro,rslave
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/api/health"]
      interval: 30s
    logging:
      driver: json-file
      options: { max-size: "50m", max-file: "5" }
```

- `network_mode: host` is deliberate: the node kit publishes 8545/5052/7400 on host loopback only, so host networking is the simplest secure way to reach them. Nodewatch binds its own ports to `127.0.0.1` only.
- **The node always wins resources.** Nodewatch is capped at **2 vCPU / 3 GiB** (the optional bench sandbox: **3 vCPU / 6 GiB**, only during a run). The node stack has no limits. On `r7i.2xlarge` (8 vCPU / 64 GiB) the node always keeps at least 3 vCPU and 55 GiB.

---

## 9. AWS infrastructure (Terraform)

The user provides an **AWS CLI profile**. Use `profile = var.aws_profile`; never hard-code or commit credentials.
**Always show `terraform plan` and get explicit approval before `apply`.** Default region **ap-south-1 (Mumbai)**.

### 9.1 Node host (separate repo `arkiv-node-infra`; may be prepared before the event)

| Resource | Spec |
|---|---|
| VPC | Default VPC is fine for the hackathon (or one small VPC with a public subnet) |
| EC2 `learing-test-rishabh` | **`r7i.2xlarge`**: 8 vCPU (Intel, x86_64), **64 GiB RAM**, EBS-only, sustained EBS 12,000 IOPS / 312.5 MB/s; Ubuntu 24.04 x86_64; `ap-south-1a`; account via profile `sova-profile` |
| Storage | **One 1,000 GiB gp3 root volume**, encrypted, **12,000 IOPS / 300 MiB/s** (matched to the instance's sustained EBS limit): OS, Docker data-root `/var/lib/docker` (chain volumes), node kit at `/opt/arkiv-community-node` (incl. `secrets/`, `.env`), and **`/srv/nodewatch`**. Grows online (`root_volume_gib` → apply → `growpart` + `resize2fs`; one modification per 6 h). |
| Security group | Inbound **TCP 22** (SSH) from `0.0.0.0/0` since Nov 6 at the user's request, plus an older single-IP rule; **TCP 8000** (Nodewatch UI, wallet sign-in) from `0.0.0.0/0`. SSH is key-only: password and keyboard-interactive login are off. 8545/5052/7400 stay on loopback. |
| IAM instance role | `AmazonSSMManagedInstanceCore` only (Session Manager, kept as a fallback to SSH) |
| user_data (cloud-init) | Install Docker + compose (log rotation), `gettext-base`, git, jq; chrony with the Amazon Time Sync Service; clone the node kit; write `.env` with `NETWORK=rabdi`; enable `arkiv-node.service`, which runs `./setup.sh --yes` on every boot (idempotent; `--yes` only answers the wipe / sync-from-genesis prompts). |
| Tags | `project=nodewatch`, `event=ethglobal-mumbai-2026`, root volume `nodewatch:snapshot=true` |

Outputs: instance ID, private IP, SSM connect and port-forward commands, root volume ID.

Admin access (user `ubuntu`, passwordless sudo, key `~/.ssh/id_ed25519`, alias `nodewatch` in `~/.ssh/config`):
```bash
ssh nodewatch                                   # shell on the node
ssh -N -L 8000:127.0.0.1:8000 nodewatch         # dashboard tunnel, then open http://localhost:8000
```
Fallback if SSH is unreachable: `aws ssm start-session --profile sova-profile --target <instance-id>`.

### 9.2 Nodewatch-specific AWS resources: none

Nodewatch adds **no AWS resources**. It runs as one container on the existing EC2 instance. Deployment
(`scripts/deploy.sh`, over SSH since Nov 6): `git archive HEAD` → SSH → `docker build` on the instance →
`docker compose up -d` → wait for healthy. `--image` streams a locally built image through SSH into `docker load`. Terraform state stays local (git-ignored). Remind the
user to `terraform destroy` the node host after judging (back up the provider keystore first).

---

## 10. Commands

```bash
pnpm i
pnpm dev                     # server + web with hot reload (uses .env, points at the node over an SSH tunnel)
pnpm test                    # vitest
docker compose build && docker compose up -d     # the one Nodewatch container
./scripts/doctor.sh          # checks node, ports, keys, balances, Bee, channels
./scripts/deploy.sh          # ship source over SSH, build on the host, restart, wait for healthy
```

---

## 11. Judging deliverables (Arkiv Node tooling + Swarm bonus)

| File | Must contain |
|---|---|
| `README.md` | What it is; 5-minute quick start; **node used** (Rabdi, node kit version); demo reproduction; **writer wallet addresses**; **one Arkiv query** judges can run; AI usage; license |
| `arkiv/friction.md` | Each snag: expected / happened / how to reproduce (node setup, SDK, "at least one filter required", rate limits, no expiry events…) |
| `arkiv/real-use.md` | Evidence: nodes out of rotation without reasons; "tens of GB/day" disk; faucet and tunnel waits; who uses it and what it tells them |
| `arkiv/whats-new.md` | Side-by-side with Docker badges, Uptime Kuma and nodes.arkiv.network; what only Nodewatch shows; why it's more than a dashboard (verdict engine, forecast, heartbeats, vault, **one container, zero extra infrastructure, EC2 only**) |
| `arkiv/easy-to-run.md` | Timed fresh install; requirements; "when it fails" table; `doctor.sh` |
| `arkiv/schema.md` | `nodewatch.heartbeat`, `nodewatch.bundle`, `nwbench.item`: fields, which are filtered, owners, expiries |
| `arkiv/swarm.md` | What's on Swarm vs Arkiv; `swarmRef` field; one entity key + reference + openable link (sample); batch ID and provider; Bee node or service; upload/read files; one upload + one read steps; demo video timestamp; what got in the way |

Slow-query **findings never appear in these files**. `friction.md` may say "we found N slow shapes and reported them privately".

---

## 12. Definition of done (demo-ready)

- [ ] `docker compose up -d` → dashboard in < 5 minutes on a clean host (timed, recorded in `easy-to-run.md`)
- [ ] Exactly two things run on the host: the node kit stack and the `nodewatch` container
- [ ] Verdict correct for: healthy, tunnel down, lagging, container down (each tested live)
- [ ] Disk forecast alert fires in the demo (`demo-fill-disk.sh` uses a small loop-mounted test file system and refuses the real root volume)
- [ ] Telegram and PagerDuty test alerts each arrive; a real alert triggers and resolves on PagerDuty
- [ ] Heartbeat visible in the fleet view; stopping Nodewatch makes it expire in ~2 min and another Nodewatch's fleet view shows it gone
- [ ] Encrypted bundle → Arkiv entity → Swarm ref; the demo recipient decrypts it; the public sample link opens
- [ ] Slow-query run shows the heatmap and scaling graphs (shape IDs only in public views)
- [ ] Encrypted backup to local disk/Swarm succeeds; test restore passes
- [ ] SIWE login works; viewer role sees no findings and no destructive actions
- [ ] Nodewatch never exceeds 2 vCPU / 3 GiB; the node's head lag is unaffected during a bench run
- [ ] All `arkiv/*.md` files complete; README lists addresses and a runnable query; AI usage stated

---

## 13. Verify on day 1 (unknowns, do not assume)

- [ ] Exact JSON-RPC shape of `arkiv_query` and the SDK's raw-query function name (docs `/json-rpc/querying-data/`, `/reference/query-language/`)
- [ ] Marketplace entity schemas (arkiv-community-lb `docs/ENTITIES.md`) and the shipped LB/settle addresses (node kit `marketplace/addresses.json`)
- [ ] Whether `arkiv-reth-dev` runs a single-node dev chain with a prefunded account, and its flags (sandbox is optional)
- [ ] Swarm: Bee version, postage batch source (own vs booth), embedded-binary feasibility, ACT availability
- [ ] The finality endpoint and fields returned by this Lighthouse build
- [x] `r7i.2xlarge` is offered in `ap-south-1a` (verified Nov 4)
