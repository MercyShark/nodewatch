import { useId, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Eye, EyeOff, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import type { SessionUser } from "@nodewatch/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { signInWithEthereum, WalletError } from "@/lib/siwe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { InlineError } from "@/components/ui/feedback";
import { Toaster } from "@/components/ui/toaster";

type Step = "idle" | "connecting" | "signing" | "verifying";

function describe(e: unknown): string {
  if (e instanceof WalletError) return e.message;
  if (e instanceof ApiError && e.status === 429) return "Too many sign-in attempts. Wait a minute and try again.";
  if (e instanceof ApiError && e.status === 401)
    return e.message && e.message !== "Unauthorized" ? e.message : "The signature or nonce was rejected. Try again.";
  return errorMessage(e);
}

export function LoginPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  const pwId = useId();

  const done = (user: SessionUser) => {
    qc.setQueryData(["me"], user);
    void qc.invalidateQueries();
  };

  const siwe = async () => {
    setError(null);
    setStep("connecting");
    try {
      const user = await signInWithEthereum(setStep);
      done(user);
    } catch (e) {
      setError(describe(e));
      setStep("idle");
    }
  };

  const submitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) {
      setPwError("Enter the admin password.");
      return;
    }
    setPwBusy(true);
    setPwError(null);
    setError(null);
    try {
      const r = await api<SessionUser | { user: SessionUser }>("/auth/password", { method: "POST", body: { password } });
      done("user" in r ? r.user : r);
    } catch (err) {
      setPwError(
        err instanceof ApiError && err.status === 401 ? err.message || "Wrong password." : describe(err),
      );
    } finally {
      setPwBusy(false);
    }
  };

  const busy = step !== "idle";
  const stepText: Record<Step, string> = {
    idle: "Sign in with Ethereum",
    connecting: "Connecting wallet…",
    signing: "Sign the message in your wallet…",
    verifying: "Verifying…",
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(600px 300px at 50% 0%, rgba(59,130,246,0.16), transparent 70%), radial-gradient(500px 260px at 80% 100%, rgba(245,158,11,0.07), transparent 70%)",
        }}
      />
      <main className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <svg viewBox="0 0 32 32" className="mb-3 size-12" aria-hidden>
            <rect width="32" height="32" rx="7" fill="#141D33" />
            <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#3B82F6" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="font-display text-2xl font-bold tracking-[0.12em]">NODEWATCH</h1>
          <p className="mt-2 text-sm text-muted">
            Operations console for this Arkiv node · Rabdi (chain <span className="num">7794095</span>)
          </p>
        </div>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-2xl shadow-black/30 sm:p-6" aria-labelledby="signin-h">
          <h2 id="signin-h" className="text-lg font-semibold">
            Sign in
          </h2>
          <p className="mt-1 text-sm text-muted">
            Your wallet signs a one-time message. No transaction, no gas. Access depends on whether your address is on this
            node's admin or viewer allowlist.
          </p>

          <Button variant="primary" className="mt-5 w-full text-base" onClick={siwe} loading={busy} aria-describedby="siwe-status">
            {!busy ? <Wallet className="size-5" aria-hidden /> : null}
            {stepText[step]}
          </Button>
          <p id="siwe-status" className="sr-only" aria-live="polite">
            {busy ? stepText[step] : ""}
          </p>
          {error ? <InlineError error={error} className="mt-3" /> : null}

          <ul className="mt-4 flex flex-col gap-1.5 text-xs text-muted">
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 shrink-0 text-ok" aria-hidden />
              <span>
                Nonce is single-use and bound to <span className="num">{window.location.host}</span>
              </span>
            </li>
          </ul>

          <div className="mt-5 border-t border-border pt-4">
            <button
              type="button"
              aria-expanded={pwOpen}
              aria-controls="pw-panel"
              onClick={() => setPwOpen((o) => !o)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-sm text-muted hover:text-fg"
            >
              <ChevronRight className={`size-4 transition-transform duration-150 ${pwOpen ? "rotate-90" : ""}`} aria-hidden />
              <KeyRound className="size-4" aria-hidden />
              Use the admin password instead
            </button>
            {pwOpen ? (
              <form id="pw-panel" onSubmit={submitPassword} className="mt-2 flex flex-col gap-3" noValidate>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={pwId} className="text-sm font-medium">
                    Admin password
                  </label>
                  <div className="relative">
                    <Input
                      id={pwId}
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!pwError}
                      aria-describedby={pwError ? `${pwId}-err` : `${pwId}-hint`}
                      className="pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw((s) => !s)}
                      aria-label={showPw ? "Hide password" : "Show password"}
                      className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center text-muted hover:text-fg"
                    >
                      {showPw ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                    </button>
                  </div>
                  {pwError ? (
                    <p id={`${pwId}-err`} role="alert" className="text-xs text-[#fca5a5]">
                      {pwError}
                    </p>
                  ) : (
                    <p id={`${pwId}-hint`} className="text-xs text-muted">
                      Fallback for when no wallet is available. Grants the admin role.
                    </p>
                  )}
                </div>
                <Button type="submit" loading={pwBusy}>
                  Sign in with password
                </Button>
              </form>
            ) : null}
          </div>
        </section>
        <p className="mt-4 text-center text-xs text-muted">Sessions last 12 hours. Viewer accounts are read-only.</p>
      </main>
      <Toaster />
    </div>
  );
}
