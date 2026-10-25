import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";
import AuthClientPage from "./auth-client";

async function AuthContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/");
  const { error } = await searchParams;
  return <AuthClientPage githubEnabled={!!process.env.GITHUB_CLIENT_ID && !!process.env.GITHUB_CLIENT_SECRET} callbackFailed={!!error} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return <Suspense fallback={<p>Loading sign-in…</p>}><AuthContent searchParams={searchParams} /></Suspense>;
}
