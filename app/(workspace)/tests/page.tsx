import { Suspense } from "react";
import { AgentPicker } from "@/components/shell/agent-picker";
export default function Page() { return <Suspense fallback={<p className="p-6">Loading agents…</p>}><AgentPicker section="tests" /></Suspense>; }
