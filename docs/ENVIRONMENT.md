# Verified environment facts (read from the live node, Nov 4 2026)

Use these instead of guessing. Re-verify only if something fails.

## Node host
- EC2 `learing-test-rishabh` (`i-03d140128cc37e3cc`), `r7i.2xlarge`, ap-south-1a, AWS profile `sova-profile`
- One 1,000 GiB gp3 root volume; Docker data-root `/var/lib/docker`
- Node kit at `/opt/arkiv-community-node` (commit `4c9f5f2`), compose project `arkiv-community-node`
- Run a command on the node: `/tmp/claude-1000/-home-rishabh/4473384f-d4e5-4e41-9b5d-37e5faea8ed7/scratchpad/ssm-run.sh '<bash script>'` (runs as root, prints status + stdout)

## Containers
| Service | Container | Image |
|---|---|---|
| execution | `arkiv-community-node-execution-1` | `ghcr.io/arkiv-network/arkiv-reth:v1.0.0` |
| consensus | `arkiv-community-node-consensus-1` | `sigp/lighthouse:v8.3.1` |
| tunnel | `arkiv-community-node-tunnel-1` | `arkiv-community-node-tunnel` (frpc) |

Volumes: `arkiv-community-node_el-data` (~5.3 GB), `arkiv-community-node_cl-data` (~2.4 GB) under `/var/lib/docker/volumes/`.

## Endpoints (host loopback)
- EL JSON-RPC `http://127.0.0.1:8545` — `eth_chainId` → `0x76edaf`; `eth_syncing` → `false`; `net_peerCount`; `web3_clientVersion`
- CL Beacon `http://127.0.0.1:5052` — `/eth/v1/node/health` (200), `/eth/v1/node/syncing` →
  `{"data":{"is_syncing":false,"is_optimistic":false,"el_offline":false,"head_slot":"…","sync_distance":"0"}}`,
  `/eth/v1/node/peer_count` → `{"data":{"connected":"10",…}}`, `/eth/v1/node/version`,
  `/eth/v1/beacon/states/head/finality_checkpoints` → `{"data":{"previous_justified":{"epoch":"6502",…},"current_justified":{…},"finalized":{"epoch":"6502",…}}}`
- frpc status `http://127.0.0.1:7400/api/status` →
  `{"tcp":[{"name":"node-rpc-20009","type":"tcp","status":"running","err":"","local_addr":"execution:8545","remote_addr":"2.29.34.87:20009"}]}`
- Reference RPC `https://rpc.rabdi.db-chain.testnet.arkiv.network` (rate-limited; ≤ 1 call/min/metric)

## Arkiv
- Chain id 7794095 (`0x76edaf`), 2 s blocks (43,200/day), gas token tGLM (18 decimals)
- Read: JSON-RPC `arkiv_query` with params `[queryString, {select:{key,owner,creator,createdAt,updatedAt,expiresAt,attributes,attributeSchema}, limit:"0x.."}]`
  → `{"data":[…],"blockNumber":"0x…","cursor":"b64:…"}`. A query needs at least one filter.
  Example: `$creator = addr(0xca4b…)`, `$key = key(0x…)`. Attribute values: `bytes` come as hex.
- Write: SDK `@arkiv-network/sdk` (viem-based): `createWalletClient`, `createPublicClient`, chain `rabdi` from `@arkiv-network/sdk/chains`, schemas `defineSchema`, `executeBatch`, `ExpirationTime`.

## Community marketplace (entities, schema-less, `kind` attribute as type tag)
- LB address `0xCA4B166EE155Cb2816Dc25f94Dc1fD102a26c997`; settle address `0x411E31d7eBbfd636Af234954db5f598Cd80a878C`
- Our provider address `0xbD78B7d668282b8950774aB013706237b05a1880`
- `rpc.lb_listing` (creator LB): payload `{"wei_per_call":"1000000000000000","tunnel_server":"2.29.34.87:7000","max_providers":90}`
- `rpc.offer` (creator provider): attrs `lb_listing` (bytes32), payload `{"specs":{"chain_id","head","el","cl","hw":{"cpus","mem_gb"}}}`
- `rpc.agreement` (creator LB): attrs `offer` (bytes32), `provider` (addr), payload `{"wei_per_call","remote_port"}`; LB refreshes expiry while serving
- `rpc.counter` (creator LB): attrs `agreement` (bytes32), `provider` (addr), `state` (`open`/closed), payload `{"count","wei_per_call","opened_block"}`; count written ~daily
- Receipts are created by the settle address (format: see arkiv-community-lb `docs/ENTITIES.md`; none exist yet for us)
- The pool dashboard showed 475 answers served while the counter still said 0 (count is written periodically).
