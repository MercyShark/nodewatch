import { Link } from "react-router-dom";
import { ArrowUpCircle } from "lucide-react";
import { useIsAdmin } from "@/lib/auth";
import { useUpdateState } from "@/lib/queries";

/** Top-bar notice for admins when a newer Nodewatch image is published. It only tells; it never updates. */
export function UpdatePill() {
  const admin = useIsAdmin();
  const q = useUpdateState(admin);
  if (!admin || !q.data?.updateAvailable) return null;
  return (
    <Link
      to="/settings#update"
      className="hidden items-center gap-1.5 rounded-full border border-warn/50 px-3 py-1 text-xs font-medium whitespace-nowrap text-fg transition-colors hover:border-warn sm:inline-flex"
    >
      <ArrowUpCircle className="size-3.5 text-warn" aria-hidden /> Update available
    </Link>
  );
}
