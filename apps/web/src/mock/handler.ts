// Mock transport for the API client. Loaded only when VITE_MOCK === "1".
import type { Bundle, Range, SessionUser } from "@nodewatch/shared";
import type { ApiInit } from "../lib/api";
import * as fx from "./fixtures";
import { mockStore } from "./state";

const json = (data: unknown, status = 200) =>
  new Response(data === undefined ? "" : JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
const err = (status: number, message: string) => json({ error: message }, status);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ADMIN_ADDR = "0x7a3B9e2C4d5F6a7B8c9D0e1F2a3B4c5D6e7F8a9B";
let nonceCounter = 0;

function me(): SessionUser {
  const { role } = mockStore.get();
  return { id: `u-${role}`, role, address: role === "admin" ? ADMIN_ADDR : "0x3f1C2d3E4f5A6b7C8d9E0f1A2b3C4d5E6f7A8b9C", method: "siwe" };
}

export async function mockFetch(path: string, init: ApiInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const url = new URL(path, "http://mock");
  const p = url.pathname;
  const range = (url.searchParams.get("range") ?? "6h") as Range;
  const body = (init.body ?? {}) as Record<string, unknown>;
  const state = mockStore.get();
  await delay(p === "/stream" ? 0 : 160 + Math.random() * 260);

  // ---- auth (public) ----
  if (p === "/auth/siwe/nonce" && method === "POST") return json({ nonce: `mock${Date.now().toString(36)}${nonceCounter++}` });
  if (p === "/auth/siwe/verify" && method === "POST") {
    if (typeof body.message !== "string" || typeof body.signature !== "string") return err(400, "message and signature are required");
    mockStore.set((s) => ({ ...s, loggedIn: true }));
    return json(me());
  }
  if (p === "/auth/password" && method === "POST") {
    if (body.username !== "admin" || body.password !== "nodewatch")
      return err(401, "Wrong username or password. (Mock mode: admin / nodewatch.)");
    mockStore.set((s) => ({ ...s, loggedIn: true, role: "admin" }));
    return json({ ...me(), method: "password", address: null });
  }
  if (p === "/auth/logout" && method === "POST") {
    mockStore.set((s) => ({ ...s, loggedIn: false }));
    return json({ ok: true });
  }
  if (!state.loggedIn) return err(401, "Not signed in");
  if (p === "/auth/me") return json(me());

  const admin = state.role === "admin";
  const needAdmin = () => err(403, "Admin role required");

  // ---- viewer routes ----
  if (p === "/overview") return json(fx.overview());
  if (p === "/resources") return json(fx.resources(range));
  if (p === "/disk/forecast") return json(fx.diskForecast());
  if (p === "/chain") return json(fx.chain(range));
  if (p === "/pool") return json(fx.pool());
  if (p === "/rpc") return json(fx.rpc(range));
  if (p === "/fleet") return json(fx.fleet());
  if (p === "/alerts" && method === "GET") return json(fx.alerts());

  // ---- alerts (admin actions) ----
  const testMatch = p.match(/^\/alerts\/test\/(telegram|pagerduty)$/);
  if (testMatch && method === "POST") {
    if (!admin) return needAdmin();
    await delay(700);
    fx.channelSends[testMatch[1]!] = Date.now();
    return json({ ok: true });
  }
  if (p === "/alerts/silences" && method === "POST") {
    if (!admin) return needAdmin();
    const minutes = Number(body.minutes ?? 60);
    const s = { id: `sil-${Date.now()}`, rule: (body.rule as string | null) ?? null, until: Date.now() + minutes * 60_000, createdBy: ADMIN_ADDR };
    fx.silences.unshift(s);
    return json(s, 201);
  }
  const silMatch = p.match(/^\/alerts\/silences\/(.+)$/);
  if (silMatch && method === "DELETE") {
    if (!admin) return needAdmin();
    const i = fx.silences.findIndex((s) => s.id === decodeURIComponent(silMatch[1]!));
    if (i >= 0) fx.silences.splice(i, 1);
    return json({ ok: true });
  }

  // ---- autopilot ----
  if (p === "/autopilot" && method === "GET") {
    if (!admin) return needAdmin();
    return json(fx.autopilot());
  }
  if (p === "/autopilot" && method === "PUT") {
    if (!admin) return needAdmin();
    if (typeof body.enabled === "boolean") fx.autopilotSet({ enabled: body.enabled });
    if (body.label !== undefined) fx.autopilotSet({ label: (body.label as string | null)?.trim() || null });
    return json(fx.autopilot());
  }
  if (p === "/autopilot/unlock" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(600);
    if (body.password !== "nodewatch") return err(401, "wrong keystore password");
    fx.autopilotSet({ keyUnlocked: true });
    return json(fx.autopilot());
  }
  if (p === "/autopilot/lock" && method === "POST") {
    fx.autopilotSet({ keyUnlocked: false });
    return json(fx.autopilot());
  }
  if (p === "/autopilot/run" && method === "POST") {
    await delay(800);
    return json(fx.autopilot());
  }

  // ---- self-update ----
  if (p === "/update" && method === "GET") return admin ? json(fx.updateState()) : needAdmin();
  if (p === "/update/check" && method === "POST") {
    await delay(700);
    return admin ? json(fx.updateState()) : needAdmin();
  }
  if (p === "/update" && method === "POST") return admin ? json({ message: "Update started (mock)." }) : needAdmin();

  // ---- one-click fixes, cleanup, profile ----
  if (p === "/fix" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(900);
    const v = fx.verdict();
    if (body.code !== v.code) return err(409, `the verdict changed to "${v.code}" since the page loaded; nothing was done`);
    if (!v.action) return err(409, `"${v.code}" has no one-click fix; use the command shown`);
    const msg = v.action.kind === "restart_service" ? `restarted the ${v.action.service} container` : "ran one autopilot pass: offer posted";
    return json({ message: msg, action: v.action });
  }
  if (p === "/disk/cleanup" && method === "GET") {
    if (!admin) return needAdmin();
    return json(fx.cleanupPreview());
  }
  if (p === "/disk/cleanup" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(1200);
    return json(fx.cleanupRun((body.items as ("build_cache" | "dangling_images")[]) ?? []));
  }
  if (p === "/profile" && method === "GET") {
    if (!admin) return needAdmin();
    return json(fx.profileState());
  }
  if (p === "/profile" && method === "PUT") {
    if (!admin) return needAdmin();
    const e = fx.profileSave(body as { name: string; country: string; contact: string });
    return e ? err(400, e) : json(fx.profileState());
  }
  if (p === "/profile/publish" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(1500);
    const r = fx.profilePublish();
    return "error" in r ? err(409, r.error) : json({ ...r, state: fx.profileState() });
  }

  // ---- bench ----
  // Real server: admin only. The mock also lets viewers read runs (shapeText null) to preview the public view.
  if (p === "/bench/runs" && method === "GET") return json(fx.benchRuns.map((r) => fx.benchRun(r, admin, true)));
  if (p === "/bench/catalog" && method === "GET") return json(fx.benchCatalog(admin));
  if (p === "/bench/writer" && method === "GET")
    return json({ address: "0xfD0c7af6EF04A7ee21935CbE5B98b654B119b10d", balanceWei: "1500000000000000000", minWei: "50000000000000000", problem: null });
  if (p === "/bench/runs" && method === "POST") {
    if (!admin) return needAdmin();
    if (fx.benchRuns.some((r) => Date.now() - r.startedAt < r.durationMs)) return err(409, "A run is already in progress.");
    const run = {
      id: `run-${String(fx.benchRuns.length + 2).padStart(4, "0")}`,
      target: (body.target as "sandbox" | "readonly" | "own-node") ?? "own-node",
      sizes: Array.isArray(body.sizes) ? (body.sizes as number[]) : [500, 1000, 2500, 5000],
      startedAt: Date.now(),
      durationMs: 45_000,
    };
    fx.benchRuns.unshift(run);
    return json(fx.benchRun(run, true), 201);
  }
  const runMatch = p.match(/^\/bench\/runs\/([^/]+)$/);
  if (runMatch && method === "GET") {
    const r = fx.benchRuns.find((x) => x.id === decodeURIComponent(runMatch[1]!));
    return r ? json(fx.benchRun(r, admin)) : err(404, "Run not found");
  }

  // ---- vault ----
  if (p === "/vault/bundles" && method === "GET") {
    if (!admin) return needAdmin();
    return json({
      beeConfigured: true,
      beeMode: "external",
      postageBatchId: fx.mockHex("postage").slice(2),
      recipients: fx.recipients,
      bundles: fx.bundles,
    });
  }
  if (p === "/vault/bundles" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(1200);
    const kind = (body.kind as Bundle["kind"]) ?? "diagnostic";
    const rec = Array.isArray(body.recipients) ? (body.recipients as string[]) : [];
    const id = `bd-${String(fx.bundles.length + 3).padStart(4, "0")}`;
    const b: Bundle = {
      id,
      kind,
      scheme: kind === "sample" ? "none" : "ecies-secp256k1-v1",
      recipient: kind === "sample" ? null : (rec[0] ?? null),
      swarmRef: fx.mockHex(`swarm-${id}`).slice(2),
      entityKey: fx.mockHex(`entity-${id}`),
      sha256: fx.mockHex(`sha-${id}`).slice(2),
      sizeBytes: 120_000 + Math.round(Math.random() * 400_000),
      createdAt: Date.now(),
      status: "uploaded",
      error: null,
    };
    fx.bundles.unshift(b);
    return json(b, 201);
  }
  if (p === "/vault/recipients" && method === "POST") {
    if (!admin) return needAdmin();
    const address = String(body.address ?? "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return err(400, "Invalid address");
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(body.signature ?? ""))) return err(400, "Signature must be a 65-byte hex string");
    const r = { address, label: String(body.label ?? "Recipient"), addedAt: Date.now() };
    fx.recipients.unshift(r);
    return json(r, 201);
  }

  // ---- backups ----
  if (p === "/backups" && method === "GET") {
    if (!admin) return needAdmin();
    return json(fx.backups());
  }
  if (p === "/backups/run" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(1500);
    const now = Date.now();
    fx.backupItems.unshift({
      id: `bk-${now}`,
      target: "local",
      kind: "keys-config",
      location: `/srv/nodewatch/backups/keys-config/${new Date(now).toISOString().slice(0, 16).replace(":", "-")}Z.enc`,
      sha256: fx.mockHex(`bk-${now}`).slice(2),
      sizeBytes: 14_400,
      ok: true,
      error: null,
      createdAt: now,
    });
    return json({ ok: true });
  }
  if (p === "/backups/test-restore" && method === "POST") {
    if (!admin) return needAdmin();
    await delay(1800);
    return json({ ok: true, message: "Decrypted to a temp dir; SHA-256 matches; keystore JSON parses." });
  }

  return err(404, `Mock: no handler for ${method} ${p}`);
}
