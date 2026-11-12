import { Suspense } from "react";
import { notFound } from "next/navigation";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { BenchmarkPanel } from "@/components/routing/benchmark-panel";
import { benchmarkView } from "@/lib/routing/report";
async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const owner = await pageOwnerOrNull(); if (!owner) return <AuthPrompt />;
  let data;
  try { const comparison = (await searchParams).compareTo; data = await benchmarkView(owner, (await params).id, typeof comparison === "string" ? comparison : undefined); }
  catch (error) { if (error instanceof Error && error.message === "benchmark_not_found") notFound(); throw error; }
  return <BenchmarkPanel key={`${data.id}:${data.comparison?.id ?? ""}`} initial={data} />;
}
export default function BenchmarkPage({ params, searchParams }: PageProps<"/benchmarks/[id]">) {
  return <Suspense fallback={<p className="p-6">Loading comparison…</p>}><Content params={params} searchParams={searchParams} /></Suspense>;
}
