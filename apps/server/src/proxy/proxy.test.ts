import http from "node:http";
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { errorDetails, errorIds, RpcStats, startProxy } from "./rpcProxy.js";
import { normalizeShape, parseRpcBody, shapeId } from "./shape.js";

describe("shape", () => {
  it("normalizes literals so values share a shape", () => {
    const a = "$creator = addr(0xCA4B166EE155Cb2816Dc25f94Dc1fD102a26c997) AND kind = str('rpc.offer') AND n > u64(5)";
    const b = "$creator = addr(0x0000000000000000000000000000000000000001) AND kind = str('x''y') AND n > u64(99)";
    expect(normalizeShape(a)).toBe("$creator = addr(?) AND kind = str(?) AND n > u64(?)");
    expect(shapeId(a)).toBe(shapeId(b));
    expect(shapeId(a)).toMatch(/^s_[0-9a-f]{12}$/);
  });
  it("parses single and batch bodies", () => {
    expect(parseRpcBody(Buffer.from('{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber"}'))?.methods).toEqual(["eth_blockNumber"]);
    const b = parseRpcBody(Buffer.from('[{"method":"a"},{"method":"arkiv_query","params":["x = u64(1)",{}]}]'))!;
    expect(b.batch).toBe(true);
    expect(b.queries).toEqual(["x = u64(1)"]);
    expect(parseRpcBody(Buffer.from("not json"))).toBeNull();
  });
});

describe("errorIds", () => {
  it("finds errors per batch id", () => {
    const ids = errorIds('[{"id":1,"result":"0x1"},{"id":2,"error":{"code":-32601}}]');
    expect([...ids]).toEqual(["2"]);
    expect(errorIds("<html>").has("*")).toBe(true);
    const d = errorDetails('[{"id":1,"result":"0x1"},{"id":2,"error":{"code":-32603,"message":"golemdb segment_range_of(transactions): NotImplemented"}}]');
    expect(d.get("2")).toEqual({ code: -32603, message: "golemdb segment_range_of(transactions): NotImplemented" });
    expect(d.has("1")).toBe(false);
  });
});

describe("proxy listener", () => {
  const received: string[] = [];
  const seenEncoding: (string | undefined)[] = [];
  const upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString();
      received.push(body);
      seenEncoding.push(req.headers["accept-encoding"] as string | undefined);
      if (body.includes("gz_method")) {
        // An upstream that compresses anyway: the proxy must not read the bytes as JSON and call it an error.
        res.writeHead(200, { "content-type": "application/json", "content-encoding": "gzip" });
        res.end(gzipSync('{"jsonrpc":"2.0","id":1,"result":"0x1"}'));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      if (body.includes("bad_method")) res.end('{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"nope"}}');
      else res.end('{"jsonrpc":"2.0","id":1,"result":"0x1"}');
    });
  });
  let proxy: http.Server;
  afterAll(() => {
    upstream.close();
    proxy?.close();
  });

  it("forwards untouched (fail-open) and records per-method stats", async () => {
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const up = (upstream.address() as AddressInfo).port;
    const ctx = testCtx({ EL_RPC_URL: `http://127.0.0.1:${up}`, PROXY_PORT: "0" });
    const stats = new RpcStats();
    proxy = startProxy(ctx, stats);
    await new Promise<void>((r) => (proxy.listening ? r() : proxy.once("listening", r)));
    const port = (proxy.address() as AddressInfo).port;
    const post = (body: string) =>
      fetch(`http://127.0.0.1:${port}/`, { method: "POST", headers: { "content-type": "application/json" }, body }).then((r) => r.text());

    expect(await post('{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}')).toContain("0x1");
    expect(await post("garbage{")).toContain("0x1");
    expect(received).toContain("garbage{");
    expect(await post('{"jsonrpc":"2.0","id":1,"method":"bad_method"}')).toContain("error");
    expect(await post('{"jsonrpc":"2.0","id":1,"method":"gz_method"}')).toContain("0x1");
    await new Promise((r) => setTimeout(r, 50));
    expect(seenEncoding.every((e) => e === undefined)).toBe(true); // accept-encoding is never forwarded
    expect(stats.requestsLastMinute()).toBe(3);
    stats.flush(ctx);
    expect(ctx.tsdb.sum("rpc_requests", { method: "eth_blockNumber" }, 60_000)).toBe(1);
    expect(ctx.tsdb.sum("rpc_errors", { method: "bad_method" }, 60_000)).toBe(1);
    expect(ctx.tsdb.sum("rpc_errors", { method: "gz_method" }, 60_000)).toBe(0);
    expect(ctx.tsdb.sum("rpc_requests", { method: "gz_method" }, 60_000)).toBe(1);
  });
});
