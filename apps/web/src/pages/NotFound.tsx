import { Link } from "react-router-dom";
import { Compass } from "lucide-react";
import { EmptyState } from "@/components/ui/feedback";

export default function NotFound() {
  return (
    <div>
      <h1 className="sr-only">Page not found</h1>
      <EmptyState
        icon={<Compass />}
        title="This page does not exist"
        action={
          <Link to="/" className="mt-2 inline-flex min-h-11 items-center rounded-lg border border-border bg-surface-2 px-4 text-sm hover:bg-[#18233d]">
            Back to overview
          </Link>
        }
      >
        Check the address, or use the navigation to find what you need.
      </EmptyState>
    </div>
  );
}
