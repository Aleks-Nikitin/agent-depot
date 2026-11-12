import { Suspense } from "react";
import { notFound } from "next/navigation";
import { pageOwnerOrNull } from "@/lib/auth/session";
import { AuthPrompt } from "@/components/auth/auth-prompt";
import { RepairPanel } from "@/components/repairs/repair-panel";
import { repairView } from "@/lib/repairs/service";
async function Content({ params }: { params: Promise<{ id: string }> }) {
  const ownerId = await pageOwnerOrNull(); if (!ownerId) return <AuthPrompt />;
  const { id } = await params;
  let data;
  try { data = await repairView(ownerId, id); }
  catch (error) { if (error instanceof Error && error.message === "repair_not_found") notFound(); throw error; }
  return <RepairPanel initial={data} />;
}
export default function RepairPage({ params }: PageProps<"/repairs/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm">Loading repair…</p>}><Content params={params} /></Suspense>;
}
