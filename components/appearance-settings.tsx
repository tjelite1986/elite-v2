"use client";

import { useRef, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface BgTheme {
  key: string;
  label: string;
  css: string;
}

export default function AppearanceSettings({
  initialAccent,
  initialBg,
  accentPresets,
  bgThemes,
}: {
  initialAccent: string;
  initialBg: string;
  accentPresets: string[];
  bgThemes: BgTheme[];
}) {
  const [accent, setAccent] = useState(initialAccent);
  const [bg, setBg] = useState(initialBg);
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  const persist = (patch: { accent?: string; bgTheme?: string }) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      fetch("/api/settings/appearance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }).catch(() => {});
    }, 250);
  };

  const applyAccent = (hex: string) => {
    setAccent(hex);
    document.documentElement.style.setProperty("--accent", hex);
    persist({ accent: hex });
  };

  const applyBg = (theme: BgTheme) => {
    setBg(theme.key);
    document.documentElement.style.setProperty("--app-bg", theme.css);
    persist({ bgTheme: theme.key });
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <h2 className="text-lg font-medium">Appearance</h2>
      <p className="mt-1 text-sm text-white/50">
        Pick an accent colour and background — applied across the app for your
        account.
      </p>

      {/* Accent */}
      <div className="mt-5">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Accent
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {accentPresets.map((hex) => (
            <button
              key={hex}
              onClick={() => applyAccent(hex)}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full ring-2 ring-offset-2 ring-offset-[#1a1a1f] transition",
                accent.toLowerCase() === hex.toLowerCase()
                  ? "ring-white/70"
                  : "ring-transparent hover:ring-white/30"
              )}
              style={{ backgroundColor: hex }}
              aria-label={`Accent ${hex}`}
            >
              {accent.toLowerCase() === hex.toLowerCase() && (
                <Check size={15} className="text-white drop-shadow" />
              )}
            </button>
          ))}
          {/* Custom hex via the native colour picker. */}
          <label
            className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-dashed border-white/30 text-xs text-white/50 hover:border-white/50"
            title="Custom colour"
          >
            +
            <input
              type="color"
              value={accent}
              onChange={(e) => applyAccent(e.target.value)}
              className="sr-only"
            />
          </label>
          <span className="ml-1 text-xs text-white/40">{accent}</span>
        </div>
        <button
          className="mt-3 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium"
          disabled
        >
          Preview button
        </button>
      </div>

      {/* Background */}
      <div className="mt-6">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-white/40">
          Background
        </div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {bgThemes.map((t) => (
            <button
              key={t.key}
              onClick={() => applyBg(t)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl p-1.5 transition",
                bg === t.key ? "ring-2 ring-white/60" : "hover:bg-white/5"
              )}
            >
              <span
                className="h-12 w-full rounded-lg border border-white/10"
                style={{ background: t.css }}
              />
              <span className="text-[11px] text-white/60">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
