"use client";

import { useEffect, useState } from "react";

/** One timing system for the whole site. */
export const EASE = [0.16, 1, 0.3, 1] as const; // expo-out
export const DUR = { micro: 0.18, base: 0.5, slow: 0.9 } as const;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
