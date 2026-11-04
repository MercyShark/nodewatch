// Size of the chain-data volumes under DATA_ROOT/volumes (a periodic, cached du-style walk).
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { Ctx } from "../context.js";

/** du-like: allocated bytes (st_blocks * 512), never following symlinks or crossing into /proc-like trees. */
export async function dirSize(root: string, deadline = Date.now() + 120_000): Promise<number> {
  let total = 0;
  const stack = [root];
  const seen = new Set<string>();
  while (stack.length) {
    if (Date.now() > deadline) throw new Error(`walk of ${root} exceeded its time budget`);
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (dir === root) throw err;
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      try {
        const st = await lstat(p);
        const id = `${st.dev}:${st.ino}`;
        if (st.nlink > 1) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        total += st.blocks * 512;
        if (st.isDirectory()) stack.push(p);
      } catch {
        /* file vanished mid-walk */
      }
    }
  }
  return total;
}

export function createVolumesCollector(ctx: Ctx) {
  return async function collectVolumes(): Promise<void> {
    const base = path.join(ctx.cfg.DATA_ROOT, "volumes");
    const proj = ctx.cfg.NODE_COMPOSE_PROJECT;
    const [el, cl] = await Promise.all([
      dirSize(path.join(base, `${proj}_el-data`)).catch(() => null),
      dirSize(path.join(base, `${proj}_cl-data`)).catch(() => null),
    ]);
    if (el === null && cl === null) {
      ctx.state.volumes = { at: Date.now(), el: null, cl: null };
      throw new Error(`cannot read volume directories under ${base} (mount /var/lib/docker at DATA_ROOT, read-only)`);
    }
    const now = Date.now();
    ctx.state.volumes = { at: now, el, cl };
    ctx.tsdb.record("volume_bytes", el, { volume: "el" }, now);
    ctx.tsdb.record("volume_bytes", cl, { volume: "cl" }, now);
  };
}
