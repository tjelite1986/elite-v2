import { db } from "./db";

// Accent colour presets shown in Settings (users can also enter a custom hex).
export const ACCENT_PRESETS = [
  "#2563eb", // blue (default)
  "#7c3aed", // violet
  "#db2777", // pink
  "#e11d48", // rose
  "#ea580c", // orange
  "#d97706", // amber
  "#16a34a", // green
  "#0d9488", // teal
  "#0891b2", // cyan
  "#64748b", // slate
];

export const DEFAULT_ACCENT = "#2563eb";

// Background themes (all dark — elite-v2's aesthetic is intentionally dark).
export const BG_THEMES: Record<string, { label: string; css: string }> = {
  default: {
    label: "Default",
    css: "radial-gradient(circle at 50% -10%, #20202a 0%, #121212 60%)",
  },
  black: { label: "Pure black", css: "#000000" },
  graphite: { label: "Graphite", css: "#16161a" },
  midnight: {
    label: "Midnight",
    css: "radial-gradient(circle at 50% -10%, #11203a 0%, #0a0f1a 60%)",
  },
  plum: {
    label: "Plum",
    css: "radial-gradient(circle at 50% -10%, #241826 0%, #120f16 60%)",
  },
  forest: {
    label: "Forest",
    css: "radial-gradient(circle at 50% -10%, #12251c 0%, #0b140f 60%)",
  },
};

export const DEFAULT_BG = "default";

export function isValidAccent(s: unknown): s is string {
  return typeof s === "string" && /^#[0-9a-fA-F]{6}$/.test(s);
}

export function bgCss(key: string | null | undefined): string {
  return BG_THEMES[key ?? ""]?.css ?? BG_THEMES[DEFAULT_BG].css;
}

export interface Appearance {
  accent: string;
  bgTheme: string;
}

export function getAppearance(userId: number): Appearance {
  const row = db
    .prepare("SELECT accent, bg_theme FROM user_profiles WHERE user_id = ?")
    .get(userId) as { accent: string | null; bg_theme: string | null } | undefined;
  return {
    accent: isValidAccent(row?.accent) ? (row!.accent as string) : DEFAULT_ACCENT,
    bgTheme: row?.bg_theme && BG_THEMES[row.bg_theme] ? row.bg_theme : DEFAULT_BG,
  };
}

export function setAppearance(
  userId: number,
  patch: { accent?: unknown; bgTheme?: unknown }
): void {
  if (patch.accent !== undefined && isValidAccent(patch.accent)) {
    db.prepare("UPDATE user_profiles SET accent = ? WHERE user_id = ?").run(
      patch.accent,
      userId
    );
  }
  if (
    patch.bgTheme !== undefined &&
    typeof patch.bgTheme === "string" &&
    BG_THEMES[patch.bgTheme]
  ) {
    db.prepare("UPDATE user_profiles SET bg_theme = ? WHERE user_id = ?").run(
      patch.bgTheme,
      userId
    );
  }
}
