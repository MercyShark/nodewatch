"use client";

import { useId } from "react";

/**
 * The brand mark: a heartbeat trace. `progress` (0..1) draws it; at 1 it is complete.
 * The same shape appears in the preloader, the logo and the section dividers.
 */
export function Pulse({ progress = 1, className = "", width = 120 }: { progress?: number; className?: string; width?: number }) {
  const id = useId();
  // One beat: flat, small bump, tall spike, dip, flat.
  const d = "M0 20 H28 L36 20 L42 10 L48 20 H60 L68 2 L76 38 L84 20 H120";
  const len = 180;
  return (
    <svg viewBox="0 0 120 40" width={width} height={width / 3} className={className} aria-hidden="true">
      <defs>
        <filter id={id} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <path d={d} className="pulse-path" style={{ opacity: 0.25 }} />
      <path d={d} className="pulse-path" filter={`url(#${id})`} strokeDasharray={len} strokeDashoffset={len * (1 - Math.max(0, Math.min(1, progress)))} />
    </svg>
  );
}

/** A full-width pulse line used between sections. */
export function PulseRule() {
  return (
    <div className="relative my-24 h-px w-full bg-line" aria-hidden="true">
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-ground px-4">
        <Pulse width={96} />
      </div>
    </div>
  );
}
