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

## 3. `&&` / `||` were removed from the query language

- **Expected:** `a = str('x') && b = str('y')`, as in the older docs and examples.
- **Happened:** `symbol operators (&& || ~) were removed — use AND, OR, STARTSWITH` (code -32001). Numbers also need
  typed literals: `headLag > u64(10)`, `diskDaysLeft < dec(7)`.
- **Reproduce:** any `arkiv_query` containing `&&` against arkiv-reth v1.0.0.
- **Credit:** this error message is excellent. It names the replacement. Item 2 should get the same treatment.

## 4. No events when an entity expires

- **Expected:** a subscription or log for expiry, so a fleet monitor can react when a heartbeat lapses.
- **Happened:** expiry is silent. Readers must poll and treat absence as "down". The community LB also denies
  `eth_subscribe` / filter methods, so even log-based approaches only work against your own node.
- **Impact:** the fleet view polls every 10 s. Dead-node detection is bounded by expiry (60 blocks ≈ 2 min) plus the
  poll interval.

## 5. Reth's `mdbx.dat` is sparse

- **Expected:** `du -sh` of the execution volume matches the disk space the chain uses.
- **Happened:** `mdbx.dat` reported 4.29 GB apparent and 0 allocated in one view, and `ls -l` / `du --apparent-size`
  disagree with `df`. Our first disk-usage reading looked wrong (3.4 GB vs 7.7 GB).
- **Resolution:** Nodewatch measures **allocated** bytes (`st_blocks × 512`), because that is what fills the disk and
  what the forecast must use.
- **Reproduce:** `du -sh --apparent-size` vs `du -sh` on `/var/lib/docker/volumes/arkiv-community-node_el-data`.

## 6. `marketplace.sh create-key` and non-interactive input

- **Expected:** piping the password twice (`printf 'pw\npw\n' | ./marketplace.sh create-key`) creates the key.
- **Happened:** the first read consumed both lines and the script exited silently without a key.
- **Workaround:** feed each line after a delay: `{ sleep 3; echo "$P"; sleep 3; echo "$P"; sleep 15; } | ./marketplace.sh create-key`.
- **Suggestion:** a `--password-file` flag would make provider setup scriptable (Terraform user-data, Ansible).

## 7. The call counter lags the pool dashboard

- **Expected:** `rpc.counter.count` goes up as the node serves requests.
- **Happened:** nodes.arkiv.network showed **475 answers** served while our `rpc.counter` entity still said `count: 0`.
  The LB writes the count periodically (about daily), so payout can't be estimated from Arkiv in real time.
- **Impact:** Nodewatch shows both numbers and labels the counter "as of block N" so operators don't think they are
  unpaid.

## 8. "Not labelled" on nodes.arkiv.network

- **Expected:** a way to set a display name for our provider.
- **Happened:** the dashboard shows "Not labelled – 0xbd78…1880". There is no self-service label. It is set by the
  Arkiv team.

## 9. Tunnel start outlives scripted sessions

- `start-tunnel.sh` blocks until the agreement is accepted and the tunnel is `SERVING`. That took about 2 minutes
  for us, which is longer than a typical remote-command timeout. We had to poll the frpc status endpoint
  (`127.0.0.1:7400/api/status`) separately.

## 10. Faucet waits and rate limits

- The faucet gives tGLM per address with a wait between claims. Nodewatch needs its own funded hot key (heartbeats
  must never use the provider key), so an operator claims twice.
- The public reference RPC is rate-limited. Nodewatch calls it at most once per minute per metric and does
  everything else against the local node.

## 11. Getting back into the pool after losing an agreement is manual

- **Expected:** if a node drops out of the pool (an outage, a lost agreement), a documented way to rejoin without a
  person present.
- **Happened:** renewal itself is not the problem. While the node serves, the LB keeps the agreement alive and its
  expiry rolls forward: on our node `./marketplace.sh status` showed about 71 h left on Nov 5 and 71.2 h on Nov 6,
  with the request counter opened 37 h earlier. Recovery is the manual part. Once an agreement is gone, the operator
  must run `post-offer`, wait for the LB (minutes), then `start-tunnel`, which asks for the keystore password. Both
  steps need the provider key's signature, so no delegate key can do them, and the kit has no unattended path.
- **Reproduce:** stop the node or its tunnel long enough for the LB to drop the agreement; `./marketplace.sh status`
  then shows no agreement and the tunnel keeps serving the old token until `start-tunnel` runs again. We have not
  measured how long an outage it takes for the LB to drop an agreement.
- **Impact:** Nodewatch's autopilot automates the recovery, but it has to hold the decrypted provider key in memory to
  do so. A delegation mechanism (an offer signed by a key the provider authorised, or an LB-side rejoin flag) would
  let an operator keep the payout key cold.

## 12. Node names on nodes.arkiv.network are typed into the site's code

- **Expected:** an operator can name their node and set its country themselves, with proof that they run it.
- **Happened:** the public nodes page reads names from a fixed address-to-name list, and countries from a fixed
  name-to-country list, both inside its JavaScript bundle (about ten operators on Nov 6). Every other node shows
  "Not labelled". Nothing on the chain is read, so getting a name means asking the Arkiv team to edit the site.
- **Reproduce:** open nodes.arkiv.network, pick an unlisted provider; search the page's script for "Not labelled".
- **What we built:** `nodewatch.profile` (see `schema.md`): name, country and contact, signed by the provider key and
  verifiable by anyone. A site could read these instead of a hand-kept list.

## Slow queries

The slow-query finder loads test data into our own node (and into a private dev node on the same host) and times 42
query shapes at several dataset sizes. It never queried a public endpoint. **Per-shape results and any slow shapes go to
the Arkiv team privately** (the channel given at the Arkiv booth, or the encrypted Swarm vault) and are not listed here,
in the code, or in the demo video.

Friction we hit while building it (none of this is a finding):

- **Benchmarking needs paid writes.** On a public chain there is no way to load data into "your own node" only: every
  write is a transaction that every node stores. A 5,000-entity dataset is ~200 batch transactions, so the operator
  has to fund a separate writer from the faucet. A documented way to run a local Arkiv node for benchmarks (or a
  "bench mode" that keeps writes local) would make this track easier.
- **Receipt polling dominated seeding.** viem's default 4 s receipt poll made seeding 5,000 entities take ~13 min on a
  250 ms dev chain; pipelining batches with explicit nonces and a 250 ms poll brought it to ~12 s.
- **A receipt can arrive a block before the query index shows the entities.** Timing right after the last receipt can
  see a partial dataset; we wait until the count matches before measuring.
