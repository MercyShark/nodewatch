// Mock-mode control panel (role switch + scenario). Only loaded when VITE_MOCK === "1".
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FlaskConical, X } from "lucide-react";
import { useStore } from "../lib/store";
import { mockStore, setScenario, type Scenario } from "./state";
import { Segmented } from "../components/ui/segmented";

const SCENARIOS: { value: Scenario; label: string }[] = [
  { value: "healthy", label: "Healthy" },
  { value: "lagging", label: "Lagging" },
  { value: "tunnel_down", label: "Tunnel down" },
  { value: "disk_low", label: "Disk filling" },
  { value: "container_down", label: "Container down" },
  { value: "no_agreement", label: "No agreement" },
];

export default function MockPanel() {
  const qc = useQueryClient();
  const state = useStore(mockStore);
  const [open, setOpen] = useState(false);

  const refresh = () => void qc.invalidateQueries();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open mock controls"
        className="fixed bottom-3 left-3 z-[90] inline-flex min-h-11 items-center gap-1.5 rounded-full border border-accent/60 bg-surface px-3 text-xs font-semibold text-accent shadow-lg lg:left-auto lg:right-3"
      >
        <FlaskConical className="size-4" aria-hidden />
        MOCK · {state.role}
      </button>
    );
  }

  return (
    <section
      aria-label="Mock controls"
      className="fixed right-3 bottom-3 left-3 z-[90] rounded-xl border border-accent/50 bg-surface-2 p-4 shadow-xl shadow-navy/20 sm:left-auto sm:w-80"
    >
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-accent">
          <FlaskConical className="size-4" aria-hidden /> Mock mode
        </p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close mock controls"
          className="inline-flex size-9 items-center justify-center rounded-md text-muted hover:text-fg"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <p className="mb-1.5 text-xs text-muted">Preview role</p>
      <Segmented
        label="Preview role"
        value={state.role}
        onChange={(role) => {
          mockStore.set((s) => ({ ...s, role }));
          refresh();
        }}
        options={[
          { value: "admin", label: "Admin" },
          { value: "viewer", label: "Viewer" },
        ]}
      />
      <label htmlFor="mock-scenario" className="mt-3 mb-1.5 block text-xs text-muted">
        Node scenario (verdict, alerts, charts)
      </label>
      <select
        id="mock-scenario"
        value={state.scenario}
        onChange={(e) => {
          setScenario(e.target.value as Scenario);
          refresh();
        }}
        className="min-h-11 w-full rounded-lg border border-border bg-bg px-3 text-sm text-fg"
      >
        {SCENARIOS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <p className="mt-3 text-xs text-muted">
        Simulated SSE: KPIs every 3 s, a heartbeat every 12 s, an alert every 75 s. Password for the login form: <code className="num">nodewatch</code>.
      </p>
    </section>
  );
}
