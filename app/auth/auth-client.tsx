"use client";

import { useState, type FormEvent } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

export default function AuthClientPage({ githubEnabled, callbackFailed, embedded = false, onAuthenticated, callbackURL = "/" }: { githubEnabled: boolean; callbackFailed: boolean; embedded?: boolean; onAuthenticated?: () => void; callbackURL?: string }) {
  const router = useRouter();
  const [isSignIn, setIsSignIn] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<"email" | "github" | "guest" | null>(null);
  const [error, setError] = useState(callbackFailed ? "GitHub sign-in did not finish. Please try again." : "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending("email"); setError("");
    try {
      const result = isSignIn
        ? await signIn.email({ email, password, callbackURL })
        : await signUp.email({ name: name.trim(), email, password, callbackURL });
      if (result.error) setError(isSignIn ? "Unable to sign in. Check your email and password." : "Unable to create an account. Check your details or sign in.");
      else { if (onAuthenticated) onAuthenticated(); else router.replace(callbackURL); router.refresh(); }
    } catch { setError("Authentication is unavailable. Please try again."); }
    finally { setPending(null); }
  }

  async function github() {
    if (pending) return;
    setPending("github"); setError("");
    try {
      const result = await signIn.social({ provider: "github", callbackURL, errorCallbackURL: "/?authError=1" });
      if (result.error) { setError("Unable to start GitHub sign-in. Please try again."); setPending(null); }
    } catch { setError("Unable to start GitHub sign-in. Please try again."); setPending(null); }
  }

  async function guest() {
    if (pending) return;
    setPending("guest"); setError("");
    try {
      const result = await signIn.anonymous();
      if (result.error) setError("Unable to start a guest workspace. Please try again.");
      else { if (onAuthenticated) onAuthenticated(); else router.replace(callbackURL); router.refresh(); }
    } catch { setError("Unable to start a guest workspace. Please try again."); }
    finally { setPending(null); }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-(--ad-border) bg-(--ad-surface) px-4 py-3 text-(--ad-text) outline-none focus:border-(--ad-model)";
  return (
    <section className={embedded ? "w-full text-left" : "mx-auto my-10 w-full max-w-md rounded-3xl border border-(--ad-border) bg-(--ad-surface) p-8 shadow-xl"}>
      <h1 className="text-2xl font-semibold">{isSignIn ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-2 text-sm text-(--ad-muted)">{isSignIn ? "Sign in to save, run, test, and monitor your agents." : "Create your personal Agent Depot workspace."}</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-(--ad-error-border) bg-(--ad-error-bg) p-3 text-sm text-(--ad-error)">{error}</p>}
      <button type="button" onClick={github} disabled={!!pending || !githubEnabled}
        className="mt-6 w-full rounded-xl border border-(--ad-border) px-4 py-3 font-medium hover:bg-(--ad-raised) disabled:cursor-not-allowed disabled:opacity-50">
        {pending === "github" ? "Opening GitHub…" : "Continue with GitHub"}
      </button>
      {!githubEnabled && <p className="mt-2 text-xs text-(--ad-muted)">GitHub sign-in is not configured yet. Email sign-in is available.</p>}
      <button type="button" onClick={guest} disabled={!!pending} className="mt-3 w-full rounded-xl border border-(--ad-border) px-4 py-3 font-medium text-(--ad-model) hover:bg-(--ad-text)/10 disabled:opacity-50">
        {pending === "guest" ? "Creating guest workspace…" : "Continue as guest"}
      </button>
      <p className="mt-2 text-xs text-(--ad-muted)">Try all agent features in your own guest workspace. Sign out ends access to this guest session.</p>
      <p className="my-5 text-center text-xs uppercase tracking-wide text-(--ad-muted)">Or use email</p>
      <form onSubmit={submit} className="space-y-4" aria-busy={!!pending}>
        {!isSignIn && <label className="block text-sm text-(--ad-text)" htmlFor="name">Name
          <input id="name" name="name" autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>}
        <label className="block text-sm text-(--ad-text)" htmlFor="email">Email
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>
        <label className="block text-sm text-(--ad-text)" htmlFor="password">Password
          <input id="password" name="password" type="password" autoComplete={isSignIn ? "current-password" : "new-password"} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>
        {!isSignIn && <p className="text-xs text-(--ad-muted)">Use at least 8 characters.</p>}
        <button type="submit" disabled={!!pending} className="w-full rounded-xl bg-(--ad-text) px-4 py-3 font-semibold text-(--ad-bg) hover:opacity-90 disabled:opacity-50">
          {pending === "email" ? (isSignIn ? "Signing in…" : "Creating account…") : (isSignIn ? "Sign in" : "Create account")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-(--ad-muted)">{isSignIn ? "Need an account?" : "Already registered?"}{" "}
        <button type="button" disabled={!!pending} onClick={() => { setIsSignIn(!isSignIn); setName(""); setPassword(""); setError(""); }} className="font-medium text-(--ad-model) hover:underline disabled:opacity-50">
          {isSignIn ? "Sign up" : "Sign in"}
        </button>
      </p>
    </section>
  );
}
