// Simulated /api/stream. Loaded only when VITE_MOCK === "1".
import type { AlertEvent } from "@nodewatch/shared";
import type { StreamSource } from "../lib/stream";
import * as fx from "./fixtures";
import { scenarioListeners } from "./state";

const RULES: [string, AlertEvent["severity"], string][] = [
  ["RPCLatencyHigh", "warning", "arkiv_query p95 1.3 s over the last 5 m (threshold 1 s)."],
  ["AgreementExpiringSoon", "warning", "Agreement expires in 1 h 48 m."],
  ["HostMemoryHigh", "info", "Host memory 91 % for 2 m during a bench seed."],
];

export class MockEventSource implements StreamSource {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  private listeners = new Map<string, Set<(ev: MessageEvent) => void>>();
  private timers: ReturnType<typeof setInterval>[] = [];
  private tick = 0;
  private onScenario = () => {
    this.emit("verdict", fx.verdict());
    this.emit("containers", fx.containers());
    this.emit("kpis", fx.kpis());
  };

  constructor() {
    setTimeout(() => {
      if (this.readyState === 2) return;
      this.readyState = 1;
      this.onopen?.(new Event("open"));
      this.emit("heartbeat", fx.heartbeat());
    }, 300);
    this.timers.push(setInterval(() => this.emit("kpis", fx.kpis()), 3000));
    this.timers.push(setInterval(() => this.emit("rpc", fx.recentRequests(1 + Math.floor(Math.random() * 3), Date.now())), 1500));
    this.timers.push(setInterval(() => this.emit("containers", fx.containers()), 10_000));
    // Real heartbeats land every 30 s; the mock lands one every 12 s so the pulse is easy to see.
    this.timers.push(setInterval(() => this.emit("heartbeat", fx.heartbeat(true)), 12_000));
    this.timers.push(
      setInterval(() => {
        const [rule, severity, summary] = RULES[this.tick++ % RULES.length]!;
        const id = `al-sim-${Date.now()}`;
        const ev: AlertEvent = { id, rule, severity, status: "firing", summary, startedAt: Date.now(), resolvedAt: null };
        fx.extraAlerts.unshift(ev);
        this.emit("alert", ev);
        setTimeout(() => {
          const resolved: AlertEvent = { ...ev, status: "resolved", resolvedAt: Date.now() };
          const i = fx.extraAlerts.findIndex((a) => a.id === id);
          if (i >= 0) fx.extraAlerts[i] = resolved;
          this.emit("alert", resolved);
        }, 20_000);
      }, 75_000),
    );
    scenarioListeners.add(this.onScenario);
  }

  addEventListener(type: string, listener: (ev: MessageEvent) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  private emit(type: string, data: unknown) {
    if (this.readyState !== 1) return;
    const ev = new MessageEvent(type, { data: JSON.stringify(data) });
    this.listeners.get(type)?.forEach((l) => l(ev));
  }

  close() {
    this.readyState = 2;
    this.timers.forEach(clearInterval);
    scenarioListeners.delete(this.onScenario);
  }
}
