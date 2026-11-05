"use client";

import { useRef, type ReactNode, type MouseEvent } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "motion/react";
import { useReducedMotion } from "@/lib/motion";

/** A card that tilts a few degrees toward the cursor, with a soft light that follows it. */
export function Tilt({ children, className = "" }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rx = useSpring(useTransform(py, [0, 1], [5, -5]), { stiffness: 180, damping: 20 });
  const ry = useSpring(useTransform(px, [0, 1], [-5, 5]), { stiffness: 180, damping: 20 });
  const glow = useTransform([px, py], ([x, y]) => `radial-gradient(360px circle at ${(x as number) * 100}% ${(y as number) * 100}%, rgba(90,209,255,0.12), transparent 60%)`);

  const onMove = (e: MouseEvent) => {
    if (reduced || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width);
    py.set((e.clientY - r.top) / r.height);
  };
  const reset = () => {
    px.set(0.5);
    py.set(0.5);
  };

  return (
    <motion.div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={reset}
      style={reduced ? undefined : { rotateX: rx, rotateY: ry, transformStyle: "preserve-3d", perspective: 900 }}
      className={`relative ${className}`}
    >
      {!reduced && <motion.div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glow }} aria-hidden="true" />}
      {children}
    </motion.div>
  );
}
