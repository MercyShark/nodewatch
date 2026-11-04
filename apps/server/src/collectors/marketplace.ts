// Community marketplace entities (listing, offer, agreement, counter, receipts) read from Arkiv
// through our own node (EL_RPC_URL). Formats verified against the live chain (docs/ENVIRONMENT.md).
import type { Ctx } from "../context.js";
import { arkivQuery, arkivQueryAll, attrJson, attrStr, qaddr, qstr, type RawEntity } from "../arkiv/rpc.js";
import type { MarketplaceSnapshot } from "../state.js";

const BLOCK_SEC = 2;

const newest = (list: RawEntity[]) =>
  [...list].sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0))[0] ?? null;

export function createMarketplaceCollector(ctx: Ctx) {
  return async function collectMarketplace(): Promise<void> {
    const url = ctx.cfg.EL_RPC_URL;
    const lb = qaddr(ctx.cfg.LB_ADDRESS);
    const provider = ctx.cfg.PROVIDER_ADDRESS;

    const listingP = arkivQuery(url, `$creator = ${lb} AND kind = ${qstr("rpc.lb_listing")}`, { limit: 10 });
    const providerQueries = provider
      ? [
          arkivQuery(url, `$creator = ${qaddr(provider)} AND kind = ${qstr("rpc.offer")}`, { limit: 20 }),
          arkivQuery(url, `$creator = ${lb} AND kind = ${qstr("rpc.agreement")} AND provider = ${qaddr(provider)}`, { limit: 20 }),
          arkivQuery(url, `$creator = ${lb} AND kind = ${qstr("rpc.counter")} AND provider = ${qaddr(provider)}`, { limit: 50 }),
          arkivQueryAll(url, `$creator = ${qaddr(ctx.cfg.SETTLE_ADDRESS)} AND provider = ${qaddr(provider)}`, 300),
        ]
      : [];
    const [listingPage, offers, agreements, counters, receipts] = await Promise.all([listingP, ...providerQueries]);
    const block = listingPage.blockNumber;
    const secTo = (b: number | null) => Math.max(0, ((b ?? block) - block) * BLOCK_SEC);

    const l = newest(listingPage.entities);
    const lp = l ? attrJson<{ wei_per_call?: string; tunnel_server?: string; max_providers?: number }>(l) : null;
    const o = offers ? newest(offers.entities) : null;
    const a = agreements ? newest(agreements.entities) : null;
    const ap = a ? attrJson<{ wei_per_call?: string; remote_port?: number }>(a) : null;
    const counterList = counters?.entities ?? [];
    const c =
      newest(counterList.filter((x) => attrStr(x, "state") === "open" && (!a || attrStr(x, "agreement")?.toLowerCase() === a.key.toLowerCase()))) ??
      newest(counterList);
    const cp = c ? attrJson<{ count?: number; opened_block?: number }>(c) : null;

    const snap: MarketplaceSnapshot = {
      at: Date.now(),
      block,
      providerAddress: provider ?? null,
      lbAddress: ctx.cfg.LB_ADDRESS,
      listing: l
        ? {
            key: l.key,
            weiPerCall: String(lp?.wei_per_call ?? "0"),
            maxProviders: Number(lp?.max_providers ?? 0),
            tunnelServer: String(lp?.tunnel_server ?? ""),
          }
        : null,
      offer: o ? { key: o.key, expiresAtBlock: o.expiresAt ?? 0, expiresInSec: secTo(o.expiresAt) } : null,
      agreement: a
        ? {
            key: a.key,
            remotePort: Number(ap?.remote_port ?? 0),
            weiPerCall: String(ap?.wei_per_call ?? "0"),
            updatedAtBlock: a.updatedAt ?? a.createdAt ?? 0,
            expiresAtBlock: a.expiresAt ?? 0,
            expiresInSec: secTo(a.expiresAt),
          }
        : null,
      counter: c
        ? {
            key: c.key,
            count: Number(cp?.count ?? 0),
            state: attrStr(c, "state") ?? "unknown",
            openedBlock: Number(cp?.opened_block ?? 0),
            updatedAtBlock: c.updatedAt ?? c.createdAt ?? 0,
          }
        : null,
      receipts: (receipts?.entities ?? [])
        .sort((x, y) => (y.createdAt ?? 0) - (x.createdAt ?? 0))
        .map((r) => ({ key: r.key, createdAtBlock: r.createdAt ?? 0, payload: attrJson(r) ?? {} })),
    };
    ctx.state.marketplace = snap;
    const now = Date.now();
    if (snap.counter) ctx.tsdb.record("pool_counter_count", snap.counter.count, {}, now);
    ctx.tsdb.record("pool_agreement_live", snap.agreement ? 1 : 0, {}, now);
  };
}

/** Recompute expiry countdowns against a fresher block number. */
export function poolAt(snap: MarketplaceSnapshot, block: number | null) {
  const b = block ?? snap.block ?? 0;
  const sec = (x: number) => Math.max(0, (x - b) * BLOCK_SEC);
  return {
    ...snap,
    offer: snap.offer ? { ...snap.offer, expiresInSec: sec(snap.offer.expiresAtBlock) } : null,
    agreement: snap.agreement ? { ...snap.agreement, expiresInSec: sec(snap.agreement.expiresAtBlock) } : null,
  };
}
