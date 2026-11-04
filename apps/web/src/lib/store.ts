import { useSyncExternalStore } from "react";

/** Minimal external store (no extra dependency). */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((prev: T) => T)) {
      state = typeof next === "function" ? (next as (p: T) => T)(state) : next;
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function useStore<T, S = T>(store: ReturnType<typeof createStore<T>>, select?: (s: T) => S): S {
  return useSyncExternalStore(
    store.subscribe,
    () => (select ? select(store.get()) : (store.get() as unknown as S)),
  );
}
