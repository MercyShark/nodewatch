// Self-expiring liveness entity on Arkiv (schema nodewatch.heartbeat). Expiry 60 blocks (~2 min),
// renewed every 30 s with executeBatch (patch + extend). Enabled only when HEARTBEAT_PRIVATE_KEY is
// set AND HEARTBEAT_ENABLED=true. Writes go through EL_RPC_URL. Never uses the provider key.
import { ExpirationTime } from "@arkiv-network/sdk";
import { addr, dec, u64 } from "@arkiv-network/sdk/schema";
import type { Hex } from "viem";
import type { Ctx } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { heartbeatWrites } from "../metrics.js";
import { errMsg, jsonRpc } from "../util/http.js";
import { addressOf, publicArkiv, walletArkiv } from "./client.js";
import { Heartbeat } from "./schemas.js";

export function heartbeatStatus(code: string): "ok" | "degraded" | "down" {
  if (code === "healthy") return "ok";
  if (code === "container_down" || code === "wrong_chain" || code === "el_offline" || code === "disk_full" || code === "oom") return "down";
  return "degraded";
}

const truncate = (s: string, bytes: number) => {
  const b = Buffer.from(s, "utf8");
  return b.length <= bytes ? s : b.subarray(0, bytes).toString("utf8").replace(/�$/, "");
};

export class HeartbeatWriter {
  readonly writer: string | null;
  readonly enabled: boolean;
  private readonly reasonDisabled: string | null;

  constructor(private readonly ctx: Ctx) {
    const cfg = ctx.cfg;
    this.writer = addressOf(cfg.HEARTBEAT_PRIVATE_KEY);
    let reason: string | null = null;
    if (!cfg.HEARTBEAT_PRIVATE_KEY) reason = "HEARTBEAT_PRIVATE_KEY is not set";
    else if (!cfg.HEARTBEAT_ENABLED) reason = "HEARTBEAT_ENABLED is not true";
    else if (cfg.PROVIDER_ADDRESS && this.writer?.toLowerCase() === cfg.PROVIDER_ADDRESS.toLowerCase())
      reason = "refusing to use the provider key for heartbeats; use a separate hot key";
    this.enabled = reason === null;
    this.reasonDisabled = reason;
    const last = ctx.db.prepare("SELECT * FROM heartbeats_sent WHERE ok = 1 ORDER BY ts DESC LIMIT 1").get() as
      | { ts: number; tx_hash: string; block: number; entity_key: string; expires_at_block: number }
      | undefined;
    ctx.state.heartbeat = {
      enabled: this.enabled,
      writer: this.writer,
      entityKey: getSetting<string | null>(ctx.db, "heartbeatEntityKey", null),
      lastTxHash: last?.tx_hash ?? null,
      lastBlock: last?.block ?? null,
      lastAt: last?.ts ?? null,
      expiresAtBlock: last?.expires_at_block ?? null,
      failuresInRow: 0,
      reason,
    };
  }

  private async entityAlive(key: string): Promise<boolean> {
    const e = await jsonRpc<unknown>(this.ctx.cfg.EL_RPC_URL, "arkiv_getEntity", [key], 8000);
    return e !== null && e !== undefined;
  }

  /** One heartbeat write. Throws on failure (the scheduler records it). */
  async beat(): Promise<void> {
    if (!this.enabled) return;
    const ctx = this.ctx;
    const hb = ctx.state.heartbeat;
    try {
      const { wallet } = walletArkiv(ctx.cfg, ctx.cfg.HEARTBEAT_PRIVATE_KEY!);
      const k = ctx.state.kpis;
      const v = ctx.state.verdict;
      const values = {
        provider: addr((ctx.cfg.PROVIDER_ADDRESS ?? this.writer!) as Hex),
        status: heartbeatStatus(v.code),
        verdict: v.code,
        headLag: u64(Math.max(0, Math.round(k?.headLag ?? 0))),
        diskDaysLeft: dec((Math.min(99999, Math.max(0, k?.diskDaysLeft ?? 0))).toFixed(2)),
        peersEl: u64(Math.max(0, k?.peersEl ?? 0)),
        peersCl: u64(Math.max(0, k?.peersCl ?? 0)),
        client: truncate(ctx.state.el?.version ?? "unknown", 128),
        agentVersion: truncate(ctx.cfg.AGENT_VERSION, 128),
        label: truncate(getSetting<string | null>(ctx.db, "nodeLabel", null) ?? "", 64),
      };
      const expiration = ExpirationTime.fromBlocks(ctx.cfg.HEARTBEAT_EXPIRY_BLOCKS);
      let key = hb.entityKey;
      if (key && !(await this.entityAlive(key))) key = null;
      let txHash: string;
      let expiresAt: number | null = null;
      if (!key) {
        const r = await wallet.createEntity(Heartbeat, values, { expiration });
        key = r.entityKey;
        txHash = r.txHash;
        expiresAt = Number(r.expiresAt);
        setSetting(ctx.db, "heartbeatEntityKey", key);
      } else {
        const r = await wallet.executeBatch({
          patches: [{ schema: Heartbeat, entityKey: key as Hex, set: values }],
          extensions: [{ entityKey: key as Hex, expiration }],
        });
        txHash = r.txHash;
      }
      const receipt = await publicArkiv(ctx.cfg).getTransactionReceipt({ hash: txHash as Hex });
      const block = Number(receipt.blockNumber);
      expiresAt ??= block + ctx.cfg.HEARTBEAT_EXPIRY_BLOCKS;
      const now = Date.now();
      Object.assign(hb, { entityKey: key, lastTxHash: txHash, lastBlock: block, lastAt: now, expiresAtBlock: expiresAt, failuresInRow: 0, reason: null });
      ctx.db
        .prepare("INSERT INTO heartbeats_sent(ts, ok, tx_hash, block, entity_key, expires_at_block, error) VALUES (?, 1, ?, ?, ?, ?, NULL)")
        .run(now, txHash, block, key, expiresAt);
      ctx.db.prepare("DELETE FROM heartbeats_sent WHERE ts < ?").run(now - 7 * 86_400_000);
      heartbeatWrites.inc({ ok: "true" });
      ctx.bus.publish({ event: "heartbeat", data: { ...hb } });
    } catch (err) {
      hb.failuresInRow++;
      hb.reason = errMsg(err).slice(0, 300);
      ctx.db.prepare("INSERT INTO heartbeats_sent(ts, ok, error) VALUES (?, 0, ?)").run(Date.now(), hb.reason);
      heartbeatWrites.inc({ ok: "false" });
      ctx.bus.publish({ event: "heartbeat", data: { ...hb } });
      throw err;
    }
  }

  disabledReason(): string | null {
    return this.reasonDisabled;
  }
}
