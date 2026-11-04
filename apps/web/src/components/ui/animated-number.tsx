import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";
import { useMotionOk } from "@/lib/motion";

/** Count-up on change with tabular nums (no layout shift). Instant under reduced motion. */
export function AnimatedNumber({
  value,
  format,
  className,
}: {
  value: number | null | undefined;
  format: (n: number | null) => string;
  className?: string;
}) {
  const motionOk = useMotionOk();
  const [shown, setShown] = useState<number | null>(value ?? null);
  const prev = useRef<number | null>(value ?? null);
  useEffect(() => {
    const to = value ?? null;
    const from = prev.current;
    prev.current = to;
    if (to == null || from == null || !motionOk || from === to) {
      setShown(to);
      return;
    }
    const controls = animate(from, to, {
      duration: 0.35,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setShown(v),
    });
    return () => controls.stop();
  }, [value, motionOk]);
  return <span className={className ? `num ${className}` : "num"}>{format(shown)}</span>;
}
