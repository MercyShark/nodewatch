// Autopilot: keeps the node earning without an operator. Every minute it looks at the chain and the host and does
// the one next thing the kit would otherwise ask a human to do:
//   1. no live agreement and no live offer       → post an offer (provider key, in memory)
//   2. live agreement the tunnel is not set for   → sign the token, write .env + frpc.toml, restart the tunnel
//   3. tunnel container not running               → start it
// Every action is logged to the autopilot_log table and shown in the UI. The same preflight the kit runs before
// post-offer is run here, so no gas is spent on an offer the load balancer would skip. Off by default.
import { accessSync, constants } from "node:fs";
import { ExpirationTime } from "@arkiv-network/sdk";
import { bytes, defineSchema, i32, key as keyCol, str } from "@arkiv-network/sdk/schema";
import { stringToHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AutopilotAction, AutopilotState } from "@nodewatch/shared";
import { walletArkiv } from "../arkiv/client.js";
import { arkivQuery, attrJson, attrStr, qaddr, qstr, type RawEntity } from "../arkiv/rpc.js";
import type { Ctx } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { errMsg, jsonRpc } from "../util/http.js";
import { applyTunnelSettings, kitPaths, readEnv, TUNNEL_KEYS, type TunnelValues } from "./kitfiles.js";
import { ProviderLockedError, ProviderUnlock } from "./unlock.js";

const OFFER_DAYS = 1;
const SCHEMA_VERSION = 1;
const DEFAULT_TUNNEL_PORT = 7000;
/** Re-post the offer when the agreement has less than this left, so the LB has time to answer before it lapses. */
const RENEW_BEFORE_SEC = 6 * 3600;
/** Minimum gap between two offers from us, whatever the chain says (a safety net against a bug spending gas). */
const OFFER_COOLDOWN_MS = 30 * 60_000;

/** The offer's attributes as the kit writes them (unnamed schema, so no arkiv.schema tag). */
const Offer = defineSchema({
  kind: str().indexed(),
  v: i32().indexed(),
  lb_listing: keyCol().indexed(),
  payload: bytes(),
});

const byKind = (kind: string, ...conds: string[]) => [`kind = ${qstr(kind)}`, `v = i32(${SCHEMA_VERSION})`, ...conds].join(" AND ");
const alive = (head: number) => `$expiresAt > u64(${head})`;
const oldest = (list: RawEntity[]) => [...list].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0] ?? null;

function splitHostPort(address: string): [string, number] {
  const at = address.lastIndexOf(":");
  if (at < 0) return [address, DEFAULT_TUNNEL_PORT];
  const port = Number(address.slice(at + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`the listing's tunnel server ${address} has no valid port`);
  return [address.slice(0, at), port];
}

export class Autopilot {
  readonly unlock: ProviderUnlock;
  private enabled: boolean;
  private busy = false;
  private lastRun: number | null = null;
  private lastError: string | null = null;
  private next: string = "waiting for the first check";

  constructor(private readonly ctx: Ctx) {
    this.unlock = new ProviderUnlock(kitPaths(ctx.cfg.NODE_KIT_DIR).keystore);
    this.enabled = getSetting<boolean>(ctx.db, "autopilotEnabled", false);
    const pw = ctx.cfg.PROVIDER_KEYSTORE_PASSWORD;
    if (pw) {
      try {
        this.unlock.unlock(pw);
        ctx.log.info({ address: this.unlock.address }, "provider key unlocked from PROVIDER_KEYSTORE_PASSWORD (in memory only)");
      } catch (err) {
        ctx.log.warn({ err: errMsg(err) }, "PROVIDER_KEYSTORE_PASSWORD did not unlock the keystore");
      }
    }
  }

  // ---- settings ----

  get label(): string | null {
    return getSetting<string | null>(this.ctx.db, "nodeLabel", null);
  }
  setLabel(label: string | null): void {
    setSetting(this.ctx.db, "nodeLabel", label);
    this.record("label", true, label ? `label set to "${label}"` : "label cleared", null);
  }
  setEnabled(on: boolean): void {
    this.enabled = on;
    setSetting(this.ctx.db, "autopilotEnabled", on);
    this.record("toggle", true, on ? "autopilot enabled" : "autopilot disabled", null);
  }

  state(): AutopilotState {
    const kit = kitPaths(this.ctx.cfg.NODE_KIT_DIR);
    const env = readEnv(kit.env);
    return {
      enabled: this.enabled,
      providerAddress: this.unlock.address,
      keyUnlocked: this.unlock.unlocked,
      keyUnlockedAt: this.unlock.since,
      keystoreError: this.unlock.keystoreError,
      kitWritable: this.kitWritable(),
      tunnelConfiguredFor: env.TUNNEL_AGREEMENT ?? null,
      label: this.label,
      lastRun: this.lastRun,
      lastError: this.lastError,
      next: this.next,
      recent: this.ctx.db
        .prepare("SELECT ts, action, ok, message, tx_hash FROM autopilot_log ORDER BY ts DESC LIMIT 30")
        .all() as AutopilotAction[],
    };
  }

  private kitWritable(): string | null {
    const kit = kitPaths(this.ctx.cfg.NODE_KIT_DIR);
    try {
      accessSync(kit.env, constants.W_OK);
      accessSync(kit.dir, constants.W_OK);
      return null;
    } catch {
      return `${kit.dir} is not writable from Nodewatch: mount it read-write in compose.yaml (see README, Autopilot)`;
    }
  }

  private record(action: string, ok: boolean, message: string, txHash: string | null): void {
    this.ctx.db.prepare("INSERT INTO autopilot_log(ts, action, ok, message, tx_hash) VALUES (?, ?, ?, ?, ?)").run(Date.now(), action, ok ? 1 : 0, message.slice(0, 500), txHash);
    this.ctx.db.prepare("DELETE FROM autopilot_log WHERE ts < ?").run(Date.now() - 30 * 86_400_000);
    this.ctx.log.info({ action, ok, txHash }, `autopilot: ${message}`);
    this.ctx.bus.publish({ event: "autopilot", data: this.state() });
  }

  // ---- the loop ----

  /** One pass. Safe to call every minute; never runs twice at once. */
  async tick(): Promise<void> {
    if (!this.enabled) return;
    await this.pass();
  }

  /**
   * One pass on request ("Fix it" on no_agreement), even when the loop is switched off. Needs the key unlocked.
   * Returns what the pass decided, for the caller to show.
   */
  async runOnce(): Promise<string> {
    if (!this.unlock.unlocked) throw new ProviderLockedError();
    if (this.busy) return "the autopilot is already running a pass";
    await this.pass();
    if (this.lastError) throw new Error(this.lastError);
    return this.next;
  }

  private async pass(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.lastRun = Date.now();
    try {
      await this.step();
      this.lastError = null;
    } catch (err) {
      this.lastError = errMsg(err).slice(0, 300);
      this.next = `retry in 1 min: ${this.lastError}`;
      if (!(err instanceof ProviderLockedError)) this.record("error", false, this.lastError, null);
    } finally {
      this.busy = false;
    }
  }

  private async step(): Promise<void> {
    const cfg = this.ctx.cfg;
    const provider = this.unlock.address;
    if (!provider) throw new Error(this.unlock.keystoreError ?? "no provider keystore");
    const url = cfg.EL_RPC_URL;
    const lb = qaddr(cfg.LB_ADDRESS);
    const me = qaddr(provider);
    const head = Number(BigInt(await jsonRpc<string>(url, "eth_blockNumber", [], 8000)));

    const [listings, agreements, offers] = await Promise.all([
      arkivQuery(url, byKind("rpc.lb_listing", `$creator = ${lb}`, alive(head)), { limit: 10 }),
      arkivQuery(url, byKind("rpc.agreement", `$creator = ${lb}`, `provider = ${me}`, alive(head)), { limit: 20 }),
      arkivQuery(url, byKind("rpc.offer", `$creator = ${me}`, alive(head)), { limit: 20 }),
    ]);
    const listing = oldest(listings.entities);
    const agreement = oldest(agreements.entities);
    const offer = oldest(offers.entities);
    const secLeft = (e: RawEntity | null) => (e?.expiresAt ? Math.max(0, (e.expiresAt - head) * 2) : 0);

    // 2 + 3: an agreement exists → make sure the tunnel is configured for it and running.
    if (agreement) {
      const kit = kitPaths(cfg.NODE_KIT_DIR);
      const env = readEnv(kit.env);
      if ((env.TUNNEL_AGREEMENT ?? "").toLowerCase() !== agreement.key.toLowerCase()) {
        await this.configureTunnel(agreement, listing);
      } else {
        const t = this.ctx.state.tunnel;
        const c = this.ctx.state.containers.list.find((x) => x.service === "tunnel");
        if (c && !c.running) {
          const r = await this.ctx.docker.restartTunnel();
          this.record("tunnel-start", true, `tunnel container ${r.action}`, null);
        } else if (t && t.reachable && !t.running && Date.now() - t.at < 60_000 && !c?.running) {
          this.next = "tunnel configured; waiting for frpc to report running";
        }
      }
      // 1b: the agreement is about to lapse and there is no fresh offer → post one now.
      if (secLeft(agreement) < RENEW_BEFORE_SEC && !offer) {
        await this.postOffer(listing, head, `agreement ${agreement.key.slice(0, 10)}… expires in ${Math.round(secLeft(agreement) / 3600)} h`);
        return;
      }
      this.next = `agreement ok (${Math.round(secLeft(agreement) / 3600)} h left); tunnel ${this.ctx.state.tunnel?.running ? "running" : "not running yet"}`;
      return;
    }

    // 1: no agreement.
    if (offer) {
      this.next = `offer ${offer.key.slice(0, 10)}… posted; waiting for the load balancer (expires in ${Math.round(secLeft(offer) / 3600)} h)`;
      return;
    }
    await this.postOffer(listing, head, "no live agreement and no live offer");
  }

  // ---- actions ----

  private async postOffer(listing: RawEntity | null, head: number, why: string): Promise<void> {
    const cfg = this.ctx.cfg;
    const last = getSetting<number>(this.ctx.db, "autopilotLastOfferAt", 0);
    if (Date.now() - last < OFFER_COOLDOWN_MS) {
      this.next = `offer cooldown (${Math.round((OFFER_COOLDOWN_MS - (Date.now() - last)) / 60_000)} min) — ${why}`;
      return;
    }
    if (!listing) throw new Error(`no listing from the load balancer ${cfg.LB_ADDRESS}: it is not running, or this node is on another network`);
    const cl = this.ctx.state.cl;
    if (!cl || cl.isSyncing || cl.elOffline) throw new Error("the node is still syncing; the offer waits until it is current");
    const el = this.ctx.state.el;
    if (!el || el.chainId !== cfg.ARKIV_CHAIN_ID) throw new Error("the execution client is not on the expected chain");
    const balance = this.ctx.state.balances?.provider ?? null;
    if (balance !== null && balance <= 0) throw new Error(`the provider key ${this.unlock.address} has no tGLM for gas: fund it from the faucet`);
    const lp = attrJson<{ max_providers?: number }>(listing);
    const taken = (await arkivQuery(cfg.EL_RPC_URL, byKind("rpc.agreement", `$creator = ${qaddr(cfg.LB_ADDRESS)}`, alive(head)), { limit: 100 })).entities.length;
    if (lp?.max_providers && taken >= lp.max_providers) throw new Error(`the pool is full (${taken}/${lp.max_providers} slots); will retry`);

    const specs = {
      chain_id: cfg.ARKIV_CHAIN_ID,
      head: el.head,
      el: el.version ?? "unknown",
      cl: cl.version ?? "unknown",
      hw: { cpus: this.ctx.state.host?.cpuCount ?? 0, mem_gb: Math.round((this.ctx.state.host?.memTotal ?? 0) / 2 ** 30) },
    };
    const label = this.label;
    const payload = JSON.stringify(label ? { specs, label, agent: cfg.AGENT_VERSION } : { specs, agent: cfg.AGENT_VERSION });

    const txHash = await this.unlock.use(async (pk) => {
      const { wallet } = walletArkiv(cfg, pk, 1000);
      const r = await wallet.createEntity(
        Offer,
        { kind: str("rpc.offer"), v: i32(SCHEMA_VERSION), lb_listing: keyCol(listing.key as Hex), payload: bytes(stringToHex(payload)) },
        { expiration: ExpirationTime.fromDays(OFFER_DAYS) },
      );
      return r.txHash;
    });
    setSetting(this.ctx.db, "autopilotLastOfferAt", Date.now());
    this.record("post-offer", true, `offer posted (${why}); ${taken}/${lp?.max_providers ?? "?"} slots taken`, txHash);
    this.next = "offer posted; the load balancer answers within minutes";
  }

  private async configureTunnel(agreement: RawEntity, listing: RawEntity | null): Promise<void> {
    const cfg = this.ctx.cfg;
    if (!listing) throw new Error("the load balancer's listing is gone; cannot find the tunnel server");
    const writable = this.kitWritable();
    if (writable) throw new Error(writable);
    const lp = attrJson<{ tunnel_server?: string }>(listing);
    const ap = attrJson<{ remote_port?: number }>(agreement);
    if (!lp?.tunnel_server || !ap?.remote_port) throw new Error("listing or agreement payload is missing tunnel_server / remote_port");
    const [host, port] = splitHostPort(lp.tunnel_server);
    const token = await this.unlock.use((pk) => privateKeyToAccount(pk).signMessage({ message: `arkiv-rpc:${agreement.key.toLowerCase()}` }));
    const values: TunnelValues = {
      TUNNEL_SERVER_ADDR: host,
      TUNNEL_SERVER_PORT: String(port),
      TUNNEL_REMOTE_PORT: String(ap.remote_port),
      TUNNEL_AGREEMENT: agreement.key,
      TUNNEL_TOKEN: token,
    };
    const changed = applyTunnelSettings(kitPaths(cfg.NODE_KIT_DIR), values);
    let action = "settings unchanged";
    try {
      const r = await this.ctx.docker.restartTunnel();
      action = `tunnel ${r.action}`;
    } catch (err) {
      // No tunnel container yet (profile just enabled): the kit's setup.sh creates it. Say so; the next
      // tick keeps checking, and the Pool page shows the one command.
      action = `tunnel settings written; container not created yet (${errMsg(err).slice(0, 80)}). Run ./setup.sh once in the kit directory`;
    }
    this.record("tunnel-config", true, `agreement ${agreement.key.slice(0, 10)}…, port ${ap.remote_port}: ${action} (env ${changed.envChanged ? "updated" : "same"}, frpc.toml ${changed.frpcChanged ? "rendered" : "same"})`, null);
    this.next = "tunnel configured for the new agreement; waiting for frpc to connect";
  }

  /** Dry-run report for the UI: what the next tick would do, without doing it. */
  plan(): string {
    if (!this.enabled) return "autopilot is off";
    if (!this.unlock.unlocked) return "provider key is locked: unlock it to let the autopilot post offers and sign tunnel tokens";
    return this.next;
  }

  static readonly TUNNEL_KEYS = TUNNEL_KEYS;
  static readonly ATTR = attrStr;
}
