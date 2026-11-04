// Optional on-demand sandbox chain: a labelled, resource-limited container that exists only for the
// duration of a run (created and removed through the Docker allowlist).
import type { Ctx } from "../context.js";
import { jsonRpc } from "../util/http.js";
import { sandboxUrl } from "./guard.js";

export async function withSandbox<T>(ctx: Ctx, fn: (url: string, chainId: number) => Promise<T>): Promise<T> {
  const id = await ctx.docker.createSandbox(ctx.cfg.BENCH_SANDBOX_PORT);
  try {
    const url = sandboxUrl(ctx.cfg);
    const deadline = Date.now() + 120_000;
    let chainId: number | null = null;
    while (Date.now() < deadline) {
      try {
        chainId = Number(BigInt(await jsonRpc<string>(url, "eth_chainId", [], 3000)));
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    if (chainId === null) throw new Error("sandbox chain did not answer within 120 s");
    return await fn(url, chainId);
  } finally {
    await ctx.docker.removeSandbox(id).catch((err: unknown) => ctx.log.warn({ err: String(err) }, "sandbox removal failed"));
  }
}
