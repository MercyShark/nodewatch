// Fastify app: cookies, rate limits, auth hooks, /api routes, /metrics, and the React app (SPA fallback).
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import { existsSync } from "node:fs";
import path from "node:path";
import { registerAuthHooks } from "./auth/rbac.js";
import type { Ctx } from "./context.js";
import { adminRoutes } from "./routes/admin.js";
import { authRoutes } from "./routes/auth.js";
import { dataRoutes } from "./routes/data.js";
import { streamRoutes } from "./routes/stream.js";
import type { Services } from "./services.js";

export async function buildApp(ctx: Ctx, svc: Services): Promise<FastifyInstance> {
  const app = Fastify({
    // warn level: no per-request access logs
    loggerInstance: ctx.log.child({ mod: "http" }, { level: "warn" }) as unknown as FastifyBaseLogger,
    trustProxy: ctx.cfg.TRUST_PROXY,
    bodyLimit: 1024 * 1024,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  registerAuthHooks(app, ctx.cfg, svc.sessions);

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    if (req.url.startsWith("/api/")) reply.header("cache-control", "no-store");
    else reply.header("x-frame-options", "DENY");
    // Error bodies carry both `error` and `message` (the UI reads either).
    if (reply.statusCode >= 400 && typeof payload === "string" && payload.startsWith("{")) {
      try {
        const body = JSON.parse(payload) as Record<string, unknown>;
        if (typeof body.error === "string" && body.message === undefined) return JSON.stringify({ ...body, message: body.error });
      } catch {
        /* not JSON */
      }
    }
    return payload;
  });

  authRoutes(app, ctx, svc);
  dataRoutes(app, ctx, svc);
  adminRoutes(app, ctx, svc);
  streamRoutes(app, ctx);

  const dist = ctx.cfg.WEB_DIST;
  const hasWeb = existsSync(path.join(dist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: dist, prefix: "/", wildcard: false, index: ["index.html"] });
  }
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/") || req.url === "/metrics" || req.method !== "GET") {
      return reply.code(404).send({ error: "not found" });
    }
    if (!hasWeb) return reply.code(404).type("text/plain").send(`Web UI not built (expected ${dist}/index.html). The API is at /api.`);
    return reply.type("text/html").sendFile("index.html");
  });
  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (code >= 500) ctx.log.error({ err: err.message }, "request failed");
    reply.code(code).send({ error: code >= 500 ? "internal error" : err.message });
  });
  return app;
}
