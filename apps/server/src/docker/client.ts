// Allowlisted Docker access. The socket is root-equivalent, so this wrapper is the ONLY place that
// talks to Docker. Read-only calls are limited to the node stack's containers (by compose project
// label + service name) plus the disk-usage summary. The write calls are, and are only:
//   - create/start/remove of the labelled bench sandbox with a fixed image;
//   - start/restart of a node-stack container (execution, consensus, tunnel), checked by label
//     ("Fix it" and the autopilot); never stop, remove or recreate;
//   - prune of the build cache and of dangling (untagged) images ("Free up disk space").
//     Tagged images, containers and volumes are never pruned, so chain data is never touched.
// No other Docker write call exists in the code.
import Docker from "dockerode";
import { existsSync } from "node:fs";
import type { ServiceName } from "@nodewatch/shared";

export const SANDBOX_LABEL = "nodewatch.sandbox";
export const SANDBOX_NAME = "nodewatch-bench-sandbox";
const NODE_SERVICES: readonly ServiceName[] = ["execution", "consensus", "tunnel"];

export interface NodeContainerRef {
  id: string;
  name: string;
  service: ServiceName;
  image: string;
  state: string;
}

export class DockerUnavailableError extends Error {}

export class AllowlistedDocker {
  private docker: Docker | null = null;
  private slowDocker: Docker | null = null;
  private readonly allowedIds = new Map<string, NodeContainerRef>();

  constructor(
    private readonly socketPath: string,
    private readonly composeProject: string,
    private readonly sandboxImage: string,
  ) {}

  available(): { ok: boolean; reason: string | null } {
    if (!existsSync(this.socketPath)) return { ok: false, reason: `Docker socket ${this.socketPath} not mounted` };
    return { ok: true, reason: null };
  }

  private client(): Docker {
    const a = this.available();
    if (!a.ok) throw new DockerUnavailableError(a.reason ?? "docker unavailable");
    if (!this.docker) this.docker = new Docker({ socketPath: this.socketPath, timeout: 8000 });
    return this.docker;
  }

  /** Prunes can take minutes on a large build cache. */
  private slowClient(): Docker {
    this.client();
    if (!this.slowDocker) this.slowDocker = new Docker({ socketPath: this.socketPath, timeout: 300_000 });
    return this.slowDocker;
  }

  /** List the node stack's containers (execution, consensus, tunnel), running or not. */
  async listNodeContainers(): Promise<NodeContainerRef[]> {
    const list = await this.client().listContainers({
      all: true,
      filters: { label: [`com.docker.compose.project=${this.composeProject}`] },
    });
    const out: NodeContainerRef[] = [];
    this.allowedIds.clear();
    for (const c of list) {
      const service = c.Labels?.["com.docker.compose.service"] as ServiceName | undefined;
      if (!service || !NODE_SERVICES.includes(service)) continue;
      const ref: NodeContainerRef = {
        id: c.Id,
        name: (c.Names?.[0] ?? c.Id).replace(/^\//, ""),
        service,
        image: c.Image,
        state: c.State,
      };
      this.allowedIds.set(c.Id, ref);
      out.push(ref);
    }
    return out;
  }

  private assertNode(id: string): void {
    if (!this.allowedIds.has(id)) throw new Error("docker allowlist: container is not part of the node stack");
  }

  async inspect(id: string): Promise<Docker.ContainerInspectInfo> {
    this.assertNode(id);
    return this.client().getContainer(id).inspect();
  }

  async stats(id: string): Promise<Docker.ContainerStats> {
    this.assertNode(id);
    return (await this.client().getContainer(id).stats({ stream: false })) as Docker.ContainerStats;
  }

  /** Last `tail` log lines (stdout+stderr, demultiplexed), read-only. */
  async logs(id: string, tail = 500): Promise<string[]> {
    this.assertNode(id);
    const c = this.client().getContainer(id);
    const buf = (await c.logs({ stdout: true, stderr: true, tail, timestamps: false, follow: false })) as unknown as Buffer;
    return demuxLogs(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)));
  }

  // ---- Bench sandbox: the only write operations ----

  async sandboxStatus(): Promise<{ id: string; running: boolean } | null> {
    const list = await this.client().listContainers({ all: true, filters: { label: [`${SANDBOX_LABEL}=1`] } });
    const c = list[0];
    return c ? { id: c.Id, running: c.State === "running" } : null;
  }

  /** Create + start the sandbox: fixed image, fixed labels, resource-limited, loopback-only port. */
  async createSandbox(hostPort: number, cmd?: string[]): Promise<string> {
    const docker = this.client();
    const existing = await this.sandboxStatus();
    if (existing) await this.removeSandbox(existing.id);
    const images = await docker.listImages({ filters: { reference: [this.sandboxImage] } });
    if (images.length === 0) {
      const stream = await docker.pull(this.sandboxImage);
      await new Promise<void>((resolve, reject) =>
        docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve())),
      );
    }
    const c = await docker.createContainer({
      name: SANDBOX_NAME,
      Image: this.sandboxImage,
      ...(cmd ? { Cmd: cmd } : {}),
      Labels: { [SANDBOX_LABEL]: "1", "nodewatch.role": "bench-sandbox" },
      ExposedPorts: { "8545/tcp": {} },
      HostConfig: {
        AutoRemove: false,
        NanoCpus: 3_000_000_000,
        Memory: 6 * 1024 ** 3,
        PortBindings: { "8545/tcp": [{ HostIp: "127.0.0.1", HostPort: String(hostPort) }] },
        RestartPolicy: { Name: "no" },
      },
    });
    await c.start();
    return c.id;
  }

  /**
   * Start (or restart) one node-stack container. The container must carry the compose project label and a node
   * service label. Used by "Fix it" and by the autopilot after it renders a new frpc.toml.
   */
  async restartNodeService(service: ServiceName): Promise<{ id: string; action: "started" | "restarted" }> {
    if (!NODE_SERVICES.includes(service)) throw new Error(`docker allowlist: ${service} is not a node service`);
    const list = await this.listNodeContainers();
    const ref = list.find((c) => c.service === service);
    if (!ref) throw new Error(`docker allowlist: no ${service} container in the node stack${service === "tunnel" ? " (is the tunnel profile enabled?)" : ""}`);
    const c = this.slowClient().getContainer(ref.id);
    const info = await c.inspect();
    const labels = info.Config?.Labels ?? {};
    if (labels["com.docker.compose.service"] !== service || labels["com.docker.compose.project"] !== this.composeProject)
      throw new Error(`docker allowlist: refusing to restart a container that is not the node stack's ${service}`);
    if (info.State?.Running) {
      // Honour the kit's stop_grace_period (3 min for execution): killing reth mid-flush means a repair on next start.
      const t = (info.Config as { StopTimeout?: number } | undefined)?.StopTimeout ?? 10;
      await c.restart({ t });
      return { id: ref.id, action: "restarted" };
    }
    await c.start();
    return { id: ref.id, action: "started" };
  }

  async restartTunnel(): Promise<{ id: string; action: "started" | "restarted" }> {
    return this.restartNodeService("tunnel");
  }

  // ---- Disk cleanup: build cache and dangling images only ----

  /** Bytes each cleanup would free, from Docker's own disk-usage summary (read-only). */
  async reclaimable(): Promise<{ buildCache: number; buildCacheEntries: number; danglingImages: number; danglingCount: number }> {
    const df = (await this.client().df()) as {
      Images?: { RepoTags?: string[] | null; Containers?: number; Size?: number; SharedSize?: number }[];
      BuildCache?: { InUse?: boolean; Shared?: boolean; Size?: number }[];
    };
    let buildCache = 0;
    let buildCacheEntries = 0;
    for (const b of df.BuildCache ?? []) {
      if (b.InUse || b.Shared) continue;
      buildCache += b.Size ?? 0;
      buildCacheEntries++;
    }
    let danglingImages = 0;
    let danglingCount = 0;
    for (const img of df.Images ?? []) {
      const tags = img.RepoTags ?? [];
      const dangling = tags.length === 0 || tags.every((t) => t === "<none>:<none>");
      if (!dangling || (img.Containers ?? 0) > 0) continue;
      const shared = img.SharedSize && img.SharedSize > 0 ? img.SharedSize : 0;
      danglingImages += Math.max(0, (img.Size ?? 0) - shared);
      danglingCount++;
    }
    return { buildCache, buildCacheEntries, danglingImages, danglingCount };
  }

  async pruneBuildCache(): Promise<number> {
    const r = await this.slowClient().pruneBuilder();
    return Number(r?.SpaceReclaimed ?? 0);
  }

  /** Only untagged images no container uses. Tagged images (the kit's marketplace/snapshot images) are kept. */
  async pruneDanglingImages(): Promise<number> {
    const r = await this.slowClient().pruneImages({ filters: { dangling: ["true"] } });
    return Number(r?.SpaceReclaimed ?? 0);
  }

  async removeSandbox(id: string): Promise<void> {
    const c = this.client().getContainer(id);
    const info = await c.inspect();
    if (info.Config?.Labels?.[SANDBOX_LABEL] !== "1") throw new Error("docker allowlist: refusing to remove a non-sandbox container");
    await c.remove({ force: true, v: true });
  }
}

/** Docker multiplexes stdout/stderr with 8-byte frame headers when there is no TTY. */
export function demuxLogs(buf: Buffer): string[] {
  const chunks: string[] = [];
  let i = 0;
  const looksMuxed = buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0;
  if (!looksMuxed) return buf.toString("utf8").split("\n").filter(Boolean);
  while (i + 8 <= buf.length) {
    const len = buf.readUInt32BE(i + 4);
    chunks.push(buf.subarray(i + 8, i + 8 + len).toString("utf8"));
    i += 8 + len;
  }
  return chunks.join("").split("\n").filter(Boolean);
}
