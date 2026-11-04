import { describe, expect, it } from "vitest";
import { parseDiskstats, parseLoadavg, parseMeminfo, parseNetDev, parseProcStat, parseVmstatOom } from "./host.js";

describe("host parsers", () => {
  it("parses /proc/stat", () => {
    const c = parseProcStat("cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 50 0 25 400 25 0 0 0 0 0\ncpu1 50 0 25 400 25 0 0 0 0 0\n");
    expect(c).toEqual({ idle: 850, total: 1000, count: 2 });
  });
  it("parses meminfo and loadavg", () => {
    const m = parseMeminfo("MemTotal:       65000000 kB\nMemAvailable:   60000000 kB\nSwapTotal: 0 kB\n");
    expect(m.MemTotal).toBe(65000000 * 1024);
    expect(parseLoadavg("0.50 0.40 0.30 1/200 1234")).toEqual([0.5, 0.4, 0.3]);
  });
  it("sums whole disks only", () => {
    const d = parseDiskstats(
      [
        " 259       0 nvme0n1 100 0 2000 0 50 0 1000 0 0 0 0 0 0 0 0 0 0",
        " 259       1 nvme0n1p1 90 0 1900 0 40 0 900 0 0 0 0 0 0 0 0 0 0",
        "   7       0 loop0 683 0 45198 299 0 0 0 0 0 298 299 0 0 0 0 0 0",
      ].join("\n"),
    );
    expect(d).toEqual({ reads: 100, readSectors: 2000, writes: 50, writeSectors: 1000 });
  });
  it("skips virtual interfaces", () => {
    const n = parseNetDev(
      "Inter-|\n face |\n    lo:  458239    3830    0    0    0     0          0         0   458239    3830    0    0    0     0       0          0\nenp39s0: 2374658761 6932930    0    0    0     0          0         0 1460012031 6027130    0    0    0     0       0          0\ndocker0:  110599    1121    0    0    0     0          0         0 37547743    1769    0    4    0     0       0          0\n",
    );
    expect(n).toEqual({ rx: 2374658761, tx: 1460012031 });
  });
  it("reads oom_kill", () => {
    expect(parseVmstatOom("pgfault 1\noom_kill 3\n")).toBe(3);
    expect(parseVmstatOom("pgfault 1\n")).toBeNull();
  });
});
