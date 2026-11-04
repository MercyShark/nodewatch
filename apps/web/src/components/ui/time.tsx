import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { fmtDuration } from "@/lib/format";
import { useMotionOk } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** Re-render on an interval; returns Date.now(). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Seconds remaining, counted down locally from a server value captured at `fetchedAt`.
 */
export function useCountdown(secondsAtFetch: number | null | undefined, fetchedAt: number): number | null {
  const now = useNow(1000);
  if (secondsAtFetch == null) return null;
  return Math.max(0, secondsAtFetch - (now - fetchedAt) / 1000);
}

export function Countdown({
  seconds,
  fetchedAt,
  className,
}: {
  seconds: number | null | undefined;
  fetchedAt: number;
  className?: string;
}) {
  const left = useCountdown(seconds, fetchedAt);
  return (
    <span className={cn("num", className)}>
      <span className="sr-only">expires in </span>
      {left == null ? "—" : left <= 0 ? "expired" : fmtDuration(left)}
    </span>
  );
}

/** Countdown arc until a heartbeat expires (section 6.4). */
export function ExpiryRing({
  secondsLeft,
  total,
  size = 44,
  label,
}: {
  secondsLeft: number | null;
  total: number;
  size?: number;
  label: string;
}) {
  const motionOk = useMotionOk();
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const frac = secondsLeft == null ? 0 : Math.max(0, Math.min(1, secondsLeft / total));
  const color = frac > 0.5 ? "var(--ok)" : frac > 0.2 ? "var(--warn)" : "var(--crit)";
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={4} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - frac) }}
          transition={motionOk ? { duration: 1, ease: "linear" } : { duration: 0 }}
        />
      </svg>
      <span className="num absolute text-[10px] leading-none font-medium text-fg" aria-hidden>
        {secondsLeft == null ? "—" : secondsLeft >= 60 ? `${Math.floor(secondsLeft / 60)}m` : `${Math.ceil(secondsLeft)}s`}
      </span>
    </span>
  );
}
