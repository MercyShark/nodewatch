import { describe, expect, it } from "vitest";
import { createTunnelCollector } from "./chain.js";
import { testCtx } from "../test/helpers.js";

const tunnel = (service: "tunnel" | "execution") =>
  ({ service, name: service, image: "", running: true, health: "healthy", restarts: 0, oomKilled: false, startedAt: null, cpuPct: 0, memBytes: 0, lastErrorLine: null }) as const;

describe("tunnel collector on a node outside the pool", () => {
  it("is not a failure when there is no tunnel container at all", async () => {
    const ctx = testCtx({ TUNNEL_STATUS_URL: "http://127.0.0.1:1/api/status" });
    ctx.state.containers = { at: Date.now(), available: true, reason: null, list: [tunnel("execution")] };
    await expect(createTunnelCollector(ctx)()).resolves.toBeUndefined();
    expect(ctx.state.tunnel).toMatchObject({ reachable: false, running: false });
  });
  it("still fails when the tunnel container exists but its status endpoint is down", async () => {
    const ctx = testCtx({ TUNNEL_STATUS_URL: "http://127.0.0.1:1/api/status" });
    ctx.state.containers = { at: Date.now(), available: true, reason: null, list: [tunnel("tunnel")] };
    await expect(createTunnelCollector(ctx)()).rejects.toThrow();
  });
});
