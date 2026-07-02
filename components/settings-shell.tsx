"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Eye,
  EyeOff,
  KeyRound,
  Palette,
  Bell,
  MonitorSmartphone,
  ShieldAlert,
  Trash2,
  FolderInput,
  GitMerge,
  Copy,
  Brush,
  Tags,
  RefreshCw,
  Upload,
  PenLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PasswordStrengthMeter } from "@/components/ui/password-strength-meter";
import PushToggle from "@/components/push-toggle";
import SessionsManager from "@/components/sessions-manager";
import AppearanceSettings from "@/components/appearance-settings";
import AdultPinSettings from "@/components/adult-pin-settings";
import UnifiedMergeProfiles from "@/components/unified-merge-profiles";
import LinkProfiles from "@/components/link-profiles";
import ShortsImportButton from "@/components/shorts-import-button";
import PostsImportButton from "@/components/posts-import-button";
import ShortsDuplicates from "@/components/shorts-duplicates";
import PostsDuplicates from "@/components/posts-duplicates";
import ShortsCleanup from "@/components/shorts-cleanup";
import PostsCleanup from "@/components/posts-cleanup";
import GalleryDuplicates from "@/components/gallery-duplicates";
import GalleryCleanup from "@/components/gallery-cleanup";
import ShortsTitleFetch from "@/components/shorts-title-fetch";
import InstagramAutoConnect from "@/components/instagram-auto-connect";
import TiktokAutoConnect from "@/components/tiktok-auto-connect";
import ShortsAdmin from "@/components/shorts-admin";
import RenameTools from "@/components/rename-tools";

interface SettingsShellProps {
  isAdmin: boolean;
  username: string | null;
  perms: { shorts: boolean; shorts18: boolean; posts: boolean; gallery: boolean };
  showAdultOutside: boolean;
  hasAdultPin: boolean;
  accent: string;
  bgTheme: string;
  accentPresets: string[];
  bgThemes: { key: string; label: string; css: string }[];
}

type CategoryKey =
  | "account"
  | "appearance"
  | "notifications"
  | "sessions"
  | "adult"
  | "danger"
  | "import"
  | "rename"
  | "merge"
  | "duplicates"
  | "cleaning"
  | "fetch"
  | "sync";

// Card wrapper matching the rest of the settings surface.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      {children}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-white/40">
      {children}
    </h3>
  );
}

export default function SettingsShell({
  isAdmin,
  username,
  perms,
  showAdultOutside,
  hasAdultPin,
  accent,
  bgTheme,
  accentPresets,
  bgThemes,
}: SettingsShellProps) {
  // Any management category is reachable when the user holds at least one
  // per-section permission (admins hold all). The heavy tools stay admin-only;
  // non-admins with a section permission only get their personal import folder.
  const hasAnySection =
    perms.shorts || perms.shorts18 || perms.posts || perms.gallery;

  const nav = useMemo(() => {
    const personal: { key: CategoryKey; label: string; icon: React.ReactNode }[] = [
      { key: "account", label: "Account", icon: <KeyRound size={16} /> },
      { key: "appearance", label: "Appearance", icon: <Palette size={16} /> },
      { key: "notifications", label: "Notifications", icon: <Bell size={16} /> },
      { key: "sessions", label: "Sessions", icon: <MonitorSmartphone size={16} /> },
      { key: "adult", label: "18+ access", icon: <ShieldAlert size={16} /> },
    ];
    if (!isAdmin) {
      personal.push({ key: "danger", label: "Danger zone", icon: <Trash2 size={16} /> });
    }

    const manage: { key: CategoryKey; label: string; icon: React.ReactNode }[] = [];
    if (hasAnySection) {
      manage.push({ key: "import", label: "Import", icon: <FolderInput size={16} /> });
      manage.push({ key: "rename", label: "Rename", icon: <PenLine size={16} /> });
    }
    if (isAdmin) {
      manage.push(
        { key: "merge", label: "Merge / Link", icon: <GitMerge size={16} /> },
        { key: "duplicates", label: "Duplicates", icon: <Copy size={16} /> },
        { key: "cleaning", label: "Cleaning", icon: <Brush size={16} /> },
        { key: "fetch", label: "Fetch", icon: <Tags size={16} /> },
        { key: "sync", label: "Sync", icon: <RefreshCw size={16} /> }
      );
    }
    return { personal, manage };
  }, [isAdmin, hasAnySection]);

  const allKeys = useMemo(
    () => [...nav.personal, ...nav.manage].map((c) => c.key),
    [nav]
  );

  const [active, setActive] = useState<CategoryKey>("account");

  // Deep-link via URL hash (e.g. /settings#duplicates) without pulling in
  // useSearchParams (which would force a Suspense boundary).
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "") as CategoryKey;
    if (fromHash && allKeys.includes(fromHash)) setActive(fromHash);
  }, [allKeys]);

  const select = (key: CategoryKey) => {
    setActive(key);
    window.history.replaceState(null, "", `#${key}`);
  };

  const navButton = (
    c: { key: CategoryKey; label: string; icon: React.ReactNode },
    horizontal = false
  ) => (
    <button
      key={c.key}
      type="button"
      onClick={() => select(c.key)}
      className={cn(
        "flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium transition",
        horizontal ? "shrink-0" : "w-full",
        active === c.key
          ? "bg-white/15 text-white"
          : "text-white/60 hover:bg-white/5 hover:text-white"
      )}
    >
      {c.icon}
      {c.label}
    </button>
  );

  return (
    <main className="text-white px-4 pb-24 pt-6 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Settings</h1>
          <Link href="/" className="text-sm text-white/60 hover:text-white">
            ← Back
          </Link>
        </div>

        {/* Mobile: horizontal pill nav */}
        <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
          {[...nav.personal, ...nav.manage].map((c) => navButton(c, true))}
        </div>

        <div className="md:grid md:grid-cols-[200px_1fr] md:gap-8">
          {/* Desktop: vertical sidebar */}
          <nav className="hidden md:block">
            <div className="sticky top-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                {nav.personal.map((c) => navButton(c))}
              </div>
              {nav.manage.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-white/10 pt-4">
                  <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-white/30">
                    Manage
                  </div>
                  {nav.manage.map((c) => navButton(c))}
                </div>
              )}
            </div>
          </nav>

          {/* Panel area */}
          <div className="min-w-0">
            {active === "account" && <AccountPanel />}
            {active === "appearance" && (
              <AppearanceSettings
                initialAccent={accent}
                initialBg={bgTheme}
                accentPresets={accentPresets}
                bgThemes={bgThemes}
              />
            )}
            {active === "notifications" && <PushToggle />}
            {active === "sessions" && <SessionsManager />}
            {active === "adult" && (
              <AdultPanel
                showAdultOutside={showAdultOutside}
                hasAdultPin={hasAdultPin}
              />
            )}
            {active === "danger" && !isAdmin && <DangerPanel />}

            {active === "import" && (
              <ImportPanel isAdmin={isAdmin} username={username} perms={perms} />
            )}
            {active === "rename" && (
              <RenameTools isAdmin={isAdmin} perms={perms} />
            )}
            {active === "merge" && isAdmin && (
              <div className="flex flex-col gap-6">
                <SectionLabel>Link (keep separate, show as one)</SectionLabel>
                <LinkProfiles />
                <SectionLabel>Merge (permanent, deletes source)</SectionLabel>
                <UnifiedMergeProfiles />
              </div>
            )}
            {active === "duplicates" && isAdmin && (
              <div className="flex flex-col gap-6">
                <SectionLabel>Shorts</SectionLabel>
                <ShortsDuplicates channel="main" />
                <SectionLabel>18+</SectionLabel>
                <ShortsDuplicates channel="18plus" />
                <SectionLabel>Photos (Posts)</SectionLabel>
                <PostsDuplicates />
                <SectionLabel>Gallery</SectionLabel>
                <GalleryDuplicates />
              </div>
            )}
            {active === "cleaning" && isAdmin && (
              <div className="flex flex-col gap-6">
                <SectionLabel>Shorts</SectionLabel>
                <ShortsCleanup channel="main" />
                <SectionLabel>18+</SectionLabel>
                <ShortsCleanup channel="18plus" />
                <SectionLabel>Photos (Posts)</SectionLabel>
                <PostsCleanup />
                <SectionLabel>Gallery</SectionLabel>
                <GalleryCleanup />
              </div>
            )}
            {active === "fetch" && isAdmin && (
              <div className="flex flex-col gap-6">
                <SectionLabel>Shorts</SectionLabel>
                <ShortsTitleFetch channel="main" />
                <SectionLabel>18+</SectionLabel>
                <ShortsTitleFetch channel="18plus" />
              </div>
            )}
            {active === "sync" && isAdmin && (
              <div className="flex flex-col gap-6">
                <SectionLabel>Instagram</SectionLabel>
                <Card>
                  <h2 className="text-lg font-medium">Instagram sync</h2>
                  <p className="mt-1 text-sm text-white/50">
                    Connect an Instagram account on a person&apos;s profile (Edit
                    profile → Instagram) and use &ldquo;Sync from Instagram&rdquo;
                    there. Or auto-connect every creator folder whose name is a
                    real Instagram account (100% match):
                  </p>
                  <div className="mt-4">
                    <InstagramAutoConnect />
                  </div>
                </Card>
                <SectionLabel>TikTok</SectionLabel>
                <Card>
                  <h2 className="text-lg font-medium">TikTok sync</h2>
                  <p className="mt-1 text-sm text-white/50">
                    Connect a TikTok handle on a person&apos;s profile (Edit
                    profile → TikTok) and sync there — no cookie required for
                    public profiles. Or auto-connect every creator folder whose
                    name is a real TikTok account:
                  </p>
                  <div className="mt-4">
                    <TiktokAutoConnect />
                  </div>
                </Card>
                <SectionLabel>Auto-poll sources</SectionLabel>
                <ShortsAdmin channel="main" basePath="/shorts" />
                <ShortsAdmin channel="18plus" basePath="/shorts18" />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Account — change password
// ---------------------------------------------------------------------------
function AccountPanel() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const inputClass =
    "w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

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

  return (
    <Card>
      <h2 className="text-lg font-medium">Change password</h2>
      <p className="mt-1 text-sm text-white/50">Use at least 8 characters.</p>
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
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 18+ visibility toggle + personal PIN
// ---------------------------------------------------------------------------
function AdultPanel({
  showAdultOutside,
  hasAdultPin,
}: {
  showAdultOutside: boolean;
  hasAdultPin: boolean;
}) {
  const router = useRouter();
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
      setAdultOutside(!next);
    } finally {
      setAdultSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">Show 18+ content everywhere</h2>
            <p className="mt-1 max-w-md text-sm text-white/50">
              Weave adult content into normal browsing (feeds, profiles, people)
              instead of only the Shorts 18+ section. If you set a personal 18+
              PIN below, you&apos;ll need to unlock it to view adult content.
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
      </Card>
      <AdultPinSettings hasPin={hasAdultPin} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Danger zone — delete account (non-admins only)
// ---------------------------------------------------------------------------
function DangerPanel() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const inputClass =
    "w-full rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

  const handleDelete = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setDeleting(true);
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Could not delete account.");
        return;
      }
      router.push("/login");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-6">
      <h2 className="text-lg font-medium text-red-400">Danger zone</h2>
      <p className="mt-1 text-sm text-white/60">
        Permanently delete your account and sign out. This cannot be undone.
      </p>
      {!confirming ? (
        <button
          onClick={() => {
            setConfirming(true);
            setError("");
            setPassword("");
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
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="mt-1 flex gap-3">
            <button
              type="submit"
              disabled={deleting || !password}
              className="rounded-full bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-500 transition disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Permanently delete account"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-full bg-white/10 px-6 py-3 text-sm font-medium text-white hover:bg-white/20 transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Import — per-user drop folders (permission-gated) + shared import (admin)
// ---------------------------------------------------------------------------
function ImportPanel({
  isAdmin,
  username,
  perms,
}: {
  isAdmin: boolean;
  username: string | null;
  perms: { shorts: boolean; shorts18: boolean; posts: boolean; gallery: boolean };
}) {
  const u = username ?? "…";
  return (
    <div className="flex flex-col gap-6">
      <SectionLabel>Your import folders</SectionLabel>
      {perms.shorts && (
        <Card>
          <h2 className="text-base font-medium">Shorts</h2>
          <p className="mb-2 mt-1 text-sm text-white/50">
            Drop video files here and they import as your own clips:
          </p>
          <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
            _import/u_{u}/shorts/
          </code>
          <p className="mt-2 text-sm text-white/50">
            Name a file{" "}
            <code className="text-white/70">title [h_tag][f_profile].mp4</code>{" "}
            to set caption and hashtags —{" "}
            <code className="text-white/70">[f_profile]</code> (or a subfolder)
            publishes the clip PUBLICLY under that creator profile. Loose files
            stay your own private clips.
          </p>
          <Link
            href="/shorts/upload"
            className="mt-3 flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            <Upload size={16} /> Upload a short
          </Link>
        </Card>
      )}
      {perms.shorts18 && (
        <Card>
          <h2 className="text-base font-medium">18+</h2>
          <p className="mb-2 mt-1 text-sm text-white/50">
            Drop video files here and they import as your own 18+ clips:
          </p>
          <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
            _import/u_{u}/shorts18/
          </code>
          <Link
            href="/shorts18/upload"
            className="mt-3 flex w-fit items-center gap-2 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95"
          >
            <Upload size={16} /> Upload to 18+
          </Link>
        </Card>
      )}
      {perms.posts && (
        <Card>
          <h2 className="text-base font-medium">Photos (Posts)</h2>
          <p className="mb-2 mt-1 text-sm text-white/50">
            Drop images here and each imports as your own post:
          </p>
          <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
            _import/u_{u}/posts/
          </code>
          <p className="mt-2 text-sm text-white/50">
            Name a file <code className="text-white/70">caption [h_tag].jpg</code>{" "}
            (or drop a <code className="text-white/70">.md</code> sidecar) to set
            caption and hashtags.
          </p>
        </Card>
      )}
      {perms.gallery && (
        <Card>
          <h2 className="text-base font-medium">Gallery</h2>
          <p className="mb-2 mt-1 text-sm text-white/50">
            Drop photos and videos here to import them into your gallery:
          </p>
          <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
            _import/u_{u}/gallery/
          </code>
        </Card>
      )}

      {isAdmin && (
        <>
          <SectionLabel>Shared import folders (admin)</SectionLabel>
          <Card>
            <h2 className="text-base font-medium">Shorts</h2>
            <p className="mb-2 mt-1 text-sm text-white/50">
              Drop files into the shared creator import folder, then sort them in:
            </p>
            <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
              shorts/main/_import/
            </code>
            <p className="mb-3 text-sm text-white/50">
              Name a file{" "}
              <code className="text-white/70">title [h_tag][f_profile].mp4</code> —{" "}
              <code className="text-white/70">[f_profile]</code> sets the creator
              profile and <code className="text-white/70">[h_tag]</code> adds
              hashtags. A subfolder named after the creator (or the legacy{" "}
              <code className="text-white/70">profile_-_title</code>) still works.
            </p>
            <ShortsImportButton channel="main" />
          </Card>
          <Card>
            <h2 className="text-base font-medium">18+</h2>
            <p className="mb-2 mt-1 text-sm text-white/50">
              Drop files into the shared 18+ creator import folder, then sort them
              in:
            </p>
            <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
              shorts/18plus/_import/
            </code>
            <p className="mb-3 text-sm text-white/50">
              Name a file{" "}
              <code className="text-white/70">title [h_tag][f_profile].mp4</code> —{" "}
              <code className="text-white/70">[f_profile]</code> sets the creator
              profile and <code className="text-white/70">[h_tag]</code> adds
              hashtags. A subfolder named after the creator (or the legacy{" "}
              <code className="text-white/70">profile_-_title</code>) still works.
            </p>
            <ShortsImportButton channel="18plus" />
          </Card>
          <Card>
            <h2 className="text-base font-medium">Photos (Posts)</h2>
            <p className="mb-2 mt-1 text-sm text-white/50">
              Drop files into the shared import folder, then sort them in:
            </p>
            <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
              posts/_import/
            </code>
            <p className="mb-3 text-sm text-white/50">
              Name a file{" "}
              <code className="text-white/70">title [h_tag][f_creator].jpg</code> —{" "}
              <code className="text-white/70">[f_creator]</code> sets the creator
              and <code className="text-white/70">[h_tag]</code> adds hashtags. A
              subfolder named after the creator (or the legacy{" "}
              <code className="text-white/70">creator_-_title</code>) still works.
              Videos route to Shorts under the same handle.
            </p>
            <PostsImportButton />
          </Card>
        </>
      )}
    </div>
  );
}
