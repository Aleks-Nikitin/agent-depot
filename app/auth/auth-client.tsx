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
      const result = await signIn.social({ provider: "github", callbackURL, errorCallbackURL: "/auth?error=oauth" });
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

  const inputClass = "mt-2 w-full rounded-xl border border-white/15 bg-zinc-950 px-4 py-3 text-white outline-none focus:border-sky-400";
  return (
    <section className={embedded ? "w-full text-left" : "mx-auto my-10 w-full max-w-md rounded-3xl border border-white/10 bg-zinc-900 p-8 shadow-xl"}>
      <h1 className="text-2xl font-semibold">{isSignIn ? "Welcome back" : "Create your account"}</h1>
      <p className="mt-2 text-sm text-zinc-400">{isSignIn ? "Sign in to save, run, test, and monitor your agents." : "Create your personal Agent Depot workspace."}</p>
      {error && <p role="alert" className="mt-5 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
      <button type="button" onClick={github} disabled={!!pending || !githubEnabled}
        className="mt-6 w-full rounded-xl border border-white/20 px-4 py-3 font-medium hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50">
        {pending === "github" ? "Opening GitHub…" : "Continue with GitHub"}
      </button>
      {!githubEnabled && <p className="mt-2 text-xs text-zinc-400">GitHub sign-in is not configured yet. Email sign-in is available.</p>}
      <button type="button" onClick={guest} disabled={!!pending} className="mt-3 w-full rounded-xl border border-sky-300/40 px-4 py-3 font-medium text-sky-200 hover:bg-sky-300/10 disabled:opacity-50">
        {pending === "guest" ? "Creating guest workspace…" : "Continue as guest"}
      </button>
      <p className="mt-2 text-xs text-zinc-400">Try all agent features in your own guest workspace. Sign out ends access to this guest session.</p>
      <p className="my-5 text-center text-xs uppercase tracking-wide text-zinc-500">Or use email</p>
      <form onSubmit={submit} className="space-y-4" aria-busy={!!pending}>
        {!isSignIn && <label className="block text-sm text-zinc-300" htmlFor="name">Name
          <input id="name" name="name" autoComplete="name" required maxLength={100} value={name} onChange={e => setName(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>}
        <label className="block text-sm text-zinc-300" htmlFor="email">Email
          <input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>
        <label className="block text-sm text-zinc-300" htmlFor="password">Password
          <input id="password" name="password" type="password" autoComplete={isSignIn ? "current-password" : "new-password"} required minLength={8} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} disabled={!!pending} className={inputClass} />
        </label>
        {!isSignIn && <p className="text-xs text-zinc-400">Use at least 8 characters.</p>}
        <button type="submit" disabled={!!pending} className="w-full rounded-xl bg-sky-300 px-4 py-3 font-semibold text-zinc-950 hover:bg-sky-200 disabled:opacity-50">
          {pending === "email" ? (isSignIn ? "Signing in…" : "Creating account…") : (isSignIn ? "Sign in" : "Create account")}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-400">{isSignIn ? "Need an account?" : "Already registered?"}{" "}
        <button type="button" disabled={!!pending} onClick={() => { setIsSignIn(!isSignIn); setName(""); setPassword(""); setError(""); }} className="font-medium text-sky-300 hover:underline disabled:opacity-50">
          {isSignIn ? "Sign up" : "Sign in"}
        </button>
      </p>
    </section>
  );
}
