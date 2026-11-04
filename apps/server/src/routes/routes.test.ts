import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer/index.js";
import { AlertEngine } from "../alerts/engine.js";
import { FleetReader } from "../arkiv/fleet.js";
import { HeartbeatWriter } from "../arkiv/heartbeat.js";
import { hashPassword } from "../auth/password.js";
import { Sessions } from "../auth/session.js";
import { Backups } from "../backup/index.js";
import { Bench } from "../bench/runner.js";
import { RpcStats } from "../proxy/rpcProxy.js";
import { buildApp } from "../server.js";
import { Vault } from "../swarm/vault.js";
import { testCtx } from "../test/helpers.js";

async function app(env: Record<string, string> = {}) {
  const ctx = testCtx({ EL_RPC_URL: "http://127.0.0.1:9", ...env });
  const vault = new Vault(ctx);
  const svc = {
    sessions: new Sessions(ctx.db, "s".repeat(40), false),
    analyzer: new Analyzer(ctx, () => 0, () => null),
    alerts: new AlertEngine(ctx, () => ({ requests: 0, errors: 0, p95Ms: null }), { notifiers: [] }),
    rpcStats: new RpcStats(),
    fleet: new FleetReader(ctx, null),
    heartbeat: new HeartbeatWriter(ctx),
    vault,
    backups: new Backups(ctx, vault),
    bench: new Bench(ctx, vault),
  };
  return buildApp(ctx, svc);
}

describe("http api", () => {
  it("requires auth, enforces CSRF header, logs in with a password, and gates admin routes", async () => {
    const hash = await hashPassword("a-very-long-password");
    const a = await app({ ADMIN_PASSWORD_HASH: hash });
    expect((await a.inject({ url: "/api/overview" })).statusCode).toBe(401);
    expect((await a.inject({ url: "/api/auth/me" })).statusCode).toBe(401);
    expect((await a.inject({ url: "/api/health" })).statusCode).toBe(200);

    const noHeader = await a.inject({ method: "POST", url: "/api/auth/password", payload: { password: "a-very-long-password" } });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().message).toBeTruthy();

    const h = { "x-requested-with": "nodewatch" };
    const bad = await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    const ok = await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { password: "a-very-long-password" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ role: "admin", method: "password", address: null });
    const cookie = ok.cookies.find((c) => c.name === "nw_session")!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
    const cookies = { nw_session: cookie.value };

    const me = await a.inject({ url: "/api/auth/me", cookies });
    expect(me.json().role).toBe("admin");
    const ov = await a.inject({ url: "/api/overview", cookies });
    expect(ov.statusCode).toBe(200);
    expect(ov.json()).toHaveProperty("verdict.code");
    expect((await a.inject({ url: "/api/bench/runs", cookies })).statusCode).toBe(200);
    expect((await a.inject({ url: "/api/chain?range=24h", cookies })).json().range).toBe("24h");
    const sil = await a.inject({ method: "POST", url: "/api/alerts/silences", headers: h, cookies, payload: { rule: null, minutes: 5 } });
    expect(sil.statusCode).toBe(201);
    expect((await a.inject({ method: "DELETE", url: `/api/alerts/silences/${sil.json().id}`, headers: h, cookies })).statusCode).toBe(200);
    const tr = await a.inject({ method: "POST", url: "/api/backups/test-restore", headers: h, cookies, payload: {} });
    expect(tr.json()).toHaveProperty("ok");
    expect(tr.json()).toHaveProperty("message");

    await a.inject({ method: "POST", url: "/api/auth/logout", headers: h, cookies });
    expect((await a.inject({ url: "/api/auth/me", cookies })).statusCode).toBe(401);

    for (let i = 0; i < 4; i++) await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { password: "x" } });
    expect((await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { password: "x" } })).statusCode).toBe(429);
    await a.close();
  });

  it("serves 404 JSON for unknown /api paths", async () => {
    const a = await app({ AUTH_DEV_BYPASS: "1" });
    const r = await a.inject({ url: "/api/nope" });
    expect(r.statusCode).toBe(404);
    expect(r.json().message).toBe("not found");
    await a.close();
  });
});
