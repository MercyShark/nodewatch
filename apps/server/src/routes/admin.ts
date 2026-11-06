// Alerts (viewer read, admin write), slow-query finder, Swarm vault and backups (admin only).
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole } from "../auth/rbac.js";
import type { Ctx } from "../context.js";
import { ActionConflictError } from "../actions/index.js";
import type { Services } from "../services.js";
import { errMsg } from "../util/http.js";

const viewer = { preHandler: requireRole("viewer") };
const admin = { preHandler: requireRole("admin") };

export function adminRoutes(app: FastifyInstance, ctx: Ctx, svc: Services): void {
  // ---- Autopilot (admin) ----
  app.get("/api/autopilot", admin, async () => svc.autopilot.state());
  app.put("/api/autopilot", admin, async (req, reply) => {
    const b = z.object({ enabled: z.boolean().optional(), label: z.string().max(64).nullable().optional() }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { enabled?: boolean, label?: string | null }" });
    if (b.data.label !== undefined) svc.autopilot.setLabel(b.data.label?.trim() || null);
    if (b.data.enabled !== undefined) svc.autopilot.setEnabled(b.data.enabled);
    return svc.autopilot.state();
  });
  // The password is used once to decrypt the keystore in memory; it is never stored or logged.
  app.post("/api/autopilot/unlock", { ...admin, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ password: z.string().min(1).max(1024) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { password }" });
    try {
      const address = svc.autopilot.unlock.unlock(b.data.password);
      ctx.log.info({ address }, "provider key unlocked by the admin (in memory only)");
      return svc.autopilot.state();
    } catch (err) {
      const msg = errMsg(err);
      return reply.code(msg.includes("wrong keystore password") ? 401 : 400).send({ error: msg.includes("wrong keystore password") ? "wrong keystore password" : msg });
    }
  });
  app.post("/api/autopilot/lock", admin, async () => {
    svc.autopilot.unlock.lock();
    return svc.autopilot.state();
  });
  app.post("/api/autopilot/run", { ...admin, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async () => {
    await svc.autopilot.tick();
    return svc.autopilot.state();
  });

  // ---- One-click fixes, disk cleanup (admin) ----
  const actor = (req: { user?: { address: string | null; id?: string } | null }) => req.user?.address ?? req.user?.id ?? "unknown";
  app.post("/api/fix", { ...admin, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ code: z.string().min(1).max(32) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { code }" });
    try {
      return await svc.actions.fix(b.data.code, actor(req));
    } catch (err) {
      return reply.code(err instanceof ActionConflictError ? 409 : 502).send({ error: errMsg(err) });
    }
  });
  app.get("/api/actions", admin, async () => ({ actions: svc.actions.recent() }));
  app.get("/api/disk/cleanup", admin, async () => svc.actions.cleanupPreview());
  app.post("/api/disk/cleanup", { ...admin, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z.object({ items: z.array(z.enum(["build_cache", "dangling_images"])).min(1).max(2) }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { items: ('build_cache' | 'dangling_images')[] }" });
    try {
      return await svc.actions.cleanup(b.data.items, actor(req));
    } catch (err) {
      return reply.code(err instanceof ActionConflictError ? 409 : 502).send({ error: errMsg(err) });
    }
  });

  // ---- Node profile on Arkiv (admin) ----
  app.get("/api/profile", admin, async () => svc.profile.state());
  app.put("/api/profile", admin, async (req, reply) => {
    const b = z.object({ name: z.string().max(200), country: z.string().max(8), contact: z.string().max(400).default("") }).safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { name, country, contact? }" });
    try {
      svc.profile.saveDraft(b.data);
      return svc.profile.state();
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });
  app.post("/api/profile/publish", { ...admin, config: { rateLimit: { max: 3, timeWindow: "1 minute" } } }, async (req, reply) => {
    try {
      const r = await svc.profile.publish();
      svc.actions.log(actor(req), "profile", r.entityKey, true, `published node profile (tx ${r.txHash})`);
      return { ...r, state: await svc.profile.state() };
    } catch (err) {
      svc.actions.log(actor(req), "profile", null, false, errMsg(err));
      return reply.code(409).send({ error: errMsg(err) });
    }
  });

  // ---- Alerts ----
  app.get("/api/alerts", viewer, async () => svc.alerts.response());

  app.post("/api/alerts/test/:channel", { ...admin, config: { rateLimit: { max: 6, timeWindow: "1 minute" } } }, async (req, reply) => {
    const ch = z.enum(["telegram", "pagerduty"]).safeParse((req.params as { channel: string }).channel);
    if (!ch.success) return reply.code(400).send({ error: "channel must be telegram or pagerduty" });
    const r = await svc.alerts.sendTest(ch.data);
    return reply.code(r.ok ? 200 : 502).send(r);
  });

  app.post("/api/alerts/silences", admin, async (req, reply) => {
    const b = z
      .object({ rule: z.string().max(64).nullable().default(null), minutes: z.number().int().min(1).max(7 * 24 * 60) })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "body: { rule: string | null, minutes: 1..10080 }" });
    if (b.data.rule !== null && !svc.alerts.ruleNames().includes(b.data.rule)) return reply.code(400).send({ error: `unknown rule ${b.data.rule}` });
    const who = req.user?.address ?? req.user?.id ?? "unknown";
    return reply.code(201).send(svc.alerts.addSilence(b.data.rule, b.data.minutes, who));
  });

  app.delete("/api/alerts/silences/:id", admin, async (req, reply) => {
    const ok = svc.alerts.removeSilence((req.params as { id: string }).id);
    return ok ? { ok: true } : reply.code(404).send({ error: "no such silence" });
  });

  app.get("/api/alerts/rules", viewer, async () => ({ rules: svc.alerts.ruleNames() }));

  // ---- Slow-query finder (admin) ----
  app.get("/api/bench/runs", admin, async (req) => svc.bench.list(req.user?.role === "admin"));
  app.get("/api/bench/catalog", admin, async (req) => svc.bench.catalog(req.user?.role === "admin"));
  app.get("/api/bench/writer", admin, async () => svc.bench.writer());

  app.post("/api/bench/runs", admin, async (req, reply) => {
    const b = z
      .object({ target: z.enum(["sandbox", "readonly", "own-node"]).default("own-node"), sizes: z.array(z.number().int().min(10).max(50_000)).max(8).optional() })
      .safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { target: 'sandbox' | 'readonly' | 'own-node', sizes?: number[] }" });
    try {
      svc.bench.validate(b.data);
      await svc.bench.preflight(b.data.target);
      return reply.code(202).send(svc.bench.start(b.data));
    } catch (err) {
      return reply.code(409).send({ error: errMsg(err) });
    }
  });

  app.get("/api/bench/runs/:id", admin, async (req, reply) => {
    const r = svc.bench.get((req.params as { id: string }).id, req.user?.role === "admin");
    return r ?? reply.code(404).send({ error: "no such run" });
  });

  app.get("/api/bench/runs/:id/csv", admin, async (req, reply) => {
    const csv = svc.bench.csv((req.params as { id: string }).id);
    if (csv === null) return reply.code(404).send({ error: "no such run" });
    return reply.header("content-type", "text/csv").header("content-disposition", "attachment; filename=bench.csv").send(csv);
  });

  app.post("/api/bench/runs/:id/send", admin, async (req, reply) => {
    try {
      return await svc.bench.sendToArkiv((req.params as { id: string }).id);
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  // ---- Swarm vault (admin) ----
  app.get("/api/vault/bundles", admin, async () => svc.vault.response());
  app.get("/api/vault/recipient-message", viewer, async () => ({ message: svc.vault.recipientMessage() }));

  app.post("/api/vault/bundles", { ...admin, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const b = z
      .object({ kind: z.enum(["diagnostic", "findings", "sample"]).default("diagnostic"), recipients: z.array(z.string().regex(/^0x[0-9a-fA-F]{40}$/)).optional() })
      .safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { kind: 'diagnostic' | 'findings' | 'sample', recipients?: address[] }" });
    try {
      return reply.code(201).send(await svc.vault.createBundle(b.data));
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  app.post("/api/vault/recipients", admin, async (req, reply) => {
    const b = z
      .object({
        label: z.string().min(1).max(64),
        signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
        address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
        message: z.string().max(2048).optional(),
      })
      .safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "body: { label, signature (65-byte hex), address?, message? }" });
    try {
      return reply.code(201).send(await svc.vault.addRecipient(b.data));
    } catch (err) {
      return reply.code(400).send({ error: errMsg(err) });
    }
  });

  // ---- Backups (admin) ----
  app.get("/api/backups", admin, async () => svc.backups.response());

  app.post("/api/backups/run", { ...admin, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (_req, reply) => {
    try {
      return { items: await svc.backups.run() };
    } catch (err) {
      return reply.code(500).send({ error: errMsg(err) });
    }
  });

  app.post("/api/backups/test-restore", admin, async (req, reply) => {
    const b = z
      .object({ id: z.string().max(64).optional(), privateKey: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() })
      .safeParse(req.body ?? {});
    if (!b.success) return reply.code(400).send({ error: "body: { id?, privateKey? }" });
    try {
      const r = await svc.backups.testRestore(b.data.id, b.data.privateKey);
      return { ok: r.ok, message: r.detail, detail: r.detail };
    } catch (err) {
      return reply.code(400).send({ ok: false, message: errMsg(err), detail: errMsg(err) });
    }
  });
}
