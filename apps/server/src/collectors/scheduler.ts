// Runs periodic jobs with timeouts. A job never throws into the event loop and never overlaps itself.
import type { Ctx } from "../context.js";
import { errMsg, withTimeout } from "../util/http.js";

export interface Job {
  name: string;
  intervalMs: number;
  timeoutMs: number;
  initialDelayMs?: number;
  run: () => Promise<void>;
}

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private running = new Set<string>();
  private stopped = false;

  constructor(private readonly ctx: Ctx) {}

  add(job: Job): void {
    const tick = async () => {
      if (this.stopped || this.running.has(job.name)) return;
      this.running.add(job.name);
      const st = (this.ctx.state.collectors[job.name] ??= { lastRun: null, lastSuccess: null, lastError: null, lastErrorAt: null });
      st.lastRun = Date.now();
      try {
        await withTimeout(job.run(), job.timeoutMs, job.name);
        st.lastSuccess = Date.now();
        st.lastError = null;
      } catch (err) {
        st.lastError = errMsg(err);
        st.lastErrorAt = Date.now();
        this.ctx.log.debug({ job: job.name, err: st.lastError }, "job failed");
      } finally {
        this.running.delete(job.name);
      }
    };
    const start = setTimeout(() => {
      void tick();
      const iv = setInterval(() => void tick(), job.intervalMs);
      iv.unref();
      this.timers.push(iv);
    }, job.initialDelayMs ?? 0);
    start.unref();
    this.timers.push(start);
  }

  /** Run a job now (used at boot so the first API call has data). */
  async runNow(job: Job): Promise<void> {
    const st = (this.ctx.state.collectors[job.name] ??= { lastRun: null, lastSuccess: null, lastError: null, lastErrorAt: null });
    st.lastRun = Date.now();
    try {
      await withTimeout(job.run(), job.timeoutMs, job.name);
      st.lastSuccess = Date.now();
      st.lastError = null;
    } catch (err) {
      st.lastError = errMsg(err);
      st.lastErrorAt = Date.now();
    }
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers = [];
  }
}
