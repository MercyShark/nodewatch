# What's new

## Side by side

| Question an operator asks | Docker health badges | Uptime Kuma (external) | nodes.arkiv.network | **Nodewatch** |
|---|---|---|---|---|
| Is the process up? | ✓ | — | — | ✓ |
| Is the node in rotation? | — | — | ✓ (binary) | ✓ |
| **Why** is it out of rotation? | — | — | — | ✓ verdict + fix |
| Head lag vs the network | — | — | partly | ✓ per block, with alerts |
| EL/CL peers, finality, OOM kills | — | — | — | ✓ |
| Tunnel + agreement state, time left | — | — | — | ✓ |
| Calls served vs counted vs paid | — | — | served | ✓ all three |
| When will the disk fill? | — | — | — | ✓ forecast (allocated bytes) |
| Which query shapes are slow on my node? | — | — | — | ✓ slow-query finder |
| Can others see I'm alive without access to my host? | — | needs a public endpoint | LB view only | ✓ heartbeat entity on Arkiv |
| Send logs to the Arkiv team privately | — | — | — | ✓ encrypted Swarm vault |
| Telegram / Slack / PagerDuty | — | ✓ | — | ✓ with grouping, inhibition, silences |

## What only Nodewatch shows

1. **A verdict, not a wall of graphs.** A rule engine over host, Docker, EL, CL, tunnel and marketplace state picks
   the single most important cause, using inhibition (container down suppresses "lagging").
2. **Arkiv as its own monitoring backend.** Health is published as a self-expiring entity, so liveness is a query:
   `arkiv.schema = str('nodewatch.heartbeat') && status = str('degraded')`. Expiry acts as the dead man's switch.
3. **A disk forecast that's right.** It measures allocated bytes, because reth's `mdbx.dat` is sparse, and turns
   growth rate into "days left".
4. **Query performance from the inside.** Seeded synthetic data, shapes × sizes, log-log scaling fit (`k > 1.2` =
   super-linear), offset vs cursor paging. It runs only against your own node, and results stay private.
5. **A web3-native private channel to the Arkiv team.** Bundles are encrypted to the engineer's Ethereum key
   (recovered from a signature, so no key files are exchanged), stored on Swarm and indexed on Arkiv.

## Why it's more than a dashboard

- **One container, zero extra infrastructure.** No Prometheus, Grafana, Alertmanager, Loki or exporters. Time
  series, alerting and auth are built in, with an SQLite store on the node's own disk.
- **EC2 only.** The reference deployment uses one EC2 instance with no inbound ports, accessed only through
  Session Manager. No S3, no CloudWatch, no SNS, no load balancer. Images are streamed over Session Manager.
- **Safe by construction.** Loopback only. Docker access goes through an allowlist. The provider key is never read.
  SIWE roles let a judge get a viewer login with no findings and no destructive actions.
- **Hard limits:** 2 vCPU / 3 GiB, and the bench pauses itself when head lag or host CPU rises.
