import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Value used for sorting; omit to make the column unsortable. */
  sort?: (row: T) => number | string | null;
  align?: "left" | "right";
  className?: string;
  /** Hide below this breakpoint to avoid horizontal scroll on phones. */
  hideBelow?: "sm" | "md" | "lg";
}

const hideCls = { sm: "hidden sm:table-cell", md: "hidden md:table-cell", lg: "hidden lg:table-cell" } as const;

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  initialSort,
  rowClassName,
  empty,
  dense,
  maxHeight,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  caption: string;
  initialSort?: { key: string; dir: "asc" | "desc" };
  rowClassName?: (row: T) => string | undefined;
  empty?: ReactNode;
  dense?: boolean;
  maxHeight?: number;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const r = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? r : -r;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="scrollbar-thin max-w-full overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-[1] bg-surface">
          <tr className="border-b border-border">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === "asc" ? "ascending" : "descending") : c.sort ? "none" : undefined;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn(
                    "px-3 py-2 text-xs font-medium tracking-wide whitespace-nowrap text-muted uppercase",
                    c.align === "right" ? "text-right" : "text-left",
                    c.hideBelow && hideCls[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() =>
                        setSort((s) =>
                          s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: "desc" },
                        )
                      }
                      className={cn(
                        "-mx-1 inline-flex min-h-8 items-center gap-1 rounded px-1 uppercase hover:text-fg",
                        c.align === "right" && "flex-row-reverse",
                        active && "text-fg",
                      )}
                    >
                      {c.header}
                      {active ? (
                        sort!.dir === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowDown className="size-3.5" aria-hidden />
                        )
                      ) : (
                        <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={rowKey(r)} className={cn("border-b border-border/60 last:border-0 hover:bg-surface-2/60", rowClassName?.(r))}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "px-3 align-middle",
                    dense ? "py-1.5" : "py-2.5",
                    c.align === "right" ? "num text-right" : "text-left",
                    c.hideBelow && hideCls[c.hideBelow],
                    c.className,
                  )}
                >
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
