// Mock-only state. This module is reachable only through `import.meta.env.VITE_MOCK === "1"` branches,
// so production builds never include it.
import type { Role } from "@nodewatch/shared";
import { createStore } from "../lib/store";

export type Scenario = "healthy" | "lagging" | "tunnel_down" | "disk_low" | "container_down" | "no_agreement";

export interface MockState {
  role: Role;
  loggedIn: boolean;
  scenario: Scenario;
}

function load(): MockState {
  const get = (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  };
  return {
    role: get("nw-mock-role") === "viewer" ? "viewer" : "admin",
    loggedIn: get("nw-mock-auth") !== "0",
    scenario: (get("nw-mock-scenario") as Scenario | null) ?? "healthy",
  };
}

export const mockStore = createStore<MockState>(load());

mockStore.subscribe(() => {
  const s = mockStore.get();
  try {
    localStorage.setItem("nw-mock-role", s.role);
    localStorage.setItem("nw-mock-auth", s.loggedIn ? "1" : "0");
    localStorage.setItem("nw-mock-scenario", s.scenario);
  } catch {
    /* storage unavailable */
  }
});

/** Listeners for scenario changes (the mock SSE emits a verdict event). */
export const scenarioListeners = new Set<() => void>();
export function setScenario(s: Scenario) {
  mockStore.set((st) => ({ ...st, scenario: s }));
  scenarioListeners.forEach((l) => l());
}
