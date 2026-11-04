import { useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { DUR, EASE_OUT, isFirstLoad, useMotionOk } from "@/lib/motion";

/** True only on the first visit of a page in this session (drives the 40 ms card stagger). */
export function useFirstLoad(key: string): boolean {
  const [first] = useState(() => isFirstLoad(key));
  return first;
}

/** Card entrance: fade + 8 px rise, 40 ms stagger, first load only, none under reduced motion. */
export function StaggerItem({
  index,
  first,
  children,
  className,
}: {
  index: number;
  first: boolean;
  children: ReactNode;
  className?: string;
}) {
  const motionOk = useMotionOk();
  if (!first || !motionOk) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.standard, ease: EASE_OUT, delay: index * 0.04 }}
    >
      {children}
    </motion.div>
  );
}
