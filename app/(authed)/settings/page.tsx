import { redirect } from "next/navigation";
import { getSession, getUserById } from "@/lib/auth";
import { ensureUserProfile } from "@/lib/profiles";
import {
  getAppearance,
  ACCENT_PRESETS,
  BG_THEMES,
} from "@/lib/appearance";
import SettingsClient from "@/components/settings-client";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const profile = ensureUserProfile(Number(session.sub), session.email);
  const hasAdultPin = !!getUserById(Number(session.sub))?.adult_pin_hash;
  const appearance = getAppearance(Number(session.sub));
  const bgThemes = Object.entries(BG_THEMES).map(([key, v]) => ({
    key,
    label: v.label,
    css: v.css,
  }));

  return (
    <SettingsClient
      isAdmin={session.role === "admin"}
      showAdultOutside={Boolean(profile.show_adult_outside)}
      hasAdultPin={hasAdultPin}
      accent={appearance.accent}
      bgTheme={appearance.bgTheme}
      accentPresets={ACCENT_PRESETS}
      bgThemes={bgThemes}
    />
  );
}
