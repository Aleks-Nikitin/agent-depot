import { redirect } from "next/navigation";

// Authentication happens from the public landing page (/) via its dialog.
// Keep /auth as a redirect so there is never a standalone login page first.
export default function Page() {
  redirect("/");
}
