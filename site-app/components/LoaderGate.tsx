"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";
import { Loader } from "./Loader";

const Ready = createContext(true);
/** True once the loader has finished (or was skipped). Sections wait for it before animating in. */
export const useReady = () => useContext(Ready);

export function LoaderGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const done = useCallback(() => setReady(true), []);
  return (
    // reducedMotion="user": motion drops movement for visitors who ask for less, without a branch in every component
    // (branching on it during render made the server HTML and the first client render disagree).
    <MotionConfig reducedMotion="user">
      <Ready.Provider value={ready}>
        <Loader onDone={done} />
        {children}
      </Ready.Provider>
    </MotionConfig>
  );
}
