import { lazy, Suspense, type ComponentType } from "react";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { EASE_IN, EASE_OUT, useMotionOk } from "@/lib/motion";
import { AppShell } from "@/components/layout/AppShell";
import { AuthProvider } from "@/lib/auth";
import { useMe } from "@/lib/queries";
import { ErrorState, Skeleton } from "@/components/ui/feedback";
import { LoginPage } from "@/pages/Login";

const page = (f: () => Promise<{ default: ComponentType }>) => lazy(f);
const Overview = page(() => import("@/pages/Overview"));
const Resources = page(() => import("@/pages/Resources"));
const Chain = page(() => import("@/pages/Chain"));
const Pool = page(() => import("@/pages/Pool"));
const Rpc = page(() => import("@/pages/Rpc"));
const Queries = page(() => import("@/pages/Queries"));
const Fleet = page(() => import("@/pages/Fleet"));
const SlowQueries = page(() => import("@/pages/SlowQueries"));
const Alerts = page(() => import("@/pages/Alerts"));
const Backups = page(() => import("@/pages/Backups"));
const Vault = page(() => import("@/pages/Vault"));
const Settings = page(() => import("@/pages/Settings"));
const NotFound = page(() => import("@/pages/NotFound"));

// Compiled out unless VITE_MOCK=1.
const MockPanel = import.meta.env.VITE_MOCK === "1" ? lazy(() => import("@/mock/MockPanel")) : null;

function PageFallback() {
  return (
    <div role="status" aria-label="Loading page" className="flex flex-col gap-4">
      <Skeleton className="h-7 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-72" />
    </div>
  );
}

/** Page crossfade on route change: 180 ms in (rise 6 px), 110 ms out. Instant under reduced motion. */
function PageTransition({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const motionOk = useMotionOk();
  if (!motionOk) return <>{children}</>;
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0, transition: { duration: 0.18, ease: EASE_OUT } }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.11, ease: EASE_IN } }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function Gate() {
  const me = useMe();
  if (me.isLoading) {
    return (
      <div className="grid min-h-dvh place-items-center" role="status" aria-label="Checking session">
        <Skeleton className="h-10 w-56" />
      </div>
    );
  }
  if (me.error) {
    return (
      <div className="grid min-h-dvh place-items-center px-4">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} title="Cannot reach Nodewatch" />
      </div>
    );
  }
  if (!me.data) return <LoginPage />;
  return (
    <AuthProvider user={me.data}>
      <AppShell>
        <Suspense fallback={<PageFallback />}>
          <PageTransition>
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/chain" element={<Chain />} />
            <Route path="/pool" element={<Pool />} />
            <Route path="/rpc" element={<Rpc />} />
            <Route path="/queries" element={<Queries />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/slow-queries" element={<SlowQueries />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/backups" element={<Backups />} />
            <Route path="/vault" element={<Vault />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </PageTransition>
        </Suspense>
      </AppShell>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Gate />
      {MockPanel ? (
        <Suspense fallback={null}>
          <MockPanel />
        </Suspense>
      ) : null}
    </BrowserRouter>
  );
}
