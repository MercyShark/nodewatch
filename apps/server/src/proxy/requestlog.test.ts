import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RequestLog } from "./requestlog.js";

describe("RequestLog", () => {
  it("appends one JSON line per request with the node name, and rotates by size", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "nw-rl-"));
    const log = new RequestLog(dir, "node-1", 400);
    log.append([{ ts: 1, method: "arkiv_query", ms: 12.3, ok: true, code: null, error: null, shape: "s_1", query: "kind = str('x')" }]);
    const lines = readFileSync(log.file, "utf8").trim().split("\n");
    expect(JSON.parse(lines[0]!)).toEqual({ ts: 1, method: "arkiv_query", ms: 12.3, ok: true, code: null, error: null, shape: "s_1", query: "kind = str('x')", node: "node-1" });
    for (let i = 0; i < 6; i++) log.append([{ ts: i, method: "eth_blockNumber", ms: 1, ok: false, code: -32603, error: "x".repeat(40), shape: null, query: "[]" }]);
    expect(existsSync(log.file + ".1")).toBe(true);
    expect(readFileSync(log.file, "utf8").length).toBeLessThan(400);
    expect(readFileSync(log.file + ".1", "utf8").length).toBeGreaterThan(0);
  });
});
