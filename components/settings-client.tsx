"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import PushToggle from "@/components/push-toggle";
import SessionsManager from "@/components/sessions-manager";
import AppearanceSettings from "@/components/appearance-settings";

interface SettingsClientProps {
  isAdmin: boolean;
  showAdultOutside: boolean;
  accent: string;
  bgTheme: string;
  accentPresets: string[];
  bgThemes: { key: string; label: string; css: string }[];
}

export default function SettingsClient({
  isAdmin,
  showAdultOutside,
  accent,
  bgTheme,
  accentPresets,
  bgThemes,
}: SettingsClientProps) {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Per-field reveal toggle so the user can see what they type (matches login).
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  // 18+ visibility preference.
  const [adultOutside, setAdultOutside] = useState(showAdultOutside);
  const [adultSaving, setAdultSaving] = useState(false);

  const toggleAdultOutside = async () => {
    const next = !adultOutside;
    setAdultOutside(next);
    setAdultSaving(true);
    try {
      await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ show_adult_outside: next }),
      });
      router.refresh();
    } catch {
      setAdultOutside(!next); // revert on failure
    } finally {
      setAdultSaving(false);
    }
  };

  // Danger zone — account deletion.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: deletePassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDeleteError(data.error || "Could not delete account.");
        return;
      }
      router.push("/login");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not update password.");
        return;
      }
      setSuccess("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

  // Eye toggle that reveals/hides a given password field.
  const eyeButton = (key: string) => (
    <button
      type="button"
      tabIndex={-1}
      onClick={() => setShown((s) => ({ ...s, [key]: !s[key] }))}
      aria-label={shown[key] ? "Hide password" : "Show password"}
      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 transition hover:text-white"
    >
      {shown[key] ? <EyeOff size={18} /> : <Eye size={18} />}
    </button>
  );

  return (
    <main className="text-white px-8 pb-8 pt-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Link href="/" className="text-sm text-white/60 hover:text-white">
            ← Back
          </Link>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-8">
          <h2 className="text-lg font-medium">Change password</h2>
          <p className="mt-1 text-sm text-white/50">
            Use at least 8 characters.
          </p>

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <div className="relative">
              <input
                type={shown.current ? "text" : "password"}
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={`${inputClass} pr-12`}
              />
              {eyeButton("current")}
            </div>
            <div className="relative">
              <input
                type={shown.new ? "text" : "password"}
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`${inputClass} pr-12`}
              />
              {eyeButton("new")}
            </div>
            {newPassword && (
              <PasswordStrengthMeter password={newPassword} className="px-1" />
            )}
            <div className="relative">
              <input
                type={shown.confirm ? "text" : "password"}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`${inputClass} pr-12`}
              />
              {eyeButton("confirm")}
            </div>

            {error && <div className="text-sm text-red-400">{error}</div>}
            {success && <div className="text-sm text-green-400">{success}</div>}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 self-start rounded-full bg-white/15 px-6 py-3 text-sm font-medium hover:bg-white/25 transition disabled:opacity-50"
            >
              {loading ? "Saving..." : "Update password"}
            </button>
          </form>
        </div>

        {/* Appearance: accent + background theme */}
        <AppearanceSettings
          initialAccent={accent}
          initialBg={bgTheme}
          accentPresets={accentPresets}
          bgThemes={bgThemes}
        />

        {/* Push notifications */}
        <PushToggle />

        {/* Active sessions / device management */}
        <SessionsManager />

        {/* 18+ content visibility */}
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-medium">Show 18+ content everywhere</h2>
              <p className="mt-1 max-w-md text-sm text-white/50">
                Weave adult content into normal browsing (feeds, profiles, people)
                instead of only the Shorts 18+ section. You still need to unlock
                the 18+ PIN to view it.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={adultOutside}
              onClick={toggleAdultOutside}
              disabled={adultSaving}
              className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:opacity-50 ${
                adultOutside ? "bg-rose-500" : "bg-white/20"
              }`}
            >
              <span
                className={`absolute top-1 size-5 rounded-full bg-white transition-all ${
                  adultOutside ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>
        </div>

        {/* Danger zone — hidden for admins (admin accounts can't be deleted) */}
        {!isAdmin && (
          <div className="mt-6 rounded-2xl border border-red-500/30 bg-red-500/5 p-8">
            <h2 className="text-lg font-medium text-red-400">Danger zone</h2>
            <p className="mt-1 text-sm text-white/60">
              Permanently delete your account and sign out. This cannot be
              undone.
            </p>

            {!confirmingDelete ? (
              <button
                onClick={() => {
                  setConfirmingDelete(true);
                  setDeleteError("");
                  setDeletePassword("");
                }}
                className="mt-6 rounded-full border border-red-500/40 bg-red-500/10 px-6 py-3 text-sm font-medium text-red-300 hover:bg-red-500/20 transition"
              >
                Delete account
              </button>
            ) : (
              <form onSubmit={handleDelete} className="mt-6 flex flex-col gap-3">
                <p className="text-sm text-white/70">
                  Enter your password to confirm deletion.
                </p>
                <input
                  type="password"
                  placeholder="Password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  className={inputClass}
                />
                {deleteError && (
                  <div className="text-sm text-red-400">{deleteError}</div>
                )}
                <div className="mt-1 flex gap-3">
                  <button
                    type="submit"
                    disabled={deleting || !deletePassword}
                    className="rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-500 transition disabled:opacity-50"
                  >
                    {deleting ? "Deleting..." : "Permanently delete account"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-full bg-white/10 px-6 py-3 text-sm font-medium text-white hover:bg-white/20 transition"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
