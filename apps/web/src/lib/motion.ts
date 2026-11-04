import { useReducedMotion } from "framer-motion";

/** Motion tokens from CLAUDE.md 6.4 (seconds). Exit is about 65 % of enter. */
export const DUR = { micro: 0.15, standard: 0.22, complex: 0.35 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;

export function useMotionOk(): boolean {
  return !useReducedMotion();
}

const firstSeen = new Map<string, number>();
/**
 * Card entrance stagger runs only on the first load of each page in this session.
 * Time-windowed so React StrictMode's double render still sees "first".
 */
export function isFirstLoad(key: string): boolean {
  const now = Date.now();
  const seen = firstSeen.get(key);
  if (seen == null) {
    firstSeen.set(key, now);
    return true;
  }
  return now - seen < 400;
}
