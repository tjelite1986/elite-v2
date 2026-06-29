import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Consolidated into the central Settings page (Sync category).
export default function ShortsAdminPage() {
  redirect("/settings#sync");
}
