import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AlertEvent, ContainerState, HeartbeatState, Kpis, Overview, StreamEvent, Verdict } from "@nodewatch/shared";
import { createStore } from "./store";
import { pushToast } from "./toast";

export type StreamStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface LiveState {
  status: StreamStatus;
  lastEventAt: number | null;
  /** Increments when a heartbeat transaction lands (new lastTxHash). Drives the pulse. */
  heartbeatBeat: number;
  lastHeartbeatTx: string | null;
}

export const liveStore = createStore<LiveState>({
  status: "connecting",
  lastEventAt: null,
  heartbeatBeat: 0,
  lastHeartbeatTx: null,
});

/** Anything that looks like an EventSource; the mock implements the same surface. */
export interface StreamSource {
  addEventListener(type: string, listener: (ev: MessageEvent) => void): void;
  close(): void;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  readyState: number;
}

const EVENTS: StreamEvent["event"][] = ["verdict", "kpis", "heartbeat", "alert", "containers"];

function patchOverview(qc: QueryClient, patch: (o: Overview) => Overview) {
  qc.setQueryData<Overview>(["overview"], (old) => (old ? patch(old) : old));
}

export function applyStreamEvent(qc: QueryClient, ev: StreamEvent) {
  const now = Date.now();
  liveStore.set((s) => ({ ...s, lastEventAt: now }));
  switch (ev.event) {
    case "verdict": {
      const v: Verdict = ev.data;
      patchOverview(qc, (o) => ({ ...o, verdict: v, updatedAt: now }));
      break;
    }
    case "kpis": {
      const k: Kpis = ev.data;
      patchOverview(qc, (o) => ({ ...o, kpis: k, updatedAt: now }));
      break;
    }
    case "containers": {
      const c: ContainerState[] = ev.data;
      patchOverview(qc, (o) => ({ ...o, containers: c, updatedAt: now }));
      break;
    }
    case "heartbeat": {
      const h: HeartbeatState = ev.data;
      const prevTx = liveStore.get().lastHeartbeatTx;
      const landed = !!h.lastTxHash && h.lastTxHash !== prevTx;
      liveStore.set((s) => ({
        ...s,
        lastHeartbeatTx: h.lastTxHash,
        heartbeatBeat: landed && prevTx !== null ? s.heartbeatBeat + 1 : s.heartbeatBeat,
      }));
      patchOverview(qc, (o) => ({ ...o, heartbeat: h }));
      if (landed) void qc.invalidateQueries({ queryKey: ["fleet"] });
      break;
    }
    case "alert": {
      const a: AlertEvent = ev.data;
      patchOverview(qc, (o) => {
        const rest = o.recentAlerts.filter((x) => x.id !== a.id);
        return { ...o, recentAlerts: [a, ...rest].slice(0, 10) };
      });
      void qc.invalidateQueries({ queryKey: ["alerts"] });
      pushToast({
        tone: a.status === "resolved" ? "ok" : a.severity === "critical" ? "crit" : a.severity === "warning" ? "warn" : "info",
        title: `${a.status === "resolved" ? "Resolved" : "Firing"}: ${a.rule}`,
        body: a.summary,
      });
      break;
    }
  }
}

async function openSource(): Promise<StreamSource> {
  if (import.meta.env.VITE_MOCK === "1") {
    const { MockEventSource } = await import("../mock/stream");
    return new MockEventSource();
  }
  return new EventSource("/api/stream", { withCredentials: true }) as unknown as StreamSource;
}

/** Connect to /api/stream once (mounted in the app shell); reconnects with backoff. */
export function useLiveStream(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let src: StreamSource | null = null;
    let cancelled = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = async () => {
      liveStore.set((s) => ({ ...s, status: retry === 0 ? "connecting" : "reconnecting" }));
      const s = await openSource();
      if (cancelled) {
        s.close();
        return;
      }
      src = s;
      s.onopen = () => {
        retry = 0;
        liveStore.set((st) => ({ ...st, status: "open" }));
      };
      s.onerror = () => {
        // Native EventSource retries by itself while readyState is CONNECTING (0).
        if (s.readyState === 2) {
          s.close();
          liveStore.set((st) => ({ ...st, status: "reconnecting" }));
          retry++;
          timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry));
        } else {
          liveStore.set((st) => ({ ...st, status: "reconnecting" }));
        }
      };
      for (const name of EVENTS) {
        s.addEventListener(name, (msg: MessageEvent) => {
          try {
            const data = JSON.parse(String(msg.data));
            applyStreamEvent(qc, { event: name, data } as StreamEvent);
          } catch {
            /* ignore malformed frames */
          }
        });
      }
    };
    void connect();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      src?.close();
      liveStore.set((st) => ({ ...st, status: "closed" }));
    };
  }, [enabled, qc]);
}
