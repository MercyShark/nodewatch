# Friction log

What got in the way while running an Arkiv community node and building on it. Each entry gives what we expected,
what happened, and how to reproduce it. Slow-query **findings are not in this file**. They are reported privately
through the encrypted Swarm vault.

## 1. Queries need at least one filter

- **Expected:** an empty or match-all query (or `limit` alone) returns entities page by page, as in most databases.
- **Happened:** the node rejects the query with an error that at least one filter is required.
- **Reproduce:** `arkiv_query` with `""` as the query string.
- **Impact:** a "list everything I own" view needs `$owner = addr(0x…)`. A schema-wide view needs a named schema so
  that every entity carries the indexed `arkiv.schema` attribute. We use `arkiv.schema = str('nodewatch.heartbeat')`.

## 2. Bare string literals in the query language

- **Expected:** `arkiv.schema = "nodewatch.heartbeat"` works, as in SQL-like languages.
- **Happened:** `{"code":-32001,"message":"unexpected character","data":{"position":15}}`. String values must be typed:
  `str('nodewatch.heartbeat')`. Addresses use `addr(0x…)` and keys use `key(0x…)`.
- **Reproduce:** the curl in the README with `str('…')` replaced by `"…"`.
- **Suggestion:** an error such as "string literals must be written str('…')" would save a docs search.

## 3. No events when an entity expires

- **Expected:** a subscription or log for expiry, so a fleet monitor can react when a heartbeat lapses.
- **Happened:** expiry is silent. Readers must poll and treat absence as "down". The community LB also denies
  `eth_subscribe` / filter methods, so even log-based approaches only work against your own node.
- **Impact:** the fleet view polls every 10 s. Dead-node detection is bounded by expiry (60 blocks ≈ 2 min) plus the
  poll interval.

## 4. Reth's `mdbx.dat` is sparse

- **Expected:** `du -sh` of the execution volume matches the disk space the chain uses.
- **Happened:** `mdbx.dat` reported 4.29 GB apparent and 0 allocated in one view, and `ls -l` / `du --apparent-size`
  disagree with `df`. Our first disk-usage reading looked wrong (3.4 GB vs 7.7 GB).
- **Resolution:** Nodewatch measures **allocated** bytes (`st_blocks × 512`), because that is what fills the disk and
  what the forecast must use.
- **Reproduce:** `du -sh --apparent-size` vs `du -sh` on `/var/lib/docker/volumes/arkiv-community-node_el-data`.

## 5. `marketplace.sh create-key` and non-interactive input

- **Expected:** piping the password twice (`printf 'pw\npw\n' | ./marketplace.sh create-key`) creates the key.
- **Happened:** the first read consumed both lines and the script exited silently without a key.
- **Workaround:** feed each line after a delay: `{ sleep 3; echo "$P"; sleep 3; echo "$P"; sleep 15; } | ./marketplace.sh create-key`.
- **Suggestion:** a `--password-file` flag would make provider setup scriptable (Terraform user-data, Ansible).

## 6. The call counter lags the pool dashboard

- **Expected:** `rpc.counter.count` goes up as the node serves requests.
- **Happened:** nodes.arkiv.network showed **475 answers** served while our `rpc.counter` entity still said `count: 0`.
  The LB writes the count periodically (about daily), so payout can't be estimated from Arkiv in real time.
- **Impact:** Nodewatch shows both numbers and labels the counter "as of block N" so operators don't think they are
  unpaid.

## 7. "Not labelled" on nodes.arkiv.network

- **Expected:** a way to set a display name for our provider.
- **Happened:** the dashboard shows "Not labelled – 0xbd78…1880". There is no self-service label. It is set by the
  Arkiv team.

## 8. Tunnel start outlives scripted sessions

- `start-tunnel.sh` blocks until the agreement is accepted and the tunnel is `SERVING`. That took about 2 minutes
  for us, which is longer than a typical remote-command timeout. We had to poll the frpc status endpoint
  (`127.0.0.1:7400/api/status`) separately.

## 9. Faucet waits and rate limits

- The faucet gives tGLM per address with a wait between claims. Nodewatch needs its own funded hot key (heartbeats
  must never use the provider key), so an operator claims twice.
- The public reference RPC is rate-limited. Nodewatch calls it at most once per minute per metric and does
  everything else against the local node.

## Slow queries

The slow-query finder ran against our own node only. Any slow shapes it found were reported to the Arkiv team privately
through the encrypted vault and are not listed here.
