// GET /api/stream: Server-Sent Events (`event: <name>` + JSON data) per the StreamEvent contract.
// GET /api/health (public liveness) and GET /metrics (Prometheus exposition).
import type { StreamEvent } from "@nodewatch/shared";
import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/rbac.js";
import type { Ctx } from "../context.js";
import { registry } from "../metrics.js";
import { stripText } from "../proxy/live.js";

export function streamRoutes(app: FastifyInstance, ctx: Ctx): void {
  let clients = 0;

  app.get("/api/stream", { preHandler: requireRole("viewer") }, (req, reply) => {
    if (clients >= 50) return reply.code(503).send({ error: "too many stream clients" });
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    clients++;
    const admin = req.user?.role === "admin";
    const send = (ev: StreamEvent) => {
      const data = ev.event === "rpc" && !admin ? ev.data.map((r) => stripText(r)) : ev.data;
      res.write(`event: ${ev.event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    res.write("retry: 5000\n\n");
    const s = ctx.state;
    send({ event: "verdict", data: s.verdict });
    if (s.kpis) send({ event: "kpis", data: s.kpis });
    send({ event: "heartbeat", data: s.heartbeat });
    send({ event: "containers", data: s.containers.list });
    ctx.bus.on("stream", send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    const close = () => {
      clearInterval(ping);
      ctx.bus.off("stream", send);
      clients--;
    };
    req.raw.on("close", close);
  });

  app.get("/api/health", async () => ({
    ok: true,
    uptimeSec: Math.round((Date.now() - ctx.state.startedAt) / 1000),
    collectors: Object.fromEntries(
      Object.entries(ctx.state.collectors).map(([k, v]) => [k, { ok: v.lastError === null, lastSuccess: v.lastSuccess }]),
    ),
  }));

  app.get("/metrics", async (_req, reply) => {
    reply.header("content-type", registry.contentType);
    return registry.metrics();
  });
}
