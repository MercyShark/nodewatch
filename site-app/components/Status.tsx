import { ArrowUp, Clock, ArrowDown } from "lucide-react";

export type StatusWord = "Up" | "Slow" | "Down";

/** Status is always the word. Up is Action blue, Slow is Ink, Down is the one red, each with its own glyph. */
export function Status({ value }: { value: StatusWord }) {
  const cls = value === "Up" ? "text-action" : value === "Down" ? "text-down" : "text-ink";
  const Icon = value === "Up" ? ArrowUp : value === "Down" ? ArrowDown : Clock;
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${cls}`}>
      <Icon className="size-4" strokeWidth={1.5} aria-hidden />
      {value}
    </span>
  );
}
