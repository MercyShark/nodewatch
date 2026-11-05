# Arkiv entities written by Nodewatch

All three are **named schemas** (`defineSchema` in `@arkiv-network/sdk/schema`), so every entity carries an indexed
`arkiv.schema` attribute holding its name. The fleet and bundle queries filter on it. Definitions:
`apps/server/src/arkiv/schemas.ts` and `apps/server/src/bench/dataset.ts`.

Nodewatch never writes with the node's provider key. Writers on Rabdi:

| Address | Writes | Key |
|---|---|---|
| `0xc90560311310162677c50Ef4bF5ae188295f947d` | `nodewatch.heartbeat`, `nodewatch.bundle` | Nodewatch hot key (`HEARTBEAT_PRIVATE_KEY`) |
| `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` | `nwbench.item` (own-node bench runs) | dedicated bench writer (`BENCH_PRIVATE_KEY`) |

The bench writer is a separate key on purpose: two writers on one key would collide on nonces, and the server refuses
to start an own-node run with the heartbeat key or with less than 0.05 tGLM.

## `nodewatch.heartbeat`: liveness + health summary (public)

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `provider` | addr | ✓ | the node's provider address (read from config, not signed by it) |
| `status` | str | ✓ | `ok` / `degraded` / `down` |
| `verdict` | str | ✓ | verdict code (`healthy`, `lagging`, `tunnel_down`, …) |
| `headLag` | u64 | ✓ | blocks behind the reference RPC |
| `diskDaysLeft` | dec | ✓ | disk-full forecast in days |
| `peersEl`, `peersCl` | u64 | | peer counts |
| `client` | str | | `web3_clientVersion` (≤ 128 bytes) |
| `agentVersion` | str | | Nodewatch version |

- **Owner / creator:** the Nodewatch hot key. Fleet trusts only pinned creators or `FLEET_TRUSTED_CREATORS`, because
  anyone can write an entity with this schema.
- **Expiry:** 60 blocks (~2 min), renewed every 30 s with one `executeBatch` (patch + extend). One entity per node,
  updated in place.
- **Why it's on Arkiv:** expiry is the dead man's switch. When the host dies, the entity disappears and every fleet
  view sees it without any extra infrastructure.
- **Queries:** `arkiv.schema = str('nodewatch.heartbeat')`; degraded nodes:
  `arkiv.schema = str('nodewatch.heartbeat') AND status = str('degraded')`;
  falling behind: `… AND headLag > u64(10)`; disk at risk: `… AND diskDaysLeft < dec(7)`.

## `nodewatch.bundle`: index of Swarm uploads (public, contents encrypted)

| Attribute | Type | Indexed | Meaning |
|---|---|---|---|
| `provider` | addr | ✓ | which node produced it |
| `kind` | str | ✓ | `diagnostic` / `findings` / `backup` / `sample` |
| `recipient` | addr | ✓ | who can decrypt it |
| `swarmRef` | str | | plain Swarm reference **to ciphertext** |
| `sha256` | str | | hash of the uploaded envelope |
| `scheme` | str | | `ecies-secp256k1-v1`, or `none` for `sample` |
| `sizeBytes` | u64 | | envelope size |

- **Expiry:** 30 days.
- **Safety:** `swarmRef` is never a Swarm *encrypted* reference (those embed the key). It points to an envelope that
  only `recipient`'s private key can open, so publishing it is safe.
- **Query:** "bundles for me" = `arkiv.schema = str('nodewatch.bundle') AND recipient = addr(0x…)`.

## `nwbench.item`: synthetic slow-query dataset (temporary)

| Attribute | Type | Indexed | Purpose |
|---|---|---|---|
| `cat` | str | ✓ | low-cardinality equality (10 values) |
| `n` | u64 | ✓ | numeric range / ordering |
| `score` | dec | ✓ | decimal range |
| `owner` | addr | ✓ | address equality (some rows = writer) |
| `tag` | str | ✓ | higher-cardinality equality (100 values) |
| `run` | str | ✓ | scopes every query to one bench run's rows |
| `label` | str | | non-indexed: the "order by unindexed attribute" case |
| `blob` | bytes | | 64–512 B payload to vary response size |

- **Values:** deterministic from a fixed seed (`mulberry32`), so runs are reproducible.
- **Expiry:** 6 hours. The dataset cleans itself up.
- **Writer:** `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` (own-node runs). Private-node runs sign with the dev chain's
  prefunded test account and never reach Rabdi.
- **Where:** sent **only** through our own node (`EL_RPC_URL`), or into a private `arkiv-reth-dev` node on the same host
  that exists only for the run. Writes through our node are real chain writes and therefore propagate. That is why
  they expire quickly and are scoped by `run`. Every timed query goes to our node or the private node, never to a
  public endpoint (enforced in `apps/server/src/bench/guard.ts`).
- **Example:** this run's items at the largest size:
  `arkiv.schema = str('nwbench.item') AND run = str('r<run-id-prefix>') AND n > u64(2500)`.
