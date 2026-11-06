import { useEffect, useId, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Eye, EyeOff, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import type { SessionUser } from "@nodewatch/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { signInWithEthereum, WalletError } from "@/lib/siwe";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/form";
import { InlineError } from "@/components/ui/feedback";
import { Toaster } from "@/components/ui/toaster";
import { shortHex } from "@/lib/format";

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
  const [walletOpen, setWalletOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);
  // From the 401 body of /api/auth/me: the node's provider-signed admin authorisation, if install.sh created one.
  const [node, setNode] = useState<{ provider: string; admin: string; instanceName: string | null } | null>(null);
  // Sign-in methods the server enabled. Until known, offer both.
  const [methods, setMethods] = useState<{ siwe: boolean; password: boolean }>({
    siwe: true,
    password: true,
  });
  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((b: { methods?: { siwe?: boolean; password?: boolean }; node?: { provider: string; admin: string; instanceName: string | null } | null }) => {
        if (alive && b.node) setNode(b.node);
        if (alive && b.methods)
          setMethods({
            siwe: b.methods.siwe !== false,
            password: b.methods.password !== false,
          });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const walletOnly = !methods.password;
  const pwId = useId();
  const userId = useId();

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
    if (!username || !password) {
      setPwError("Enter your username and password.");
      return;
    }
    setPwBusy(true);
    setPwError(null);
    setError(null);
    try {
      const r = await api<SessionUser | { user: SessionUser }>("/auth/password", { method: "POST", body: { username, password } });
      done("user" in r ? r.user : r);
    } catch (err) {
      setPwError(err instanceof ApiError && err.status === 401 ? "Wrong username or password." : describe(err));
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

  const walletPanel = (
    <div id="wallet-panel">
      <p className="text-xs text-muted">
        Signs a one-time message. No transaction, no gas.{" "}
        {node ? `Admin: ${shortHex(node.admin)}.` : "Allowlisted wallets only."}
      </p>
      <Button className="mt-3 w-full text-base" variant={walletOnly ? "primary" : undefined} onClick={siwe} loading={busy} aria-describedby="siwe-status">
        {!busy ? <Wallet className="size-5" aria-hidden /> : null}
        {stepText[step]}
      </Button>
      <p id="siwe-status" className="sr-only" aria-live="polite">
        {busy ? stepText[step] : ""}
      </p>
      {error ? <InlineError error={error} className="mt-3" /> : null}
    </div>
  );

  return (
    <div className="relative grid min-h-dvh place-items-center px-4 py-10">
      <main className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <svg viewBox="0 0 32 32" className="mb-3 size-12" aria-hidden>
            <rect width="32" height="32" rx="8" fill="#8fb4e3" />
            <path d="M4 17h6l3-8 5 15 3-7h7" fill="none" stroke="#0d1a33" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <h1 className="text-2xl font-bold tracking-[-0.02em]">Nodewatch</h1>
          <p className="mt-2 text-sm text-muted">
            Arkiv Rabdi · chain <span className="num">7794095</span>
          </p>
          {node ? (
            <p className="mt-3 inline-flex max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-muted">
              <ShieldCheck className="size-3.5 shrink-0 text-ok" aria-hidden />
              <span>
                Node <span className="num text-fg" title={node.provider}>{shortHex(node.provider)}</span>
                {node.instanceName ? <> ({node.instanceName})</> : null} · admin wallet{" "}
                <span className="num text-fg" title={node.admin}>{shortHex(node.admin)}</span>, signed by the provider key
              </span>
            </p>
          ) : null}
        </div>

        <section className="rounded-xl border border-border bg-surface p-5 shadow-xl shadow-black/40 sm:p-6" aria-labelledby="signin-h">
          <h2 id="signin-h" className="text-lg font-semibold">
            Sign in
          </h2>

          {walletOnly ? (
            <div className="mt-5">{walletPanel}</div>
          ) : (
            <>
              <form onSubmit={submitPassword} className="mt-5 flex flex-col gap-4" noValidate>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={userId} className="text-sm font-medium">
                    Username
                  </label>
                  <Input
                    id={userId}
                    type="text"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    aria-invalid={!!pwError}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={pwId} className="text-sm font-medium">
                    Password
                  </label>
                  <div className="relative">
                    <Input
                      id={pwId}
                      type={showPw ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      aria-invalid={!!pwError}
                      aria-describedby={pwError ? `${pwId}-err` : undefined}
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
                    <p id={`${pwId}-err`} role="alert" className="text-xs text-crit">
                      {pwError}
                    </p>
                  ) : null}
                </div>
                <Button type="submit" variant="primary" className="w-full text-base" loading={pwBusy}>
                  {!pwBusy ? <KeyRound className="size-5" aria-hidden /> : null}
                  Sign in
                </Button>
              </form>

              <div className="mt-5 border-t border-border pt-4">
                <button
                  type="button"
                  aria-expanded={walletOpen}
                  aria-controls="wallet-panel"
                  onClick={() => setWalletOpen((o) => !o)}
                  className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left text-sm text-muted hover:text-fg"
                >
                  <ChevronRight className={`size-4 transition-transform duration-150 ${walletOpen ? "rotate-90" : ""}`} aria-hidden />
                  <Wallet className="size-4" aria-hidden />
                  Sign in with a wallet instead
                </button>
                {walletOpen ? <div className="mt-2">{walletPanel}</div> : null}
              </div>
            </>
          )}
        </section>
        <p className="mt-4 text-center text-xs text-muted">
          Sessions last 12 hours.
        </p>
      </main>
      <Toaster />
    </div>
  );
}
