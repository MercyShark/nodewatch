// Roles and CSRF. admin can do everything; viewer gets a read-only dashboard.
import type { Role, SessionUser } from "@nodewatch/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { COOKIE, type Sessions } from "./session.js";

declare module "fastify" {
  interface FastifyRequest {
    user: (SessionUser & { sid?: string }) | null;
  }
}

/** Every mutating /api request must carry `x-requested-with: nodewatch` (a cross-site form or a
 * simple request cannot set it without a CORS preflight, which we never grant). */
export const CSRF_HEADER_VALUE = "nodewatch";

const RANK: Record<Role, number> = { viewer: 1, admin: 2 };

export function requireRole(role: Role) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    if (RANK[req.user.role] < RANK[role]) return reply.code(403).send({ error: `requires ${role}` });
  };
}

export const isAdmin = (req: FastifyRequest) => req.user?.role === "admin";

const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;

/** CSRF: mutating requests from a browser must come from our own origin. */
export function originAllowed(cfg: Config, origin: string | undefined, host: string | undefined, secFetchSite: string | undefined): boolean {
  if (secFetchSite === "cross-site") return false;
  if (!origin) return true; // non-browser clients (curl, scripts) send no Origin
  if (origin === "null") return false;
  if (origin === new URL(cfg.PUBLIC_ORIGIN).origin) return true;
  try {
    if (host && new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return LOOPBACK_ORIGIN.test(origin);
}

export function registerAuthHooks(app: FastifyInstance, cfg: Config, sessions: Sessions): void {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/api/")) return;
    if (cfg.AUTH_DEV_BYPASS) {
      req.user = { id: "dev", role: "admin", address: null, method: "password" };
    } else {
      req.user = await sessions.read(req.cookies[COOKIE]);
    }
    const m = req.method.toUpperCase();
    if (m !== "GET" && m !== "HEAD" && m !== "OPTIONS") {
      const h = req.headers;
      if (h["x-requested-with"] !== CSRF_HEADER_VALUE) {
        return reply.code(403).send({ error: "missing x-requested-with: nodewatch header", message: "missing x-requested-with: nodewatch header" });
      }
      if (!originAllowed(cfg, h.origin, h.host, h["sec-fetch-site"] as string | undefined)) {
        return reply.code(403).send({ error: "cross-site request refused" });
      }
    }
  });
}
