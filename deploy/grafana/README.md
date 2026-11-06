# Fleet view: one Grafana for many Nodewatch nodes

Every Nodewatch already serves Prometheus metrics on `/metrics` and writes one JSON line per request to
`requests.jsonl` in its data volume. This folder puts them on one screen for any number of nodes.

```
node A: Nodewatch → /metrics ──┐                         ┌─ Prometheus (numbers, 30 d)
        requests.jsonl ─ agent ─┼── push over HTTP ─ Caddy ─┤
node B: … ──────────────────────┘   (user + password)      └─ Loki (per-request log, 30 d)
                                                            Grafana :3000 reads both
```

Nodes push; nothing scrapes them, so a node needs no new inbound port.

## The server (once)

A small Ubuntu box with Docker (a t3.small is plenty).

```
scripts/grafana-deploy.sh grafana            # copies server/ to the box (SSH alias "grafana")
ssh grafana 'cd ~/nodewatch-grafana/server && sudo bash bootstrap.sh'
```

`bootstrap.sh` generates the Grafana admin password and the push password, writes `.env` (mode 600), starts the
four containers and prints both passwords once. Open `http://<box>:3000`, sign in as `admin`.

Ports: 3000 Grafana (its own login), 9091 Prometheus remote write and 3101 Loki push (both behind the push
password). Open 9091 and 3101 only to your nodes' IPs. Without a hostname there is no TLS; with one, add it to the
`Caddyfile` and Caddy fetches a certificate by itself.

## A node (one command each)

On the node host, with the Nodewatch container already running:

```
GRAFANA_HOST=<box ip> PUSH_PASSWORD=<from bootstrap> sudo -E bash deploy/grafana/agent/run.sh
```

That starts `nodewatch-agent` (Grafana Alloy, host network). It reads `http://127.0.0.1:8000/metrics` every 15 s
(loopback, so no `METRICS_TOKEN` needed) and tails `requests.jsonl` from the `nodewatch` volume, read-only. For the
compose install set `NODEWATCH_VOLUME=/srv/nodewatch`. Give each node a different `INSTANCE_NAME`: that is the
`node` label on every series and every log line.

## The dashboards

- **Nodewatch · Fleet**: one row per node with healthy, containers, head lag, peers, disk days left, inline mode,
  requests per second and p95, plus head lag, disk, CPU and traffic over time.
- **Nodewatch · Live queries**: requests per second by node and by method, p50/p95/p99 with the 750 ms and 3 s
  lines, error rate, slow and critical requests per minute, errors by code, and three log panels from Loki: every
  request as it arrives with its text and the node's answer, the slow ones, the failed ones. Top `arkiv_query`
  shapes over the last hour come from the log too.

Pick nodes and methods with the variables at the top. Both dashboards refresh on their own.

## What leaves the node

Numbers (counts, latency buckets, host and chain gauges) and, per request: time, method, duration, ok/error, the
node's error text, the query shape id and the request text. It is the operator's own traffic, sent to the
operator's own box. Set `REQUEST_LOG=false` on a node to keep the text at home; the numbers still flow.
