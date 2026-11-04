import { createContext, useContext, type ReactNode } from "react";
import { Lock } from "lucide-react";
import type { SessionUser } from "@nodewatch/shared";

const AuthCtx = createContext<SessionUser | null>(null);

export function AuthProvider({ user, children }: { user: SessionUser; children: ReactNode }) {
  return <AuthCtx.Provider value={user}>{children}</AuthCtx.Provider>;
}

export function useUser(): SessionUser {
  const u = useContext(AuthCtx);
  if (!u) throw new Error("useUser outside AuthProvider");
  return u;
}

export const useIsAdmin = () => useUser().role === "admin";

/** Renders children for admins; viewers get an explanation instead of a silently missing control. */
export function AdminOnly({ children, fallback }: { children: ReactNode; fallback?: ReactNode | null }) {
  const admin = useIsAdmin();
  if (admin) return <>{children}</>;
  if (fallback === null) return null;
  return (
    <>
      {fallback ?? (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted">
          <Lock className="size-3.5" aria-hidden /> Admin only
        </span>
      )}
    </>
  );
}
