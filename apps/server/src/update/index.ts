// "Update Nodewatch" (Settings → Updates): compare the running image with the registry, pull the new one, and hand
// the swap to a one-off updater container (helper.ts). The node kit is never touched; only Nodewatch restarts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { UpdateResult, UpdateState } from "@nodewatch/shared";
import type { Actions } from "../actions/index.js";
import { ActionConflictError } from "../actions/index.js";
import type { Ctx } from "../context.js";
import { getSetting, setSetting } from "../db/index.js";
import { errMsg } from "../util/http.js";

const CHECK_TTL_MS = 10 * 60_000;

export class Updater {
  private check: { at: number; digest: string | null; error: string | null } | null = null;
  private starting = false;

  constructor(
    private readonly ctx: Ctx,
    private readonly actions: Actions,
  ) {
    this.logOutcome();
  }

  /**
   * Log the outcome of an update once. The updater writes its result only after the new container is healthy, which
   * is after that container has booted, so this runs at boot AND on every later state read (found in the e2e run:
   * logging at boot alone missed the result until the next restart).
   */
  private logOutcome(): void {
    const last = this.last();
    if (last && last.at > getSetting<number>(this.ctx.db, "updateLoggedAt", 0)) {
      this.actions.log("updater", "update", last.to, last.ok, last.message);
      setSetting(this.ctx.db, "updateLoggedAt", last.at);
      this.starting = false;
    }
  }

  private get statusFile(): string {
    return path.join(this.ctx.cfg.DATA_DIR, "update-status.json");
  }

  private last(): UpdateResult | null {
    try {
      return existsSync(this.statusFile) ? (JSON.parse(readFileSync(this.statusFile, "utf8")) as UpdateResult) : null;
    } catch {
      return null;
    }
  }

  async state(force = false): Promise<UpdateState> {
    this.logOutcome();
    const cfg = this.ctx.cfg;
    const docker = this.ctx.docker;
    const base: UpdateState = {
      image: cfg.NODEWATCH_IMAGE,
      revision: cfg.NODEWATCH_REVISION,
      runningDigest: null,
      latestDigest: this.check?.digest ?? null,
      checkedAt: this.check?.at ?? null,
      checkError: this.check?.error ?? null,
      updateAvailable: null,
      canUpdate: false,
      reason: null,
      inProgress: this.starting,
      last: this.last(),
    };
    const avail = docker.available();
    if (!avail.ok) return { ...base, reason: avail.reason };
    let own;
    try {
      own = await docker.ownContainer();
    } catch (err) {
      return { ...base, reason: `cannot inspect Nodewatch's own container: ${errMsg(err)}` };
    }
    if (!own) return { ...base, reason: "Nodewatch is not running in a container, so it cannot replace itself" };
    if (!own.Mounts?.some((m) => m.Destination === "/app/data")) return { ...base, reason: "Nodewatch's data is not on a volume, so an update would lose it" };

    const repo = cfg.NODEWATCH_IMAGE.slice(0, cfg.NODEWATCH_IMAGE.lastIndexOf(":"));
    const repoNames = new Set([repo, `docker.io/${repo}`, `docker.io/library/${repo}`]);
    try {
      const digests = await docker.imageRepoDigests(own.Image);
      base.runningDigest = digests.map((d) => d.split("@")).find(([r]) => repoNames.has(r!))?.[1] ?? null;
    } catch {
      /* local image without registry digests */
    }
    if (force || !this.check || Date.now() - this.check.at > CHECK_TTL_MS) {
      try {
        this.check = { at: Date.now(), digest: await docker.remoteDigest(), error: null };
      } catch (err) {
        this.check = { at: Date.now(), digest: null, error: errMsg(err).slice(0, 200) };
      }
    }
    base.latestDigest = this.check.digest;
    base.checkedAt = this.check.at;
    base.checkError = this.check.error;
    // A local build has no registry digest: updating then switches it to the published image.
    base.updateAvailable = base.runningDigest && base.latestDigest ? base.runningDigest !== base.latestDigest : null;
    base.inProgress = this.starting || (await docker.updaterRunning().catch(() => false));
    base.canUpdate = !base.inProgress && !!base.latestDigest;
    if (!base.latestDigest) base.reason = base.checkError ? `cannot reach the registry: ${base.checkError}` : null;
    return base;
  }

  /** Pull the new image and start the updater. Nodewatch restarts within seconds after this returns. */
  async start(actor: string): Promise<{ message: string }> {
    if (this.starting || (await this.ctx.docker.updaterRunning())) throw new ActionConflictError("an update is already running");
    this.starting = true;
    try {
      const own = await this.ctx.docker.ownContainer();
      if (!own) throw new ActionConflictError("Nodewatch is not running in a container");
      const m = own.Mounts?.find((x) => x.Destination === "/app/data");
      if (!m) throw new ActionConflictError("Nodewatch's data is not on a volume, so an update would lose it");
      const dataBind = m.Type === "volume" && m.Name ? `${m.Name}:/app/data` : `${m.Source}:/app/data`;
      await this.ctx.docker.pullUpdateImage();
      await this.ctx.docker.startUpdater(own.Id, dataBind);
      this.actions.log(actor, "update", this.ctx.cfg.NODEWATCH_IMAGE, true, `pulled ${this.ctx.cfg.NODEWATCH_IMAGE}; restarting into it`);
      return { message: "Update started. Nodewatch restarts in a few seconds and is back in about a minute." };
    } catch (err) {
      this.starting = false;
      if (!(err instanceof ActionConflictError)) this.actions.log(actor, "update", this.ctx.cfg.NODEWATCH_IMAGE, false, errMsg(err));
      throw err;
    }
  }
}
