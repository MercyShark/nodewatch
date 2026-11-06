// Entry point of the one-off updater container (see swap.ts). Started by Nodewatch with the Docker socket and
// Nodewatch's data volume mounted; writes the outcome to /app/data/update-status.json for the dashboard.
import { writeFileSync } from "node:fs";
import Docker from "dockerode";
import { swap } from "./swap.js";

const STATUS = "/app/data/update-status.json";
const target = process.env.NW_UPDATE_TARGET ?? "";
const image = process.env.NW_UPDATE_IMAGE ?? "";

function write(r: { ok: boolean; rolledBack: boolean; message: string; from: string | null; to: string | null }): void {
  try {
    writeFileSync(STATUS, JSON.stringify({ ...r, at: Date.now() }), { mode: 0o600 });
  } catch {
    /* the result is also in this container's log */
  }
  console.log(JSON.stringify(r));
}

async function main(): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(target) || !image) throw new Error("NW_UPDATE_TARGET and NW_UPDATE_IMAGE are required");
  const docker = new Docker({ socketPath: "/var/run/docker.sock", timeout: 300_000 });
  try {
    write(await swap(docker, target, image));
  } catch (err) {
    // Something failed outside swap's own rollback: make sure the old Nodewatch is running again.
    const msg = (err as Error).message;
    try {
      const c = docker.getContainer(target);
      const i = await c.inspect();
      const name = i.Name.replace(/^\//, "");
      if (name.endsWith("-old")) await c.rename({ name: name.slice(0, -4) }).catch(() => undefined);
      if (!i.State.Running) await c.start();
    } catch {
      /* nothing more we can do; the log says why */
    }
    write({ ok: false, rolledBack: true, message: `update failed before the switch (${msg}); the previous version was kept`, from: null, to: null });
    process.exitCode = 1;
  }
}

void main();
