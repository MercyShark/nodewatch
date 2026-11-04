import { useState, type ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { Lock } from "lucide-react";
import { Card, CardBody } from "@/components/ui/card";
import { useUser } from "@/lib/auth";
import { DUR, EASE_OUT, isFirstLoad, useMotionOk } from "@/lib/motion";
import { cn } from "@/lib/cn";

const container: Variants = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };
const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.standard, ease: EASE_OUT } },
};

/** 40 ms card stagger on the first load of a page only (CLAUDE.md 6.4). */
export function Stagger({ page, className, children }: { page: string; className?: string; children: ReactNode }) {
  const [first] = useState(() => isFirstLoad(page));
  const motionOk = useMotionOk();
  return (
    <motion.div className={className} variants={container} initial={first && motionOk ? "hidden" : false} animate="show">
      {children}
    </motion.div>
  );
}

export function StaggerItem({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <motion.div className={cn("min-w-0", className)} variants={item}>
      {children}
    </motion.div>
  );
}

/** Explains why a viewer cannot see an admin-only page (instead of silently hiding it). */
export function AdminOnlyPanel({ what, children }: { what: string; children?: ReactNode }) {
  const user = useUser();
  return (
    <Card>
      <CardBody className="flex flex-col items-start gap-3 pt-5 sm:flex-row sm:items-center">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted">
          <Lock className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">Admin only</h2>
          <p className="mt-0.5 text-sm text-muted">
            {what} You are signed in as a <span className="text-fg">{user.role}</span>, which has a read-only view.
            {children}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
