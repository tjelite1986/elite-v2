import { redirect } from "next/navigation";
import { getSession, getUserById } from "@/lib/auth";
import { ensureUserProfile, getProfileByUserId } from "@/lib/profiles";
import { hasPermission } from "@/lib/permissions";
import {
  getAppearance,
  ACCENT_PRESETS,
  BG_THEMES,
} from "@/lib/appearance";
import SettingsShell from "@/components/settings-shell";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const userId = Number(session.sub);
  const profile = ensureUserProfile(userId, session.email);
  const hasAdultPin = !!getUserById(userId)?.adult_pin_hash;
  const appearance = getAppearance(userId);
  const bgThemes = Object.entries(BG_THEMES).map(([key, v]) => ({
    key,
    label: v.label,
    css: v.css,
  }));

  // Per-section access controls which management categories show. Admins hold
  // every permission implicitly (hasPermission returns true for them).
  const perms = {
    shorts: hasPermission(session, "shorts_settings"),
    shorts18: hasPermission(session, "shorts18_settings"),
    posts: hasPermission(session, "posts_settings"),
    gallery: hasPermission(session, "gallery_settings"),
  };

  return (
    <SettingsShell
      isAdmin={session.role === "admin"}
      username={getProfileByUserId(userId)?.username ?? null}
      perms={perms}
      showAdultOutside={Boolean(profile.show_adult_outside)}
      hasAdultPin={hasAdultPin}
      accent={appearance.accent}
      bgTheme={appearance.bgTheme}
      accentPresets={ACCENT_PRESETS}
      bgThemes={bgThemes}
    />
  );
}
