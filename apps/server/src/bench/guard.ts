// Hard rule: the slow-query finder sends queries ONLY to our own node (EL_RPC_URL) or the
// on-demand sandbox on loopback. Anything else is refused.
import type { Config } from "../config.js";

export class BenchTargetRefused extends Error {}

function canon(url: string): string {
  const u = new URL(url);
  const host = u.hostname === "localhost" ? "127.0.0.1" : u.hostname;
  const port = u.port || (u.protocol === "https:" ? "443" : "80");
  return `${u.protocol}//${host}:${port}${u.pathname.replace(/\/+$/, "")}`;
}

export function sandboxUrl(cfg: Pick<Config, "BENCH_SANDBOX_PORT">): string {
  return `http://127.0.0.1:${cfg.BENCH_SANDBOX_PORT}`;
}

/** Returns the URL if it is an allowed bench target, throws otherwise. */
export function assertBenchTarget(cfg: Pick<Config, "EL_RPC_URL" | "BENCH_SANDBOX_PORT">, url: string): string {
  let c: string;
  try {
    c = canon(url);
  } catch {
    throw new BenchTargetRefused(`bench target refused: not a URL`);
  }
  const allowed = [canon(cfg.EL_RPC_URL), canon(sandboxUrl(cfg))];
  if (!allowed.includes(c)) throw new BenchTargetRefused(`bench target refused: only EL_RPC_URL or the local sandbox may be queried`);
  return url;
}
