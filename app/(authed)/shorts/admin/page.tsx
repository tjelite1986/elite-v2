import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Consolidated into the central Settings page (Shorts → Sources).
export default function ShortsAdminPage() {
  redirect("/settings#shorts:sources");
}
