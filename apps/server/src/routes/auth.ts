import type { FastifyInstance } from "fastify";
import { getAddress, isAddress } from "viem";
import { z } from "zod";
import type { Ctx } from "../context.js";
import { verifyPassword } from "../auth/password.js";
import { COOKIE } from "../auth/session.js";
import { allowedDomain, buildMessage, issueNonce, SIWE_STATEMENT, SiweError, verifySiwe } from "../auth/siwe.js";
import type { Services } from "../services.js";

const loginLimit = { rateLimit: { max: 5, timeWindow: "1 minute" } };

export function authRoutes(app: FastifyInstance, ctx: Ctx, svc: Services): void {
  const { cfg, db } = ctx;

  app.post("/api/auth/siwe/nonce", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (req) => {
    const body = z.object({ address: z.string().optional() }).safeParse(req.body ?? {});
    let originHost: string | undefined;
    try {
      originHost = req.headers.origin ? new URL(req.headers.origin).host : undefined;
    } catch {
      originHost = undefined;
    }
    const host = originHost ?? (req.headers["x-forwarded-host"] && cfg.TRUST_PROXY ? String(req.headers["x-forwarded-host"]) : req.headers.host);
    const domain = allowedDomain(cfg, host);
    const nonce = issueNonce(db, domain);
    const address = body.success ? body.data.address : undefined;
    const scheme = /^(localhost|127\.)/.test(domain) ? "http" : new URL(cfg.PUBLIC_ORIGIN).protocol.replace(":", "");
    return {
      nonce,
      domain,
      uri: `${scheme}://${domain}`,
      chainId: cfg.ARKIV_CHAIN_ID,
      statement: SIWE_STATEMENT,
      version: "1",
      message: address && isAddress(address) ? buildMessage(cfg, domain, nonce, getAddress(address)) : null,
    };
  });

  app.post("/api/auth/siwe/verify", { config: loginLimit }, async (req, reply) => {
    const body = z.object({ message: z.string().max(4096), signature: z.string().max(1000) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "message and signature are required" });
    try {
      const { address, role } = await verifySiwe(cfg, db, body.data.message, body.data.signature);
      const { cookie, user } = await svc.sessions.create({ role, address, method: "siwe" });
      reply.setCookie(COOKIE, cookie, svc.sessions.cookieOptions());
      return user;
    } catch (err) {
      if (err instanceof SiweError) return reply.code(err.status).send({ error: err.message, message: err.message });
      ctx.log.warn({ err: (err as Error).message }, "siwe verify failed");
      return reply.code(401).send({ error: "sign-in failed" });
    }
  });

  app.post("/api/auth/password", { config: loginLimit }, async (req, reply) => {
    const body = z.object({ password: z.string().min(1).max(1024) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "password is required" });
    if (!cfg.ADMIN_PASSWORD_HASH) return reply.code(404).send({ error: "password login is not configured" });
    if (!(await verifyPassword(cfg.ADMIN_PASSWORD_HASH, body.data.password))) return reply.code(401).send({ error: "wrong password" });
    const { cookie, user } = await svc.sessions.create({ role: "admin", address: null, method: "password" });
    reply.setCookie(COOKIE, cookie, svc.sessions.cookieOptions());
    return user;
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.user?.sid) svc.sessions.revoke(req.user.sid);
    reply.clearCookie(COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated", methods: { siwe: true, password: !!cfg.ADMIN_PASSWORD_HASH } });
    const { sid: _sid, ...user } = req.user;
    return user;
  });
}
