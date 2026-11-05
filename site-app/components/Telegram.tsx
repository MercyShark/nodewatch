import { Bot } from "lucide-react";

/** One real alert, as the bot sends it. */
export function Telegram() {
  return (
    <div className="r-one max-w-xl border border-soft bg-paper p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="r-one inline-flex size-9 items-center justify-center bg-mist text-ink" aria-hidden>
          <Bot className="size-5" strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink">Nodewatch</p>
          <p className="text-xs text-ink/70">bot</p>
        </div>
        <time className="font-mono text-xs text-ink/70" dateTime="2026-11-05T14:12:00+05:30">
          14:12
        </time>
      </div>
      <div className="mt-4 space-y-2 text-[15px] leading-relaxed text-ink">
        <p>
          <span className="font-medium">fra-01 is behind.</span> Head lag <span className="font-mono">14 blocks</span> for 5 min, peers{" "}
          <span className="font-mono">9</span>.
        </p>
        <p>
          Verdict: <span className="font-medium">lagging</span>. Catch-up at this rate: <span className="font-mono">~6 min</span>.
        </p>
        <p className="text-ink/80">
          Fix: <code className="font-mono text-[14px]">./setup.sh --refresh</code> if peers stay low.
        </p>
      </div>
    </div>
  );
}
