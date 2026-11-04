import { useId, useState, type ReactNode } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/feedback";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/cn";

export interface QueryState {
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
  isFetching?: boolean;
}

/**
 * Every chart: title + units, loading skeleton, empty state, error with retry, and a table-view toggle.
 */
export function ChartCard({
  title,
  description,
  state,
  isEmpty,
  emptyText = "No samples in this range yet. Collectors write a point every 15 s.",
  chart,
  table,
  summary,
  height = 240,
  className,
  actions,
  footer,
}: {
  title: string;
  description?: ReactNode;
  state: QueryState;
  isEmpty?: boolean;
  emptyText?: ReactNode;
  chart: () => ReactNode;
  table?: () => ReactNode;
  /** Short text for screen readers describing the key insight. */
  summary?: string;
  height?: number;
  className?: string;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const id = useId();
  let body: ReactNode;
  if (state.isLoading) {
    body = (
      <div role="status" aria-label={`Loading ${title}`} style={{ height }} className="flex flex-col gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="w-full flex-1" />
      </div>
    );
  } else if (state.error) {
    body = <ErrorState error={state.error} onRetry={state.refetch} className="py-6" />;
  } else if (isEmpty) {
    body = <EmptyState title="No data yet">{emptyText}</EmptyState>;
  } else if (view === "table" && table) {
    body = <div style={{ maxHeight: Math.max(height, 260) }} className="overflow-hidden">{table()}</div>;
  } else {
    body = (
      <figure aria-labelledby={id} className="m-0">
        <div style={{ height }} className={cn("w-full transition-opacity duration-200", state.isFetching && "opacity-90")}>
          {chart()}
        </div>
        {summary ? <figcaption className="sr-only">{summary}</figcaption> : null}
      </figure>
    );
  }
  return (
    <Card className={className}>
      <CardHeader
        id={id}
        title={title}
        description={description}
        actions={
          <>
            {actions}
            {table ? (
              <Segmented
                size="sm"
                label={`${title}: view as`}
                value={view}
                onChange={setView}
                options={[
                  { value: "chart", label: <BarChart3 className="size-4" aria-hidden />, ariaLabel: "Chart view" },
                  { value: "table", label: <Table2 className="size-4" aria-hidden />, ariaLabel: "Table view" },
                ]}
              />
            ) : null}
          </>
        }
      />
      <CardBody>{body}</CardBody>
      {footer}
    </Card>
  );
}
