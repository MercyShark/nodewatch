// Slow-query finder runner. Only runs when triggered via the API, one run at a time. Each shape ×
// size is timed BENCH_RUNS_PER_SHAPE times (first BENCH_WARMUP_RUNS discarded) against the guarded
// target. Pauses automatically when the node's head lag grows or host CPU > 85 %.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BenchResult, BenchRun, Bundle } from "@nodewatch/shared";
import { addressOf } from "../arkiv/client.js";
import type { Ctx } from "../context.js";
import { errMsg, jsonRpc } from "../util/http.js";
import { atRestKey, openAtRest, sealAtRest } from "../swarm/ecies.js";
import { getRecipient } from "../swarm/recipients.js";
import type { Vault } from "../swarm/vault.js";
import { percentiles, scaling } from "./analyze.js";
import { seed } from "./dataset.js";
import { assertBenchTarget } from "./guard.js";
import { withSandbox } from "./sandbox.js";
import { BENCH_SHAPES, idOf, MARKETPLACE_SHAPES, type Shape, type ShapeParams } from "./shapes.js";

const DEFAULT_SIZES = [500, 1000, 2500, 5000];
const PAUSE_POLL_MS = 5000;
const MAX_PAUSE_MS = 15 * 60_000;

interface RunRow {
  id: string;
  status: BenchRun["status"];
  target: BenchRun["target"];
  sizes: string;
  started_at: number;
  finished_at: number | null;
  progress: number;
  message: string | null;
  scaling: string;
}
interface ResultRow {
  run_id: string;
  shape_id: string;
  shape_text_enc: string;
  size: number;
  p50: number;
  p95: number;
  p99: number;
  rows: number;
  errors: number;
  bytes: number;
}

export class Bench {
  private active: string | null = null;
  private readonly key: Buffer;

  constructor(
    private readonly ctx: Ctx,
    private readonly vault: Vault,
  ) {
    this.key = atRestKey(ctx.cfg);
    ctx.db
      .prepare("UPDATE bench_runs SET status = 'failed', message = 'interrupted by a restart', finished_at = ? WHERE status IN ('queued','seeding','running','paused')")
      .run(Date.now());
  }

  private toRun(r: RunRow, admin: boolean): BenchRun {
    const rows = this.ctx.db.prepare("SELECT * FROM bench_results WHERE run_id = ? ORDER BY shape_id, size").all(r.id) as ResultRow[];
    const results: BenchResult[] = rows.map((x) => ({
      shapeId: x.shape_id,
      shapeText: admin ? this.open(x.shape_text_enc) : null,
      size: x.size,
      p50Ms: x.p50,
      p95Ms: x.p95,
      p99Ms: x.p99,
      rows: x.rows,
      errors: x.errors,
    }));
    return {
      id: r.id,
      status: r.status,
      target: r.target,
      sizes: JSON.parse(r.sizes) as number[],
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      progress: r.progress,
      message: r.message,
      results,
      scaling: JSON.parse(r.scaling) as BenchRun["scaling"],
    };
  }

  private open(enc: string): string | null {
    try {
      return openAtRest(enc, this.key);
    } catch {
      return null;
    }
  }

  list(admin: boolean): BenchRun[] {
    const rows = this.ctx.db.prepare("SELECT * FROM bench_runs ORDER BY started_at DESC LIMIT 50").all() as RunRow[];
    return rows.map((r) => this.toRun(r, admin));
  }

  get(id: string, admin: boolean): BenchRun | null {
    const r = this.ctx.db.prepare("SELECT * FROM bench_runs WHERE id = ?").get(id) as RunRow | undefined;
    return r ? this.toRun(r, admin) : null;
  }

  private update(id: string, patch: Partial<Pick<RunRow, "status" | "progress" | "message" | "finished_at" | "scaling" | "sizes">>): void {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    this.ctx.db.prepare(`UPDATE bench_runs SET ${cols.map((c) => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...patch, id });
  }

  start(input: { target: "own-node" | "sandbox"; sizes?: number[] }): BenchRun {
    if (this.active) throw new Error(`a benchmark is already running (${this.active})`);
    const target = input.target === "sandbox" ? "sandbox" : "own-node";
    const sizes = (input.sizes?.length ? input.sizes : DEFAULT_SIZES)
      .map((n) => Math.floor(Number(n)))
      .filter((n) => Number.isFinite(n) && n > 0 && n <= 50_000)
      .sort((a, b) => a - b)
      .slice(0, 8);
    if (!sizes.length) throw new Error("sizes must be positive integers ≤ 50000");
    const id = randomUUID();
    this.ctx.db
      .prepare("INSERT INTO bench_runs(id, status, target, sizes, started_at, progress, message, scaling) VALUES (?, 'queued', ?, ?, ?, 0, NULL, '[]')")
      .run(id, target, JSON.stringify(sizes), Date.now());
    this.active = id;
    void this.execute(id, target, sizes).finally(() => {
      this.active = null;
    });
    return this.get(id, true)!;
  }

  private async execute(id: string, target: BenchRun["target"], sizes: number[]): Promise<void> {
    try {
      if (target === "sandbox") await withSandbox(this.ctx, (url, chainId) => this.runOn(id, url, chainId, sizes));
      else await this.runOn(id, this.ctx.cfg.EL_RPC_URL, this.ctx.cfg.ARKIV_CHAIN_ID, sizes);
    } catch (err) {
      this.update(id, { status: "failed", message: errMsg(err).slice(0, 500), finished_at: Date.now() });
      this.ctx.log.warn({ run: id, err: errMsg(err) }, "bench run failed");
    }
  }

  /** Wait while the node is unhealthy. Throws if it stays unhealthy for 15 minutes. */
  private async healthGate(id: string, baselineLag: number): Promise<void> {
    const started = Date.now();
    let paused = false;
    for (;;) {
      const lag = this.ctx.state.kpis?.headLag ?? null;
      const cpu = this.ctx.state.host?.cpuPct ?? null;
      const lagBad = lag !== null && lag > Math.max(10, baselineLag + 5);
      const cpuBad = cpu !== null && cpu > 85;
      if (!lagBad && !cpuBad) {
        if (paused) this.update(id, { status: "running", message: "resumed: node healthy again" });
        return;
      }
      if (!paused) {
        paused = true;
        this.update(id, { status: "paused", message: lagBad ? `paused: head lag ${lag} blocks` : `paused: host CPU ${cpu?.toFixed(0)} %` });
      }
      if (Date.now() - started > MAX_PAUSE_MS) throw new Error("node stayed unhealthy for 15 minutes; run aborted");
      await new Promise((r) => setTimeout(r, PAUSE_POLL_MS));
    }
  }

  private async timedQuery(url: string, query: string, select: "keys" | "bytes", limit: number, offset?: number) {
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "arkiv_query",
      params: [
        query,
        {
          select: select === "keys" ? { key: true } : { key: true, owner: true, creator: true, expiresAt: true, attributes: true },
          limit: `0x${limit.toString(16)}`,
          ...(offset ? { offset: `0x${offset.toString(16)}` } : {}),
        },
      ],
    });
    const t0 = performance.now();
    const res = await fetch(assertBenchTarget(this.ctx.cfg, url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    const ms = performance.now() - t0;
    let rows = 0;
    let error = !res.ok;
    try {
      const j = JSON.parse(text) as { result?: { data?: unknown[] }; error?: unknown };
      if (j.error) error = true;
      rows = j.result?.data?.length ?? 0;
    } catch {
      error = true;
    }
    return { ms, rows, bytes: Buffer.byteLength(text), error };
  }

  private async countMarketplace(url: string): Promise<number> {
    const r = await jsonRpc<{ count?: string }>(
      assertBenchTarget(this.ctx.cfg, url),
      "arkiv_query",
      [`$creator = addr(${this.ctx.cfg.LB_ADDRESS})`, { select: { key: true, count: true }, limit: "0x1" }],
      15_000,
    );
    return r.count ? Number(BigInt(r.count)) : 0;
  }

  private async runOn(id: string, url: string, chainId: number, requested: number[]): Promise<void> {
    const cfg = this.ctx.cfg;
    assertBenchTarget(cfg, url);
    const key = cfg.BENCH_PRIVATE_KEY;
    const runTag = `r${id.slice(0, 8)}`;
    const benchAddr = addressOf(key) ?? "0x0000000000000000000000000000000000000000";
    let shapes: Shape[];
    let sizes = requested;
    if (!key) {
      shapes = MARKETPLACE_SHAPES;
      sizes = [await this.countMarketplace(url)];
      this.update(id, {
        sizes: JSON.stringify(sizes),
        message: "No BENCH_PRIVATE_KEY (or HEARTBEAT_PRIVATE_KEY): no dataset seeded; read-only shapes over existing marketplace entities.",
      });
    } else {
      shapes = BENCH_SHAPES;
    }
    const baselineLag = this.ctx.state.kpis?.headLag ?? 0;
    const runs = Math.max(2, cfg.BENCH_RUNS_PER_SHAPE);
    const warm = Math.min(runs - 1, Math.max(0, cfg.BENCH_WARMUP_RUNS));
    const total = sizes.length * shapes.length;
    let done = 0;
    let seeded = 0;
    const findings: Record<string, unknown>[] = [];

    for (const size of sizes) {
      if (key && size > seeded) {
        this.update(id, { status: "seeding", message: `seeding ${size} items` });
        await this.healthGate(id, baselineLag);
        seeded += await seed(cfg, url, chainId, key, runTag, seeded, size);
      }
      this.update(id, { status: "running", message: `measuring at size ${size}` });
      const params: ShapeParams = { size, runTag, bench: benchAddr, lb: cfg.LB_ADDRESS };
      for (const shape of shapes) {
        await this.healthGate(id, baselineLag);
        const r = shape.render(params);
        const sid = idOf(shape, r);
        const lat: number[] = [];
        let rows = 0,
          errors = 0,
          bytes = 0;
        for (let i = 0; i < runs; i++) {
          let m;
          try {
            m = await this.timedQuery(url, r.query, r.select, r.limit, r.offset);
          } catch {
            m = { ms: 30_000, rows: 0, bytes: 0, error: true };
          }
          if (i < warm) continue;
          lat.push(m.ms);
          rows = m.rows;
          bytes = Math.max(bytes, m.bytes);
          if (m.error) errors++;
        }
        const p = percentiles(lat);
        const text = `${r.query}${r.offset ? ` OFFSET ${r.offset}` : ""} [select=${r.select} limit=${r.limit}]`;
        this.ctx.db
          .prepare(
            `INSERT OR REPLACE INTO bench_results(run_id, shape_id, shape_text_enc, size, p50, p95, p99, rows, errors, bytes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(id, sid, sealAtRest(text, this.key), size, p.p50, p.p95, p.p99, rows, errors, bytes);
        findings.push({ shapeId: sid, name: shape.name, label: shape.label, family: shape.family, paging: shape.paging ?? null, text, size, ...p, rows, errors, bytes });
        done++;
        this.update(id, { progress: Math.round((done / total) * 1000) / 1000 });
      }
    }
    const results = this.ctx.db.prepare("SELECT shape_id, size, p95 FROM bench_results WHERE run_id = ?").all(id) as { shape_id: string; size: number; p95: number }[];
    const sc = scaling(results.map((x) => ({ shapeId: x.shape_id, size: x.size, p95Ms: x.p95 })));
    this.writeFindings(id, sizes, findings, sc);
    const slow = sc.filter((s) => s.slow).length;
    this.update(id, {
      status: "done",
      progress: 1,
      finished_at: Date.now(),
      scaling: JSON.stringify(sc),
      message: `${slow} slow shape${slow === 1 ? "" : "s"} of ${sc.length}${key ? "" : " (read-only marketplace shapes)"}`,
    });
  }

  private findingsPath(id: string): string {
    return path.join(this.ctx.cfg.findingsDir, `${id}.json`);
  }

  private writeFindings(id: string, sizes: number[], results: Record<string, unknown>[], sc: { shapeId: string; k: number; slow: boolean }[]): void {
    mkdirSync(this.ctx.cfg.findingsDir, { recursive: true, mode: 0o700 });
    const paging = results.filter((r) => r.paging);
    writeFileSync(
      this.findingsPath(id),
      JSON.stringify({ runId: id, createdAt: Date.now(), agent: this.ctx.cfg.AGENT_VERSION, sizes, scaling: sc, paging, results }, null, 2),
      { mode: 0o600 },
    );
  }

  /** Encrypt the run's findings to the Arkiv recipient (+ operator) and upload through the vault. */
  async sendToArkiv(id: string): Promise<Bundle> {
    const run = this.get(id, true);
    if (!run) throw new Error("no such run");
    if (run.status !== "done") throw new Error("the run has not finished");
    let findings: unknown;
    try {
      findings = JSON.parse(readFileSync(this.findingsPath(id), "utf8"));
    } catch {
      findings = { runId: id, sizes: run.sizes, scaling: run.scaling, results: run.results };
    }
    const recipients = [this.ctx.cfg.ARKIV_RECIPIENT_ADDRESS, this.ctx.cfg.OPERATOR_RECIPIENT_ADDRESS]
      .filter((a): a is string => !!a && !!getRecipient(this.ctx.db, a))
      .map((a) => a.toLowerCase());
    return this.vault.createBundle({ kind: "findings", findings, ...(recipients.length ? { recipients: [...new Set(recipients)] } : {}) });
  }

  csv(id: string): string | null {
    const run = this.get(id, true);
    if (!run) return null;
    const esc = (s: unknown) => `"${String(s ?? "").replaceAll('"', '""')}"`;
    const lines = ["shape_id,size,p50_ms,p95_ms,p99_ms,rows,errors,k,slow,shape_text"];
    for (const r of run.results) {
      const s = run.scaling.find((x) => x.shapeId === r.shapeId);
      lines.push([r.shapeId, r.size, r.p50Ms, r.p95Ms, r.p99Ms, r.rows, r.errors, s?.k ?? "", s?.slow ?? "", esc(r.shapeText)].join(","));
    }
    return lines.join("\n") + "\n";
  }
}
