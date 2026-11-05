"use client";

import { useEffect, useRef, type ReactNode } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useReducedMotion } from "@/lib/motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * Reveals its children when scrolled into view. Children with `data-reveal` are staggered.
 * Everything starts visible (the page is complete at rest) and is only hidden right before it animates in.
 */
export function Reveal({ children, className = "", stagger = 0.08, y = 24 }: { children: ReactNode; className?: string; stagger?: number; y?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    if (reduced || !ref.current) return;
    const items = ref.current.querySelectorAll<HTMLElement>("[data-reveal]");
    const targets = items.length ? items : [ref.current];
    const ctx = gsap.context(() => {
      gsap.fromTo(
        targets,
        { autoAlpha: 0, y },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.9,
          ease: "expo.out",
          stagger,
          scrollTrigger: { trigger: ref.current, start: "top 85%", once: true },
        },
      );
    }, ref);
    return () => ctx.revert();
  }, [reduced, stagger, y]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
