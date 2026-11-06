# Real use: who needs this and what it tells them

## The user

A **community node operator**: someone who runs the Arkiv node kit on a VM to serve RPC to the community load
balancer and earn tGLM per call. Typically a DevOps engineer, not a protocol engineer. What they care about:

1. Am I serving right now, and if not, why?
2. Will something break overnight (disk, agreement expiry, gas)?
3. Am I getting paid for what I serve?

The second user is the **Arkiv team**. They see from the outside that a node dropped out of rotation, but not why.

## Evidence from running a node ourselves (Nov 4, 2026)

| Observation | What Nodewatch does with it |
|---|---|
| nodes.arkiv.network shows **in rotation / out** as a binary, with no reason | The verdict engine names the cause (`tunnel_down`, `lagging`, `el_offline`, `no_agreement`, …) and the fix |
| The dashboard showed **475 answers** while our `rpc.counter` said **0** | Pool view shows both, with "counter as of block N", so a zero counter isn't read as a fault |
| Agreements expire unless the LB refreshes them (~71 h left at one point) | `AgreementExpiringSoon` alert at < 2 h |
| Disk use reports disagree (sparse `mdbx.dat`) | Allocated-bytes measurement + growth forecast + `DiskDaysLeftLow` (< 7 d) |
| Arkiv's docs warn the chain grows by **tens of GB per day** under load | A 1 TB volume can fill in weeks. The forecast gives a date, not a percentage |
| Faucet wait + tunnel acceptance took minutes, with no feedback in between | Live tunnel/agreement state in the Pool view and in `doctor.sh` |
| Node label is "Not labelled" | A self-chosen label, set in the UI, published in the heartbeat (Fleet views) and in the offer payload |
| The LB keeps a serving node's agreement rolling (~71 h left for days), but once it lapses, getting back in is two manual commands with a wait between them | Autopilot re-posts the offer and signs the new tunnel token when the agreement is gone, unattended |
| With the tunnel pointed through Nodewatch for 52 min (6 Nov), the pool sent **13 requests/min**: 667 `eth_blockNumber`, 72 `eth_getLogs`, 12 `eth_chainId`, 2 `eth_getBlockByNumber`, 0 `arkiv_query`; `eth_getLogs` failed **72/72** with `-32603 golemdb segment_range_of(transactions): NotImplemented`, p95 84 ms; everything else answered in 2–4 ms | Live queries: requests/min, latency and errors per method with the node's own error text, query shapes when `arkiv_query` arrives, one-click inline/passive |

## What it tells them (from our live node)

- `healthy`: head 213,171, lag 0 vs reference, 10 EL / 10 CL peers, tunnel `running` on remote port 20009
- 960 GiB free on a 1,000 GiB gp3 volume, with a days-left forecast once there is enough growth history
- Provider balance 9.9999 tGLM after the offer transaction (gas ~0.00013 tGLM)
- Node containers up for 20 h, no OOM kills

## Out-of-band: when the whole host dies

A dashboard on the dead host can't page anyone. The `nodewatch.heartbeat` entity expires about 2 minutes after the
last renewal. Any other Nodewatch (a teammate's laptop, a second node) that trusts our creator address shows the node
gone and can alert. It needs no extra AWS service, no external uptime checker, and no new infrastructure.
