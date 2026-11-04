// Fleet view: every live nodewatch.heartbeat entity, read through our node. Trust only creators
// the operator pinned (FLEET_TRUSTED_CREATORS or the `fleetPinned` setting) plus our own writer.
import type { FleetNode, FleetResponse } from "@nodewatch/shared";
import type { Ctx } from "../context.js";
import { getSetting } from "../db/index.js";
import { arkivQueryAll, attrNum, attrStr, qstr } from "./rpc.js";
import { HEARTBEAT_SCHEMA_NAME, SCHEMA_ATTRIBUTE } from "./schemas.js";

export const FLEET_QUERY = `${SCHEMA_ATTRIBUTE} = ${qstr(HEARTBEAT_SCHEMA_NAME)}`;

export class FleetReader {
  private cache: { at: number; value: FleetResponse } | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly selfWriter: string | null,
  ) {}

  trusted(): Set<string> {
    const pinned = getSetting<string[]>(this.ctx.db, "fleetPinned", []);
    const s = new Set([...this.ctx.cfg.FLEET_TRUSTED_CREATORS, ...pinned.map((p) => p.toLowerCase())]);
    if (this.selfWriter) s.add(this.selfWriter.toLowerCase());
    return s;
  }

  async read(): Promise<FleetResponse> {
    if (this.cache && Date.now() - this.cache.at < 10_000) return this.cache.value;
    const page = await arkivQueryAll(this.ctx.cfg.EL_RPC_URL, FLEET_QUERY, 500, {
      select: { key: true, creator: true, expiresAt: true, attributes: true },
    });
    const block = page.blockNumber || null;
    const trusted = this.trusted();
    const self = this.selfWriter?.toLowerCase() ?? null;
    const nodes: FleetNode[] = page.entities.map((e) => {
      const creator = (e.creator ?? "").toLowerCase();
      const status = attrStr(e, "status");
      const dd = attrStr(e, "diskDaysLeft");
      return {
        entityKey: e.key,
        creator,
        provider: (attrStr(e, "provider") ?? "").toLowerCase(),
        status: status === "ok" || status === "degraded" || status === "down" ? status : "degraded",
        verdict: attrStr(e, "verdict") ?? "unknown",
        headLag: attrNum(e, "headLag"),
        diskDaysLeft: dd !== null && Number.isFinite(Number(dd)) ? Number(dd) : null,
        peersEl: attrNum(e, "peersEl"),
        peersCl: attrNum(e, "peersCl"),
        client: attrStr(e, "client"),
        agentVersion: attrStr(e, "agentVersion"),
        expiresAtBlock: e.expiresAt ?? 0,
        expiresInSec: block && e.expiresAt ? Math.max(0, (e.expiresAt - block) * 2) : 0,
        trusted: trusted.has(creator),
        isSelf: self !== null && creator === self,
      };
    });
    nodes.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || Number(b.trusted) - Number(a.trusted) || a.provider.localeCompare(b.provider));
    const value = { currentBlock: block, nodes };
    this.cache = { at: Date.now(), value };
    return value;
  }
}
