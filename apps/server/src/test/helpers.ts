import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pino } from "pino";
import { loadConfig } from "../config.js";
import type { Ctx } from "../context.js";
import { openDb } from "../db/index.js";
import { AllowlistedDocker } from "../docker/client.js";
import { Bus, initialState } from "../state.js";
import { Tsdb } from "../tsdb/index.js";

export function testCtx(env: Record<string, string> = {}): Ctx {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nw-test-"));
  const cfg = loadConfig({ DATA_DIR: dir, DOCKER_SOCKET: path.join(dir, "no-docker.sock"), ...env });
  const db = openDb(dir);
  return {
    cfg,
    db,
    tsdb: new Tsdb(db),
    state: initialState(),
    bus: new Bus(),
    docker: new AllowlistedDocker(cfg.DOCKER_SOCKET, cfg.NODE_COMPOSE_PROJECT, cfg.BENCH_SANDBOX_IMAGE),
    log: pino({ level: "silent" }),
  };
}
