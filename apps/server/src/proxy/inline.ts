// Inline mode: point the kit's tunnel (frpc) at Nodewatch's RPC proxy instead of the execution container, so the
// pool's real queries are measured. One switch in the UI; the file edit is two lines of frpc.toml, the tunnel is
// restarted through the Docker allowlist, and the change is re-applied whenever the kit re-renders the file.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { ProxyMode } from "@nodewatch/shared";
import { kitPaths } from "../autopilot/kitfiles.js";
import type { Ctx } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { errMsg } from "../util/http.js";

export const INLINE_SETTING = "rpc_inline";
const KIT_TARGET = { ip: "execution", port: 8545 } as const;

export interface FrpcTarget {
  ip: string;
  port: number;
}

/** The local target of the first [[proxies]] block (`localIP` / `localPort`), or null when absent. */
export function parseFrpcTarget(toml: string): FrpcTarget | null {
  const ip = /^\s*localIP\s*=\s*"([^"]*)"/m.exec(toml)?.[1];
  const port = /^\s*localPort\s*=\s*(\d+)/m.exec(toml)?.[1];
  if (!ip || !port) return null;
  return { ip, port: Number(port) };
}

/** Replace only the localIP / localPort lines; everything else (comments, token, ports) is kept byte for byte. */
export function rewriteFrpcTarget(toml: string, target: FrpcTarget): string {
  if (!parseFrpcTarget(toml)) throw new Error("frpc.toml has no localIP/localPort lines");
  return toml.replace(/^(\s*localIP\s*=\s*)"[^"]*"/m, `$1"${target.ip}"`).replace(/^(\s*localPort\s*=\s*)\d+/m, `$1${target.port}`);
}

export interface GatewayListener {
  start(ip: string): Promise<void>;
  stop(): void;
  address(): string | null;
}

export interface InlineStatus {
  mode: ProxyMode;
  enabled: boolean;
  target: FrpcTarget | null;
  proxy: { ip: string | null; port: number };
  drift: boolean;
  switching: boolean;
}

export class InlineMode {
  private switching = false;
  private gateway: string | null = null;

  constructor(
    private readonly ctx: Ctx,
    private readonly listener: GatewayListener,
    private readonly logAction: (actor: string, ok: boolean, message: string) => void,
  ) {}

  enabled(): boolean {
    return getSetting<boolean>(this.ctx.db, INLINE_SETTING, false);
  }

  private frpcFile(): string | null {
    const dir = this.ctx.cfg.NODE_KIT_DIR;
    if (!dir) return null;
    const f = kitPaths(dir).frpc;
    return existsSync(f) ? f : null;
  }

  /** What frpc.toml says right now. */
  target(): FrpcTarget | null {
    const f = this.frpcFile();
    if (!f) return null;
    try {
      return parseFrpcTarget(readFileSync(f, "utf8"));
    } catch {
      return null;
    }
  }

  private async proxyIp(): Promise<string> {
    if (!this.gateway) this.gateway = await this.ctx.docker.kitNetworkGateway();
    return this.gateway;
  }

  status(): InlineStatus {
    const target = this.target();
    const port = this.ctx.cfg.PROXY_PORT;
    const enabled = this.enabled();
    const listening = this.listener.address();
    const inline = !!target && target.port === port && (listening !== null ? target.ip === listening : target.ip === this.gateway);
    return {
      mode: inline ? "inline" : "passive",
      enabled,
      target,
      proxy: { ip: listening ?? this.gateway, port },
      drift: enabled && !inline,
      switching: this.switching,
    };
  }

  /** At boot: if inline was enabled, bring the gateway listener up so the tunnel's traffic has somewhere to go. */
  async boot(): Promise<void> {
    if (!this.enabled()) return;
    try {
      await this.listener.start(await this.proxyIp());
      this.ctx.log.info({ gateway: this.gateway }, "inline proxy: listening for the tunnel");
    } catch (err) {
      this.ctx.log.error({ err: errMsg(err) }, "inline proxy: could not start the gateway listener");
    }
  }

  private async waitTunnel(timeoutMs = 30_000): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        const res = await fetch(this.ctx.cfg.TUNNEL_STATUS_URL, { signal: AbortSignal.timeout(3000) });
        if (!res.ok) continue;
        const body = (await res.json()) as Record<string, { status: string }[]>;
        const proxies = Object.values(body).flat();
        if (proxies.length > 0 && proxies.every((p) => p.status === "running")) return true;
      } catch {
        /* frpc restarting */
      }
    }
    return false;
  }

  private writeTarget(file: string, target: FrpcTarget): string {
    const before = readFileSync(file, "utf8");
    const after = rewriteFrpcTarget(before, target);
    if (after !== before) {
      const tmp = `${file}.nodewatch-tmp`;
      writeFileSync(tmp, after, { mode: 0o600 });
      renameSync(tmp, file);
    }
    return before;
  }

  private async apply(target: FrpcTarget, actor: string, label: string): Promise<string> {
    const file = this.frpcFile();
    if (!file) throw new Error("the tunnel is not configured yet (no frpc.toml in the node kit); join the pool first");
    if (this.switching) throw new InlineBusyError("a switch is already running");
    this.switching = true;
    try {
      const before = this.writeTarget(file, target);
      let restarted: string;
      try {
        const r = await this.ctx.docker.restartTunnel();
        restarted = `tunnel ${r.action}`;
      } catch (err) {
        writeFileSync(file, before, { mode: 0o600 });
        throw new Error(`tunnel restart failed, frpc.toml restored: ${errMsg(err)}`);
      }
      const running = await this.waitTunnel();
      if (!running) {
        writeFileSync(file, before, { mode: 0o600 });
        try {
          await this.ctx.docker.restartTunnel();
        } catch {
          /* reported below */
        }
        const msg = `${label}: frpc did not report running within 30 s; reverted to the previous target`;
        this.logAction(actor, false, msg);
        throw new Error(msg);
      }
      const msg = `${label}: ${restarted}, frpc running, traffic now goes to ${target.ip}:${target.port}`;
      this.logAction(actor, true, msg);
      return msg;
    } finally {
      this.switching = false;
    }
  }

  async enable(actor: string): Promise<string> {
    const ip = await this.proxyIp();
    await this.listener.start(ip);
    const msg = await this.apply({ ip, port: this.ctx.cfg.PROXY_PORT }, actor, "inline on");
    setSetting(this.ctx.db, INLINE_SETTING, true);
    return msg;
  }

  async disable(actor: string): Promise<string> {
    const msg = await this.apply({ ...KIT_TARGET }, actor, "inline off");
    setSetting(this.ctx.db, INLINE_SETTING, false);
    this.listener.stop();
    return msg;
  }

  /** Inline is on but the file points elsewhere (re-rendered by Autopilot or setup.sh): put it back. */
  async reapply(reason: string): Promise<boolean> {
    if (!this.enabled() || this.switching) return false;
    const st = this.status();
    if (st.mode === "inline") return false;
    const ip = await this.proxyIp();
    await this.listener.start(ip);
    await this.apply({ ip, port: this.ctx.cfg.PROXY_PORT }, "nodewatch", `inline re-applied (${reason})`);
    return true;
  }
}

export class InlineBusyError extends Error {}
