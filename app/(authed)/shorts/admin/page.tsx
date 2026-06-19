import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Consolidated into the Settings tab.
export default function ShortsAdminPage() {
  redirect("/shorts/settings");
}
