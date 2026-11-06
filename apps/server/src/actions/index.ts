// One-click actions an admin can run from the dashboard: "Fix it" on the verdict and "Free up disk space".
// Each one re-checks live state first (a stale click never acts), goes through the Docker allowlist, and is logged.
import type { ActionLogEntry, CleanupItemId, CleanupPreview, CleanupResult, FixAction } from "@nodewatch/shared";
import type { Autopilot } from "../autopilot/index.js";
import type { Ctx } from "../context.js";
import { errMsg } from "../util/http.js";

export class ActionConflictError extends Error {}

const GB = 1e9;

export class Actions {
  private running = new Set<string>();

  constructor(
    private readonly ctx: Ctx,
    private readonly autopilot: Autopilot,
  ) {}

  log(actor: string, action: string, target: string | null, ok: boolean, message: string): void {
    const now = Date.now();
    this.ctx.db.prepare("INSERT INTO actions_log(ts, actor, action, target, ok, message) VALUES (?, ?, ?, ?, ?, ?)").run(now, actor, action, target, ok ? 1 : 0, message.slice(0, 500));
    this.ctx.db.prepare("DELETE FROM actions_log WHERE ts < ?").run(now - 30 * 86_400_000);
    this.ctx.log.info({ actor, action, target, ok }, `action: ${message}`);
  }

  recent(limit = 20): ActionLogEntry[] {
    return (this.ctx.db.prepare("SELECT ts, actor, action, target, ok, message FROM actions_log ORDER BY ts DESC LIMIT ?").all(limit) as (Omit<ActionLogEntry, "ok"> & { ok: number })[]).map(
      (r) => ({ ...r, ok: r.ok === 1 }),
    );
  }

  /**
   * Run the fix for the verdict the admin was looking at. Refuses when the live verdict has changed since, so a click on
   * an old page never restarts something that has recovered. Restarts return once Docker has the request in hand;
   * the execution client may take up to its 3-minute grace period to stop cleanly.
   */
  async fix(code: string, actor: string): Promise<{ message: string; action: FixAction }> {
    const v = this.ctx.state.verdict;
    if (v.code !== code) throw new ActionConflictError(`the verdict changed to "${v.code}" since the page loaded; nothing was done`);
    const action = v.action ?? null;
    if (!action) throw new ActionConflictError(`"${code}" has no one-click fix; use the command shown`);
    const key = `fix:${action.kind}:${"service" in action ? action.service : ""}`;
    if (this.running.has(key)) throw new ActionConflictError("that fix is already running");
    this.running.add(key);
    try {
      let message: string;
      if (action.kind === "restart_service") {
        const r = await this.ctx.docker.restartNodeService(action.service);
        message = `${r.action} the ${action.service} container`;
        this.log(actor, "fix", `${code}:${action.service}`, true, message);
      } else if (action.kind === "autopilot_run") {
        const next = await this.autopilot.runOnce();
        message = `ran one autopilot pass: ${next}`;
        this.log(actor, "fix", code, true, message);
      } else {
        throw new ActionConflictError("disk cleanup runs from the Resources page, with a preview of what it removes");
      }
      return { message, action };
    } catch (err) {
      if (!(err instanceof ActionConflictError)) this.log(actor, "fix", code, false, errMsg(err));
      throw err;
    } finally {
      this.running.delete(key);
    }
  }

  async cleanupPreview(): Promise<CleanupPreview> {
    const diskFree = this.ctx.state.host?.diskFree ?? null;
    const avail = this.ctx.docker.available();
    if (!avail.ok) return { available: false, reason: avail.reason, diskFree, items: [] };
    try {
      const r = await this.ctx.docker.reclaimable();
      return {
        available: true,
        reason: null,
        diskFree,
        items: [
          {
            id: "build_cache",
            label: "Docker build cache",
            detail: `${r.buildCacheEntries} cached build steps. The next image build on this host is slower; nothing running uses them.`,
            bytes: r.buildCache,
          },
          {
            id: "dangling_images",
            label: "Untagged images",
            detail: `${r.danglingCount} old image versions with no tag and no container. Tagged images, like the kit's marketplace image, are kept.`,
            bytes: r.danglingImages,
          },
        ],
      };
    } catch (err) {
      return { available: false, reason: errMsg(err), diskFree, items: [] };
    }
  }

  async cleanup(ids: CleanupItemId[], actor: string): Promise<CleanupResult> {
    if (this.running.has("cleanup")) throw new ActionConflictError("a cleanup is already running");
    this.running.add("cleanup");
    try {
      const results: CleanupResult["results"] = [];
      for (const id of [...new Set(ids)]) {
        try {
          const bytes = id === "build_cache" ? await this.ctx.docker.pruneBuildCache() : await this.ctx.docker.pruneDanglingImages();
          results.push({ id, ok: true, reclaimedBytes: bytes, error: null });
          this.log(actor, "cleanup", id, true, `freed ${(bytes / GB).toFixed(2)} GB`);
        } catch (err) {
          results.push({ id, ok: false, reclaimedBytes: 0, error: errMsg(err) });
          this.log(actor, "cleanup", id, false, errMsg(err));
        }
      }
      return { results, reclaimedBytes: results.reduce((a, r) => a + r.reclaimedBytes, 0) };
    } finally {
      this.running.delete("cleanup");
    }
  }
}
