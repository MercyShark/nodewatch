import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AllowlistedDocker } from "../docker/client.js";
import { cloneOptions } from "./swap.js";

const old = {
  Name: "/nodewatch",
  Image: "sha256:old",
  Config: {
    Env: ["PATH=/usr/bin", "NODEWATCH_REVISION=aaa1111", "ADMIN_ADDRESSES=0xabc", "TELEGRAM_BOT_TOKEN=1:x"],
    Labels: { "org.opencontainers.image.revision": "aaa1111", "com.docker.compose.project": "nw" },
    Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8000/api/health"] },
    ExposedPorts: { "8080/tcp": {} },
  },
  HostConfig: { NetworkMode: "host", Binds: ["nodewatch:/app/data", "/var/run/docker.sock:/var/run/docker.sock"], RestartPolicy: { Name: "unless-stopped" } },
  NetworkSettings: { Networks: { host: {} } },
} as never;
const oldImage = {
  Config: {
    Env: ["PATH=/usr/bin", "NODEWATCH_REVISION=aaa1111"],
    Labels: { "org.opencontainers.image.revision": "aaa1111" },
    Healthcheck: { Test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:${PORT:-8080}/api/health"] },
  },
} as never;

describe("self-update", () => {
  it("keeps the operator's settings and drops what came from the old image", () => {
    const o = cloneOptions(old, oldImage, "me/nodewatch:latest", "nodewatch-next");
    expect(o.Image).toBe("me/nodewatch:latest");
    expect(o.Env).toEqual(["ADMIN_ADDRESSES=0xabc", "TELEGRAM_BOT_TOKEN=1:x"]);
    expect(o.Labels).toMatchObject({ "com.docker.compose.project": "nw" });
    expect(o.Labels).not.toHaveProperty("org.opencontainers.image.revision");
    expect((o.HostConfig as { Binds: string[] }).Binds).toContain("nodewatch:/app/data");
    expect((o.HostConfig as { RestartPolicy: { Name: string } }).RestartPolicy.Name).toBe("unless-stopped");
    // compose set its own health check (different from the image's), so it is kept
    expect(o.Healthcheck?.Test?.[1]).toContain(":8000/");
    expect(o.NetworkingConfig).toBeUndefined();
  });

  it("uses the new image's health check when the old one only had the image default", () => {
    const same = { ...(old as object), Config: { ...(old as { Config: object }).Config, Healthcheck: (oldImage as { Config: { Healthcheck: unknown } }).Config.Healthcheck } } as never;
    expect(cloneOptions(same, oldImage, "me/nodewatch:latest", "n").Healthcheck).toBeUndefined();
  });

  it("finds its own container id from mountinfo, and only then", () => {
    const d = new AllowlistedDocker("/nonexistent.sock", "p", "img", "me/nodewatch:latest");
    const dir = mkdtempSync(path.join(tmpdir(), "nw-"));
    const f = path.join(dir, "mountinfo");
    const id = "9127d5c933b3eb45bf47c69b5458a375908ae845060a254f8b50124f72ae7853";
    writeFileSync(f, `1 2 0:1 /var/lib/docker/containers/${id}/hostname /etc/hostname rw - ext4 /dev/root rw\n`);
    expect(d.ownContainerId(f)).toBe(id);
    writeFileSync(f, "1 2 0:1 / / rw - ext4 /dev/root rw\n");
    expect(d.ownContainerId(f)).toBeNull();
  });
});
