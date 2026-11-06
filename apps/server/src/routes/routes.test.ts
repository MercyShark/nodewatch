import { describe, expect, it } from "vitest";
import { Analyzer } from "../analyzer/index.js";
import { AlertEngine } from "../alerts/engine.js";
import { FleetReader } from "../arkiv/fleet.js";
import { HeartbeatWriter } from "../arkiv/heartbeat.js";
import { hashPassword } from "../auth/password.js";
import { Sessions } from "../auth/session.js";
import { Backups } from "../backup/index.js";
import { Actions } from "../actions/index.js";
import { ProfileService } from "../arkiv/profile.js";
import { Autopilot } from "../autopilot/index.js";
import { Updater } from "../update/index.js";
import { Bench } from "../bench/runner.js";
import { InlineMode } from "../proxy/inline.js";
import { LiveQueries, SLOW_MS } from "../proxy/live.js";
import { RpcStats } from "../proxy/rpcProxy.js";
import { buildApp } from "../server.js";
import { Vault } from "../swarm/vault.js";
import { testCtx } from "../test/helpers.js";

async function app(env: Record<string, string> = {}) {
  const ctx = testCtx({ EL_RPC_URL: "http://127.0.0.1:9", ...env });
  const vault = new Vault(ctx);
  const autopilot = new Autopilot(ctx);
  const actions = new Actions(ctx, autopilot);
  const svc = {
    sessions: new Sessions(ctx.db, "s".repeat(40), false),
    analyzer: new Analyzer(ctx, () => 0, () => null),
    alerts: new AlertEngine(ctx, () => ({ requests: 0, errors: 0, p95Ms: null }), { notifiers: [] }),
    rpcStats: new RpcStats(),
    live: new LiveQueries(ctx, SLOW_MS),
    inline: new InlineMode(ctx, { start: async () => undefined, stop: () => undefined, address: () => null }, () => undefined),
    fleet: new FleetReader(ctx, null),
    heartbeat: new HeartbeatWriter(ctx),
    vault,
    backups: new Backups(ctx, vault),
    bench: new Bench(ctx, vault),
    autopilot,
    actions,
    profile: new ProfileService(ctx, autopilot.unlock),
    updater: new Updater(ctx, actions),
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

    const noHeader = await a.inject({ method: "POST", url: "/api/auth/password", payload: { username: "admin", password: "a-very-long-password" } });
    expect(noHeader.statusCode).toBe(403);
    expect(noHeader.json().message).toBeTruthy();

    const h = { "x-requested-with": "nodewatch" };
    const bad = await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { username: "admin", password: "wrong" } });
    expect(bad.statusCode).toBe(401);
    const badUser = await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { username: "root", password: "a-very-long-password" } });
    expect(badUser.statusCode).toBe(401);
    expect(badUser.json().error).toBe("wrong username or password");
    const ok =await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { username: "admin", password: "a-very-long-password" } });
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

    for (let i = 0; i < 4; i++) await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { username: "admin", password: "x" } });
    expect((await a.inject({ method: "POST", url: "/api/auth/password", headers: h, payload: { username: "admin", password: "x" } })).statusCode).toBe(429);
    await a.close();
  });

  it("refuses own-node bench runs without a dedicated key, and never reuses the heartbeat key", async () => {
    const hbKey = "0x" + "ab".repeat(32);
    const h = { "x-requested-with": "nodewatch" };
    const run = (a: Awaited<ReturnType<typeof app>>, payload: object) =>
      a.inject({ method: "POST", url: "/api/bench/runs", headers: h, payload });

    const noKey = await app({ AUTH_DEV_BYPASS: "true", HEARTBEAT_PRIVATE_KEY: hbKey });
    const r1 = await run(noKey, { target: "own-node" });
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error).toMatch(/BENCH_PRIVATE_KEY/);
    expect((await noKey.inject({ url: "/api/bench/runs" })).json()).toEqual([]); // nothing was started
    await noKey.close();

    const sameKey = await app({ AUTH_DEV_BYPASS: "true", HEARTBEAT_PRIVATE_KEY: hbKey, BENCH_PRIVATE_KEY: hbKey });
    const r2 = await run(sameKey, { target: "own-node" });
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error).toMatch(/heartbeat key/);
    await sameKey.close();

    const ownKey = await app({ AUTH_DEV_BYPASS: "true", HEARTBEAT_PRIVATE_KEY: hbKey, BENCH_PRIVATE_KEY: "0x" + "cd".repeat(32) });
    const r3 = await run(ownKey, { target: "own-node", sizes: [500, 10_000] });
    expect(r3.statusCode).toBe(409);
    expect(r3.json().error).toMatch(/limited to 5000/);
    // A valid request still needs a funded writer: the node is unreachable here, so the balance check refuses.
    const r4 = await run(ownKey, { target: "own-node", sizes: [500, 1000] });
    expect(r4.statusCode).toBe(409);
    expect(r4.json().error).toMatch(/balance/);
    const w = await ownKey.inject({ url: "/api/bench/writer" });
    expect(w.json()).toMatchObject({ address: expect.stringMatching(/^0x[0-9a-fA-F]{40}$/), balanceWei: null, minWei: "50000000000000000" });
    expect(JSON.stringify(w.json())).not.toContain("cd".repeat(32)); // never the key
    expect((await ownKey.inject({ url: "/api/bench/runs" })).json()).toEqual([]);
    await ownKey.close();
  });

  it("serves the shape catalog: every shape with its dataset, templates for admins", async () => {
    const a = await app({ AUTH_DEV_BYPASS: "true" });
    const r = await a.inject({ url: "/api/bench/catalog" });
    expect(r.statusCode).toBe(200);
    const c = r.json();
    expect(c.datasets.map((d: { id: string }) => d.id)).toEqual(["synthetic", "marketplace"]);
    expect(c.shapes.length).toBeGreaterThan(40);
    expect(c.shapes.every((s: { dataset: string; template: string | null }) => ["synthetic", "marketplace"].includes(s.dataset) && s.template)).toBe(true);
    expect(c.thresholds).toEqual({ slowP95Ms: 250, slowK: 1.2 });
    await a.close();
  });

  it("autopilot: admin-only state, toggle + label, unlock refuses a wrong password, viewers get 403", async () => {
    const h = { "x-requested-with": "nodewatch" };
    const a = await app({ AUTH_DEV_BYPASS: "true" });
    const st = await a.inject({ url: "/api/autopilot" });
    expect(st.statusCode).toBe(200);
    expect(st.json()).toMatchObject({ enabled: false, keyUnlocked: false, label: null });
    expect(st.json().keystoreError).toMatch(/cannot read the provider keystore/); // no kit in the test dir
    const put = await a.inject({ method: "PUT", url: "/api/autopilot", headers: h, payload: { enabled: true, label: "  Mumbai node 1  " } });
    expect(put.json()).toMatchObject({ enabled: true, label: "Mumbai node 1" });
    expect(put.json().recent.map((r: { action: string }) => r.action)).toEqual(["toggle", "label"]);
    const bad = await a.inject({ method: "PUT", url: "/api/autopilot", headers: h, payload: { label: "x".repeat(65) } });
    expect(bad.statusCode).toBe(400);
    const unlock = await a.inject({ method: "POST", url: "/api/autopilot/unlock", headers: h, payload: { password: "whatever" } });
    expect(unlock.statusCode).toBe(400); // keystore missing -> not a wrong password, a config error
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

describe("GET /metrics", () => {
  it("answers loopback callers without a token, refuses others, and accepts the bearer token when configured", async () => {
    const a = await app({});
    expect((await a.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(200);
    expect((await a.inject({ method: "GET", url: "/metrics", remoteAddress: "10.0.0.5" })).statusCode).toBe(403);
    const b = await app({ METRICS_TOKEN: "s3cret-scrape-token" });
    expect((await b.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect((await b.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    const ok = await b.inject({ method: "GET", url: "/metrics", remoteAddress: "10.0.0.5", headers: { authorization: "Bearer s3cret-scrape-token" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain("nodewatch_rpc_requests_total");
    expect(ok.body).toContain("nodewatch_rpc_slow_requests_total");
  });
});
