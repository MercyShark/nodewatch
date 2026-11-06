import { describe, expect, it, vi } from "vitest";
import type { Autopilot } from "../autopilot/index.js";
import type { Ctx } from "../context.js";
import { migrate } from "../db/index.js";
import Database from "better-sqlite3";
import { ActionConflictError, Actions } from "./index.js";

function ctxWith(verdict: Record<string, unknown>) {
  const db = new Database(":memory:");
  migrate(db);
  const docker = {
    restartNodeService: vi.fn(async (s: string) => ({ id: "x", action: "started" as const, s })),
    available: () => ({ ok: true, reason: null }),
    reclaimable: vi.fn(async () => ({ buildCache: 5e9, buildCacheEntries: 90, danglingImages: 6e8, danglingCount: 2 })),
    pruneBuildCache: vi.fn(async () => 5e9),
    pruneDanglingImages: vi.fn(async () => 6e8),
  };
  const ctx = { db, docker, state: { verdict, host: { diskFree: 9e11 } }, log: { info: () => {}, warn: () => {} } } as unknown as Ctx;
  const autopilot = { runOnce: vi.fn(async () => "offer posted") } as unknown as Autopilot;
  return { ctx, docker, autopilot, actions: new Actions(ctx, autopilot) };
}

describe("one-click actions", () => {
  it("restarts the service named by the live verdict and logs it", async () => {
    const t = ctxWith({ code: "tunnel_down", action: { kind: "restart_service", service: "tunnel" } });
    const r = await t.actions.fix("tunnel_down", "0xadmin");
    expect(t.docker.restartNodeService).toHaveBeenCalledWith("tunnel");
    expect(r.message).toMatch(/started the tunnel/);
    expect(t.actions.recent()[0]).toMatchObject({ actor: "0xadmin", action: "fix", ok: true });
  });
  it("does nothing when the verdict changed since the page loaded", async () => {
    const t = ctxWith({ code: "healthy", action: null });
    await expect(t.actions.fix("tunnel_down", "0xadmin")).rejects.toBeInstanceOf(ActionConflictError);
    expect(t.docker.restartNodeService).not.toHaveBeenCalled();
  });
  it("does nothing for a verdict without a one-click fix", async () => {
    const t = ctxWith({ code: "lagging", action: null });
    await expect(t.actions.fix("lagging", "0xadmin")).rejects.toThrow(/no one-click fix/);
  });
  it("runs one autopilot pass for no_agreement", async () => {
    const t = ctxWith({ code: "no_agreement", action: { kind: "autopilot_run" } });
    expect((await t.actions.fix("no_agreement", "0xadmin")).message).toMatch(/offer posted/);
  });
  it("previews and runs only the two cleanup kinds", async () => {
    const t = ctxWith({ code: "healthy" });
    const p = await t.actions.cleanupPreview();
    expect(p.items.map((i) => i.id)).toEqual(["build_cache", "dangling_images"]);
    const r = await t.actions.cleanup(["build_cache", "build_cache"], "0xadmin");
    expect(t.docker.pruneBuildCache).toHaveBeenCalledTimes(1);
    expect(t.docker.pruneDanglingImages).not.toHaveBeenCalled();
    expect(r.reclaimedBytes).toBe(5e9);
  });
});
