import { describe, expect, it } from "vitest";
import { zscoreAnomalies } from "./anomalies.js";
import { computeForecast, linreg, windowAfterReset, type DiskRow } from "./forecast.js";
import { evaluateVerdict, type VerdictInput } from "./verdict.js";

const H = 3600_000;

describe("forecast", () => {
  it("fits a line", () => {
    const f = linreg([{ t: 0, v: 1 }, { t: 1, v: 3 }, { t: 2, v: 5 }])!;
    expect(f.slope).toBeCloseTo(2);
    expect(f.intercept).toBeCloseTo(1);
  });

  it("computes days to full from a 10 GB/day growth", () => {
    const now = 100 * H;
    const rows: DiskRow[] = [];
    for (let i = 72; i >= 0; i--) rows.push({ ts: now - i * 5 * 60_000, used: 100e9 + ((72 - i) * 5 * 60_000 * 10e9) / (24 * H), free: 50e9, total: 1e12 });
    const f = computeForecast(rows, now);
    expect(f.ratePerDay6h).toBeCloseTo(10e9, -6);
    expect(f.daysToFull).toBeCloseTo(5, 1);
    expect(f.projection.length).toBeGreaterThan(2);
  });

  it("resets the window after a >5 GB step", () => {
    const rows: DiskRow[] = [
      { ts: 1, used: 10e9, free: 1, total: 1 },
      { ts: 2, used: 10.1e9, free: 1, total: 1 },
      { ts: 3, used: 30e9, free: 1, total: 1 },
      { ts: 4, used: 30.1e9, free: 1, total: 1 },
    ];
    expect(windowAfterReset(rows, 0).map((r) => r.ts)).toEqual([3, 4]);
  });

  it("returns null without enough data", () => {
    expect(computeForecast([{ ts: 1, used: 1, free: 1, total: 2 }], 2).daysToFull).toBeNull();
  });
});

const base: VerdictInput = {
  kitDir: "/opt/arkiv-community-node",
  dockerAvailable: true,
  containers: [
    { service: "execution", name: "e", image: "", running: true, health: "healthy", restarts: 0, oomKilled: false, startedAt: null, cpuPct: 1, memBytes: 1, lastErrorLine: null },
    { service: "consensus", name: "c", image: "", running: true, health: "healthy", restarts: 0, oomKilled: false, startedAt: null, cpuPct: 1, memBytes: 1, lastErrorLine: null },
  ],
  recentRestarts: () => 0,
  kernelOomRecent: false,
  diskFree: 500e9,
  diskTotal: 1e12,
  elReachable: true,
  chainId: 0x76edaf,
  expectedChainId: 0x76edaf,
  elSyncing: false,
  headLag: 0,
  catchUpBlocksPerMin: null,
  elPeers: 5,
  clReachable: true,
  clElOffline: false,
  clPeers: 5,
  tunnelProfileOn: true,
  tunnelRunning: true,
  marketplaceKnown: true,
  providerConfigured: true,
  agreementLive: true,
  lowGas: [],
  lowGasThreshold: 0.5,
  rpcRequestsPerMin: null,
  proxyInline: false,
};

describe("verdict", () => {
  it("is healthy when all checks pass", () => {
    expect(evaluateVerdict(base).code).toBe("healthy");
  });
  it("orders rules: container_down beats everything", () => {
    const c = base.containers.map((x) => (x.service === "execution" ? { ...x, running: false } : x));
    expect(evaluateVerdict({ ...base, containers: c, headLag: 100, tunnelRunning: false }).code).toBe("container_down");
  });
  it("detects restart loops", () => {
    expect(evaluateVerdict({ ...base, recentRestarts: (s) => (s === "consensus" ? 4 : 0) }).code).toBe("container_down");
  });
  it("oom, disk_full, wrong_chain, el_offline in order", () => {
    expect(evaluateVerdict({ ...base, kernelOomRecent: true, diskFree: 1e9 }).code).toBe("oom");
    expect(evaluateVerdict({ ...base, diskFree: 1e9, chainId: 1 }).code).toBe("disk_full");
    expect(evaluateVerdict({ ...base, chainId: 1, clElOffline: true }).code).toBe("wrong_chain");
    expect(evaluateVerdict({ ...base, clElOffline: true, headLag: 50 }).code).toBe("el_offline");
  });
  it("lagging with ETA, and no lag verdict when the reference is unknown", () => {
    const v = evaluateVerdict({ ...base, headLag: 120, catchUpBlocksPerMin: 60 });
    expect(v.code).toBe("lagging");
    expect(v.detail).toContain("2 minutes");
    expect(evaluateVerdict({ ...base, headLag: null }).code).toBe("healthy");
  });
  it("no_peers, tunnel_down, no_agreement, low_gas", () => {
    expect(evaluateVerdict({ ...base, elPeers: 0, tunnelRunning: false }).code).toBe("no_peers");
    expect(evaluateVerdict({ ...base, tunnelRunning: false, agreementLive: false }).code).toBe("tunnel_down");
    expect(evaluateVerdict({ ...base, tunnelProfileOn: false, tunnelRunning: false }).code).toBe("healthy");
    expect(evaluateVerdict({ ...base, agreementLive: false }).code).toBe("no_agreement");
    expect(evaluateVerdict({ ...base, lowGas: [{ who: "heartbeat", balance: 0.1 }] }).code).toBe("low_gas");
  });
  it("execution RPC unreachable without docker is container_down", () => {
    expect(evaluateVerdict({ ...base, dockerAvailable: false, containers: [], elReachable: false }).code).toBe("container_down");
  });
});

describe("anomalies", () => {
  it("flags a spike against a 1 h baseline", () => {
    const pts = Array.from({ length: 100 }, (_, i) => ({ t: i * 15_000, v: 10 + (i % 3) }));
    pts.push({ t: 100 * 15_000, v: 90 });
    const a = zscoreAnomalies(pts, "cpu");
    expect(a.length).toBe(1);
    expect(a[0]!.v).toBe(90);
  });
});
