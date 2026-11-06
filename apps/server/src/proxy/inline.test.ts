import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testCtx } from "../test/helpers.js";
import { InlineMode, parseFrpcTarget, rewriteFrpcTarget, type GatewayListener } from "./inline.js";

const TOML = `# rendered by setup.sh
serverAddr = "2.29.34.87"
serverPort = 7000
metadatas.agreement = "0xabc"
metadatas.token = "secret-token"
webServer.addr = "0.0.0.0"
webServer.port = 7400

[[proxies]]
name = "node-rpc-20009"
type = "tcp"
# The execution container on the compose network.
localIP = "execution"
localPort = 8545
remotePort = 20009
`;

describe("frpc target", () => {
  it("parses the local target", () => {
    expect(parseFrpcTarget(TOML)).toEqual({ ip: "execution", port: 8545 });
    expect(parseFrpcTarget("serverAddr = \"x\"\n")).toBeNull();
  });
  it("rewrites only the two target lines and round-trips", () => {
    const inline = rewriteFrpcTarget(TOML, { ip: "172.18.0.1", port: 18545 });
    expect(parseFrpcTarget(inline)).toEqual({ ip: "172.18.0.1", port: 18545 });
    expect(inline).toContain('metadatas.token = "secret-token"');
    expect(inline).toContain("remotePort = 20009");
    expect(inline.split("\n").length).toBe(TOML.split("\n").length);
    expect(rewriteFrpcTarget(inline, { ip: "execution", port: 8545 })).toBe(TOML);
    expect(() => rewriteFrpcTarget("nothing here", { ip: "a", port: 1 })).toThrow(/localIP/);
  });
});

function fakeListener(): GatewayListener & { ip: string | null } {
  const l = {
    ip: null as string | null,
    async start(ip: string) {
      l.ip = ip;
    },
    stop() {
      l.ip = null;
    },
    address: () => l.ip,
  };
  return l;
}

describe("InlineMode.status", () => {
  it("reports passive with the kit's default target, inline when frpc points at the proxy, and drift", () => {
    const ctx = testCtx();
    const kit = path.join(ctx.cfg.DATA_DIR, "kit");
    mkdirSync(kit, { recursive: true });
    writeFileSync(path.join(kit, "frpc.toml"), TOML);
    (ctx.cfg as { NODE_KIT_DIR: string }).NODE_KIT_DIR = kit;
    const listener = fakeListener();
    const inline = new InlineMode(ctx, listener, () => undefined);
    let st = inline.status();
    expect(st.mode).toBe("passive");
    expect(st.target).toEqual({ ip: "execution", port: 8545 });
    expect(st.drift).toBe(false);

    listener.ip = "172.18.0.1";
    writeFileSync(path.join(kit, "frpc.toml"), rewriteFrpcTarget(TOML, { ip: "172.18.0.1", port: ctx.cfg.PROXY_PORT }));
    st = inline.status();
    expect(st.mode).toBe("inline");
    expect(st.proxy).toEqual({ ip: "172.18.0.1", port: ctx.cfg.PROXY_PORT });

    // Stored "on" but the file was regenerated back to the kit default → drift.
    ctx.db.prepare("INSERT INTO settings(key, value) VALUES ('rpc_inline', 'true')").run();
    writeFileSync(path.join(kit, "frpc.toml"), TOML);
    st = inline.status();
    expect(st.mode).toBe("passive");
    expect(st.enabled).toBe(true);
    expect(st.drift).toBe(true);
    expect(readFileSync(path.join(kit, "frpc.toml"), "utf8")).toBe(TOML);
  });

  it("refuses to switch when the tunnel is not configured", async () => {
    const ctx = testCtx();
    const inline = new InlineMode(ctx, fakeListener(), () => undefined);
    await expect(inline.disable("admin")).rejects.toThrow(/not configured/);
  });
});
