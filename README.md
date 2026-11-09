# Nodewatch

**An ops console for Arkiv community nodes, in one container.**

Nodewatch runs next to the node kit and keeps the node in rotation. It watches health and disk, alerts on Telegram
and by a PagerDuty phone call, fixes a down container in one click, sits inline on the tunnel to time every query the
pool sends, benchmarks Arkiv query shapes, and puts many nodes on one Grafana screen.

Built at ETHGlobal Mumbai 2026 and demoed on a live Arkiv Rabdi node (since shut down).

## Quick start

On a host that already runs the node kit:

```bash
docker run -d --name nodewatch --restart unless-stopped --network host \
  -v nodewatch:/app/data -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/lib/docker:/data-root:ro -v /proc:/host/proc:ro -v /sys:/host/sys:ro \
  -v /:/host/root:ro,rslave -v /opt/arkiv-community-node:/host/root/opt/arkiv-community-node \
  -e INSTANCE_NAME=my-node -e HOST=0.0.0.0 -e PORT=8000 \
  -e PUBLIC_ORIGIN=http://YOUR_SERVER_IP:8000 -e ADMIN_ADDRESSES=0xYourWallet \
  rishabhdev04/nodewatch:latest
```

Open `http://YOUR_SERVER_IP:8000` and sign in with that wallet. Fleet view: [deploy/grafana](deploy/grafana/README.md).

## Arkiv writers

| Address | Writes |
|---|---|
| `0xc90560311310162677c50Ef4bF5ae188295f947d` | `nodewatch.heartbeat`, `nodewatch.bundle`, `nodewatch.profile` |
| `0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d` | `nwbench.item` (benchmarks) |
| `0xbD78B7d668282b8950774aB013706237b05a1880` | `rpc.offer` (node provider) |

Friction we hit on Arkiv: [arkiv/friction.md](arkiv/friction.md). Full spec: `CLAUDE.md`.

## How AI was used

Built with **Claude Code** (Anthropic). The operator chose the product, set the requirements, and approved every
infrastructure change and on-chain write. Claude wrote the spec, most of the code and tests, and ran the node setup
under the operator's approval. Everything in the demo was verified against the live node.

## License

Apache-2.0
