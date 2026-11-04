import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake chain: records every batch's nonce and size, answers the nonce/count RPCs.
const sent: { nonce: number; items: number }[] = [];
let failAtNonce: number | null = null;
let inFlight = 0;
let maxInFlight = 0;

vi.mock("../util/http.js", () => ({
  jsonRpc: vi.fn(async (_url: string, method: string) => {
    if (method === "eth_getTransactionCount") return "0x7";
    if (method === "arkiv_query") return { count: `0x${sent.reduce((a, b) => a + b.items, 0).toString(16)}` };
    throw new Error(`unexpected ${method}`);
  }),
}));
vi.mock("../arkiv/client.js", () => ({
  walletArkiv: () => ({
    account: { address: "0x00000000000000000000000000000000000000aa" },
    wallet: {
      executeBatch: async ({ creates }: { creates: unknown[] }, { nonce }: { nonce: number }) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5 + (nonce % 3) * 3)); // receipts come back out of order
        inFlight--;
        if (nonce === failAtNonce) throw new Error("boom");
        sent.push({ nonce, items: creates.length });
      },
    },
  }),
}));

const { seed } = await import("./dataset.js");
const cfg = { EL_RPC_URL: "http://127.0.0.1:8545", BENCH_SANDBOX_PORT: 28545 } as never;

describe("pipelined seeding", () => {
  beforeEach(() => {
    sent.length = 0;
    failAtNonce = null;
    inFlight = maxInFlight = 0;
  });

  it("gives each batch its own consecutive nonce from the pending count and writes every item once", async () => {
    const n = await seed(cfg, "http://127.0.0.1:28545", 1337, "0x" + "11".repeat(32), "rt", 0, 1010, { parallel: 8 });
    expect(n).toBe(1010);
    expect(sent.map((s) => s.nonce).sort((a, b) => a - b)).toEqual(Array.from({ length: 41 }, (_, i) => 7 + i));
    expect(sent.reduce((a, b) => a + b.items, 0)).toBe(1010);
    expect(maxInFlight).toBe(8);
  });

  it("starts no new batch after a failure and throws", async () => {
    failAtNonce = 9;
    await expect(seed(cfg, "http://127.0.0.1:28545", 1337, "0x" + "11".repeat(32), "rt", 0, 5000, { parallel: 4 })).rejects.toThrow("boom");
    expect(Math.max(...sent.map((s) => s.nonce))).toBeLessThan(9 + 4);
  });

  it("refuses targets other than our node or the sandbox before signing anything", async () => {
    await expect(seed(cfg, "https://rpc.rabdi.db-chain.testnet.arkiv.network", 1, "0x" + "11".repeat(32), "rt", 0, 25)).rejects.toThrow(/refused/);
    expect(sent).toEqual([]);
  });
});
