import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// Consolidated into the central Settings page (Admin → Members). Old links
// from the top nav, notifications and invite emails land here.
export default function AdminPage() {
  redirect("/settings#members");
}
