// The node kit's files the autopilot may touch: `.env` (merge the five TUNNEL_* lines, enable the tunnel profile)
// and `frpc.toml` (rendered from the kit's own template, exactly as setup.sh does with envsubst). Nothing else in
// the kit directory is written. Every write is atomic (temp file + rename) and keeps mode 600.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TUNNEL_KEYS = ["TUNNEL_SERVER_ADDR", "TUNNEL_SERVER_PORT", "TUNNEL_REMOTE_PORT", "TUNNEL_AGREEMENT", "TUNNEL_TOKEN"] as const;
export type TunnelValues = Record<(typeof TUNNEL_KEYS)[number], string>;

function atomicWrite(file: string, text: string): void {
  const tmp = `${file}.nodewatch-tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The kit's .env as a map; comments and unknown lines are kept verbatim when merged back. */
export function readEnv(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

/** Same semantics as marketplace.sh merge_env + enable_profile: replace existing keys in place, append missing ones. */
export function mergeEnv(file: string, values: Record<string, string>, enableProfile?: string): void {
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
  const pending = { ...values };
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (!m) return line;
    const k = m[1]!;
    if (k in pending) {
      const v = pending[k]!;
      delete pending[k];
      return `${k}=${v}`;
    }
    if (enableProfile && k === "COMPOSE_PROFILES") {
      const current = line
        .slice("COMPOSE_PROFILES=".length)
        .replace(/#.*/, "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!current.includes(enableProfile)) current.push(enableProfile);
      enableProfile = undefined;
      return `COMPOSE_PROFILES=${current.join(",")}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of Object.entries(pending)) out.push(`${k}=${v}`);
  if (enableProfile) out.push(`COMPOSE_PROFILES=${enableProfile}`);
  atomicWrite(file, out.join("\n") + "\n");
}

/** envsubst with the five tunnel variables only, like setup.sh. */
export function renderFrpc(template: string, v: TunnelValues): string {
  return template.replace(/\$\{(TUNNEL_[A-Z_]+)\}/g, (m, k: string) => (k in v ? v[k as keyof TunnelValues] : m));
}

export interface KitPaths {
  dir: string;
  env: string;
  template: string;
  frpc: string;
  keystore: string;
}

export function kitPaths(dir: string): KitPaths {
  return {
    dir,
    env: path.join(dir, ".env"),
    template: path.join(dir, "templates", "frpc.toml.tmpl"),
    frpc: path.join(dir, "frpc.toml"),
    keystore: path.join(dir, "secrets", "provider-key.json"),
  };
}

/** Write the tunnel settings into .env, enable the tunnel profile, render frpc.toml. Returns what changed. */
export function applyTunnelSettings(kit: KitPaths, v: TunnelValues): { envChanged: boolean; frpcChanged: boolean } {
  const before = readEnv(kit.env);
  const envChanged = TUNNEL_KEYS.some((k) => before[k] !== v[k]);
  if (envChanged) mergeEnv(kit.env, v, "tunnel");
  else if (!(before.COMPOSE_PROFILES ?? "").split(",").includes("tunnel")) mergeEnv(kit.env, {}, "tunnel");
  const rendered = renderFrpc(readFileSync(kit.template, "utf8"), v);
  const current = existsSync(kit.frpc) ? readFileSync(kit.frpc, "utf8") : null;
  const frpcChanged = current !== rendered;
  if (frpcChanged) atomicWrite(kit.frpc, rendered);
  return { envChanged, frpcChanged };
}
