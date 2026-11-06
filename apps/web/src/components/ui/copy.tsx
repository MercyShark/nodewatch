import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { cn } from "@/lib/cn";
import { shortHex } from "@/lib/format";

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
      className={cn(
        "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg lg:size-8",
        className,
      )}
    >
      {copied ? <Check className="size-4 text-ok" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied to clipboard" : ""}
      </span>
    </button>
  );
}

/** Address / hash in mono with copy and optional explorer link. */
export function Hex({
  value,
  href,
  head = 6,
  tail = 4,
  full = false,
  className,
  copy = true,
}: {
  value: string | null | undefined;
  href?: string | null;
  head?: number;
  tail?: number;
  full?: boolean;
  className?: string;
  copy?: boolean;
}) {
  if (!value) return <span className="num text-muted">—</span>;
  const shown = full ? value : shortHex(value, head, tail);
  return (
    <span className={cn("inline-flex max-w-full min-w-0 items-center gap-0.5 align-middle", className)}>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          title={value}
          className="num inline-flex min-w-0 items-center gap-1 truncate text-sm text-link underline-offset-2 hover:underline"
        >
          <span className="truncate">{shown}</span>
          <ExternalLink className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <span className="num truncate text-sm" title={value}>
          {shown}
        </span>
      )}
      {copy ? <CopyButton text={value} label={`Copy ${value}`} /> : null}
    </span>
  );
}
