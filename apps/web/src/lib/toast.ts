import { createStore } from "./store";

export type ToastTone = "ok" | "info" | "warn" | "crit";
export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

export const toastStore = createStore<Toast[]>([]);
let nextId = 1;

export function pushToast(t: Omit<Toast, "id">) {
  const id = nextId++;
  toastStore.set((list) => [...list.slice(-3), { ...t, id }]);
  setTimeout(() => dismissToast(id), 4000);
}

export function dismissToast(id: number) {
  toastStore.set((list) => list.filter((t) => t.id !== id));
}
