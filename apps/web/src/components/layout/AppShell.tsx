import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { SPRING, useMotionOk } from "@/lib/motion";
import { Lock, LogOut, Menu, X } from "lucide-react";
import { NAV } from "./nav";
import { HeartbeatIndicator } from "./Heartbeat";
import { useUser } from "@/lib/auth";
import { useLogout, useOverview } from "@/lib/queries";
import { useLiveStream } from "@/lib/stream";
import { shortHex } from "@/lib/format";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { StatusBadge, severityTone } from "@/components/ui/status";
import { Toaster } from "@/components/ui/toaster";

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
        <rect width="32" height="32" rx="7" fill="#141D33" />
        <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-base font-bold tracking-[0.12em] text-fg">NODEWATCH</span>
    </span>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const user = useUser();
  const motionOk = useMotionOk();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV.map((g) => (
        <div key={g.label}>
          <p className="mb-1 px-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((it) => {
              const locked = it.adminOnly && user.role !== "admin";
              return (
                <li key={it.to}>
                  <NavLink
                    to={it.to}
                    end={it.to === "/"}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "relative flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-150 lg:min-h-10",
                        isActive ? "font-semibold text-fg" : "text-muted hover:bg-surface-2/60 hover:text-fg",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {/* The active background slides between items (shared layout), instead of jumping. */}
                        {isActive ? (
                          <motion.span
                            layoutId={onNavigate ? "nav-active-drawer" : "nav-active"}
                            className="absolute inset-0 rounded-lg bg-surface-2 before:absolute before:top-2 before:bottom-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary before:content-['']"
                            transition={motionOk ? SPRING : { duration: 0 }}
                            aria-hidden
                          />
                        ) : null}
                        <it.icon className="relative size-4 shrink-0" aria-hidden />
                        <span className="relative flex-1 truncate">{it.label}</span>
                        {locked ? (
                          <>
                            <Lock className="relative size-3.5 opacity-70" aria-hidden />
                            <span className="sr-only">(admin only)</span>
                          </>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserBox() {
  const user = useUser();
  const logout = useLogout();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-bg/60 p-2 pl-3">
      <div className="min-w-0 flex-1">
        <p className="num truncate text-xs text-fg" title={user.address ?? undefined}>
          {user.address ? shortHex(user.address) : "Password session"}
        </p>
        <p className="text-[11px] text-muted">
          {user.role === "admin" ? "Admin" : "Viewer (read-only)"} · {user.method === "siwe" ? "SIWE" : "password"}
        </p>
      </div>
      <IconButton label="Sign out" onClick={() => logout.mutate()} disabled={logout.isPending}>
        <LogOut className="size-4" aria-hidden />
      </IconButton>
    </div>
  );
}

function VerdictPill() {
  const { data } = useOverview();
  if (!data) return null;
  const v = data.verdict;
  return (
    <StatusBadge tone={severityTone(v.severity)} className="hidden max-w-[40ch] truncate md:inline-flex">
      <span className="truncate">{v.code === "healthy" ? "Healthy" : v.code.replace(/_/g, " ")}</span>
    </StatusBadge>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const location = useLocation();
  const first = useRef(true);
  const { data } = useOverview();
  useLiveStream(true);

  // Move focus to main content on route change (screen readers, keyboard users).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  useEffect(() => {
    const d = drawerRef.current;
    if (!d) return;
    if (drawer && !d.open) d.showModal();
    if (!drawer && d.open) d.close();
  }, [drawer]);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-[200] rounded-md bg-primary px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to main content
      </a>

      {/* Sidebar >= 1024 px */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-border bg-surface lg:flex">
        <div className="flex h-16 items-center px-5">
          <Logo />
        </div>
        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
          <NavList />
        </div>
        <div className="border-t border-border p-3">
          <p className="mb-2 px-1 text-[11px] text-muted">
            <span className="text-fg">{data?.node.instanceName ?? "Arkiv node"}</span> · Rabdi ·{" "}
            <span className="num">{data?.node.chainId ?? 7794095}</span>
          </p>
          <UserBox />
        </div>
      </aside>

      {/* Mobile drawer */}
      <dialog
        ref={drawerRef}
        aria-label="Navigation"
        onClose={() => setDrawer(false)}
        onClick={(e) => {
          if (e.target === drawerRef.current) setDrawer(false);
        }}
        className="m-0 h-dvh max-h-dvh w-[min(20rem,86vw)] max-w-none border-r border-border bg-surface p-0 text-fg backdrop:bg-black/60 lg:hidden"
      >
        {drawer ? (
          <div className="flex h-full flex-col">
            <div className="flex h-14 items-center justify-between pr-2 pl-4">
              <Logo />
              <IconButton label="Close navigation" onClick={() => setDrawer(false)}>
                <X className="size-5" aria-hidden />
              </IconButton>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <NavList onNavigate={() => setDrawer(false)} />
            </div>
            <div className="border-t border-border p-3">
              <UserBox />
            </div>
          </div>
        ) : null}
      </dialog>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/90 px-2 backdrop-blur supports-[backdrop-filter]:bg-bg/75 sm:px-4 lg:h-16 lg:px-8">
          <IconButton label="Open navigation" onClick={() => setDrawer(true)} className="lg:hidden" aria-expanded={drawer}>
            <Menu className="size-5" aria-hidden />
          </IconButton>
          <span className="lg:hidden">
            <Logo />
          </span>
          <div className="ml-auto flex min-w-0 items-center gap-3">
            <VerdictPill />
            <HeartbeatIndicator compact />
          </div>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-[1440px] px-4 py-5 outline-none sm:px-6 lg:px-8 lg:py-7">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
