import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyTunnelSettings, kitPaths, mergeEnv, readEnv, renderFrpc, type TunnelValues } from "./kitfiles.js";

const TEMPLATE = `serverAddr = "\${TUNNEL_SERVER_ADDR}"
serverPort = \${TUNNEL_SERVER_PORT}
metadatas.agreement = "\${TUNNEL_AGREEMENT}"
metadatas.token = "\${TUNNEL_TOKEN}"
name = "node-rpc-\${TUNNEL_REMOTE_PORT}"
remotePort = \${TUNNEL_REMOTE_PORT}
other = "\${NOT_A_TUNNEL_VAR}"
`;

const V: TunnelValues = {
  TUNNEL_SERVER_ADDR: "2.29.34.87",
  TUNNEL_SERVER_PORT: "7000",
  TUNNEL_REMOTE_PORT: "20009",
  TUNNEL_AGREEMENT: "0xcf3e",
  TUNNEL_TOKEN: "0xsig",
};

function kit(env: string) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "nw-kit-"));
  mkdirSync(path.join(dir, "templates"));
  mkdirSync(path.join(dir, "secrets"));
  writeFileSync(path.join(dir, ".env"), env, { mode: 0o600 });
  writeFileSync(path.join(dir, "templates", "frpc.toml.tmpl"), TEMPLATE);
  return kitPaths(dir);
}

describe("kit files", () => {
  it("merges tunnel values in place, keeps comments, appends missing keys, enables the profile", () => {
    const k = kit("# comment\nNETWORK=rabdi\nTUNNEL_AGREEMENT=0xold\nCOMPOSE_PROFILES=marketplace # note\n");
    mergeEnv(k.env, { TUNNEL_AGREEMENT: "0xnew", TUNNEL_TOKEN: "0xt" }, "tunnel");
    const text = readFileSync(k.env, "utf8");
    expect(text.split("\n")[0]).toBe("# comment");
    expect(text).toContain("NETWORK=rabdi");
    expect(text).toContain("TUNNEL_AGREEMENT=0xnew");
    expect(text).not.toContain("0xold");
    expect(text).toContain("TUNNEL_TOKEN=0xt");
    expect(text).toContain("COMPOSE_PROFILES=marketplace,tunnel");
    expect(readEnv(k.env).COMPOSE_PROFILES).toBe("marketplace,tunnel");
    expect(statSync(k.env).mode & 0o777).toBe(0o600);
  });

  it("renders frpc.toml like envsubst with only the five tunnel variables", () => {
    const out = renderFrpc(TEMPLATE, V);
    expect(out).toContain('serverAddr = "2.29.34.87"');
    expect(out).toContain("remotePort = 20009");
    expect(out).toContain('name = "node-rpc-20009"');
    expect(out).toContain('metadatas.token = "0xsig"');
    expect(out).toContain('other = "${NOT_A_TUNNEL_VAR}"'); // untouched, like envsubst with a whitelist
  });

  it("applyTunnelSettings writes env + frpc.toml once and reports no change the second time", () => {
    const k = kit("NETWORK=rabdi\n");
    const first = applyTunnelSettings(k, V);
    expect(first).toEqual({ envChanged: true, frpcChanged: true });
    expect(readEnv(k.env).TUNNEL_REMOTE_PORT).toBe("20009");
    expect(readEnv(k.env).COMPOSE_PROFILES).toBe("tunnel");
    expect(readFileSync(k.frpc, "utf8")).toContain("remotePort = 20009");
    expect(statSync(k.frpc).mode & 0o777).toBe(0o600);
    const second = applyTunnelSettings(k, V);
    expect(second).toEqual({ envChanged: false, frpcChanged: false });
    // A new agreement changes both.
    const third = applyTunnelSettings(k, { ...V, TUNNEL_AGREEMENT: "0xnext", TUNNEL_REMOTE_PORT: "20010" });
    expect(third).toEqual({ envChanged: true, frpcChanged: true });
    expect(readFileSync(k.frpc, "utf8")).toContain("remotePort = 20010");
  });
});
