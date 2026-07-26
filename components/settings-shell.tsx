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
  Film,
  Flame,
  Image as ImageIcon,
  Images,
  Users,
  Upload,
  PenLine,
  UserPlus,
  CalendarClock,
  ShieldCheck,
  Megaphone,
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
import UserImportButton from "@/components/user-import-button";
import ShortsDuplicates from "@/components/shorts-duplicates";
import PostsDuplicates from "@/components/posts-duplicates";
import ShortsCleanup from "@/components/shorts-cleanup";
import PostsCleanup from "@/components/posts-cleanup";
import GalleryDuplicates from "@/components/gallery-duplicates";
import GalleryCleanup from "@/components/gallery-cleanup";
import ShortsTitleFetch from "@/components/shorts-title-fetch";
import ShortsCaptionBackfill from "@/components/shorts-caption-backfill";
import InstagramAutoConnect from "@/components/instagram-auto-connect";
import TiktokAutoConnect from "@/components/tiktok-auto-connect";
import ShortsAdmin from "@/components/shorts-admin";
import RenameTools from "@/components/rename-tools";
import AdminInvites from "@/components/admin-invites";
import JobsManager from "@/components/jobs-manager";
import AdminAnnounce from "@/components/admin-announce";
import ImportReview from "@/components/import-review";
import UserPermissions from "@/components/user-permissions";

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

// Sidebar categories: personal settings, one entry per library section the user
// may manage, and admin-wide tools. Heavy per-section tooling lives INSIDE the
// section's panel as small tool tabs instead of one endless page per tool.
type SectionKey = "shorts" | "shorts18" | "posts" | "gallery";
type CategoryKey =
  | "account"
  | "appearance"
  | "notifications"
  | "sessions"
  | "adult"
  | SectionKey
  | "profiles"
  | "rename"
  | "members"
  | "jobs"
  | "permissions"
  | "announce";

interface NavItem {
  key: CategoryKey;
  label: string;
  icon: React.ReactNode;
}

interface ToolTab {
  key: string;
  label: string;
}

// Card wrapper matching the rest of the settings surface.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      {children}
    </div>
  );
}

// Consistent panel intro so every category answers "where am I, what is this
// for" at a glance.
function PanelHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-2xl text-sm text-white/50">{desc}</p>
    </div>
  );
}

// Small segmented control for the tools inside a category panel.
function ToolTabs({
  tools,
  active,
  onSelect,
}: {
  tools: ToolTab[];
  active: string;
  onSelect: (key: string) => void;
}) {
  if (tools.length <= 1) return null;
  return (
    <div className="mb-5 flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-white/5 p-1">
      {tools.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onSelect(t.key)}
          className={cn(
            "shrink-0 rounded-lg px-3.5 py-1.5 text-sm font-medium transition",
            active === t.key
              ? "bg-white/15 text-white"
              : "text-white/60 hover:text-white"
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

const SECTION_META: Record<
  SectionKey,
  { label: string; desc: string }
> = {
  shorts: {
    label: "Shorts",
    desc: "Import, deduplicate and maintain the Shorts library.",
  },
  shorts18: {
    label: "18+ videos",
    desc: "Import, deduplicate and maintain the 18+ video library.",
  },
  posts: {
    label: "Photos",
    desc: "Import, deduplicate and maintain the photo posts library.",
  },
  gallery: {
    label: "Gallery",
    desc: "Import, deduplicate and maintain your private gallery.",
  },
};

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
  const hasAnySection =
    perms.shorts || perms.shorts18 || perms.posts || perms.gallery;
  // The shorts dupe scan/resolve span both channels, so those tools need both
  // shorts permissions (admins hold all).
  const bothShorts = isAdmin || (perms.shorts && perms.shorts18);

  const nav = useMemo(() => {
    const personal: NavItem[] = [
      { key: "account", label: "Account", icon: <KeyRound size={16} /> },
      { key: "appearance", label: "Appearance", icon: <Palette size={16} /> },
      { key: "notifications", label: "Notifications", icon: <Bell size={16} /> },
      { key: "sessions", label: "Sessions", icon: <MonitorSmartphone size={16} /> },
      { key: "adult", label: "18+ access", icon: <ShieldAlert size={16} /> },
    ];

    const library: NavItem[] = [];
    if (perms.shorts)
      library.push({ key: "shorts", label: "Shorts", icon: <Film size={16} /> });
    if (perms.shorts18)
      library.push({ key: "shorts18", label: "18+ videos", icon: <Flame size={16} /> });
    if (perms.posts)
      library.push({ key: "posts", label: "Photos", icon: <ImageIcon size={16} /> });
    if (perms.gallery)
      library.push({ key: "gallery", label: "Gallery", icon: <Images size={16} /> });

    const tools: NavItem[] = [];
    if (isAdmin) {
      tools.push({ key: "profiles", label: "Profiles", icon: <Users size={16} /> });
    }
    if (hasAnySection) {
      tools.push({ key: "rename", label: "Rename", icon: <PenLine size={16} /> });
    }

    const admin: NavItem[] = isAdmin
      ? [
          { key: "members", label: "Members", icon: <UserPlus size={16} /> },
          { key: "jobs", label: "Background jobs", icon: <CalendarClock size={16} /> },
          { key: "permissions", label: "Permissions", icon: <ShieldCheck size={16} /> },
          { key: "announce", label: "Announce", icon: <Megaphone size={16} /> },
        ]
      : [];
    return { personal, library, tools, admin };
  }, [isAdmin, perms, hasAnySection]);

  const allKeys = useMemo(
    () =>
      [...nav.personal, ...nav.library, ...nav.tools, ...nav.admin].map(
        (c) => c.key
      ),
    [nav]
  );

  // Which tool tabs a category offers (empty = plain panel).
  const toolsFor = (key: CategoryKey): ToolTab[] => {
    if (key === "shorts" || key === "shorts18") {
      const t: ToolTab[] = [{ key: "import", label: "Import" }];
      if (bothShorts) t.push({ key: "duplicates", label: "Duplicates" });
      t.push({ key: "cleaning", label: "Cleaning" });
      if (isAdmin)
        t.push({ key: "titles", label: "Titles" }, { key: "sources", label: "Sources" });
      return t;
    }
    if (key === "posts" || key === "gallery") {
      return [
        { key: "import", label: "Import" },
        { key: "duplicates", label: "Duplicates" },
        { key: "cleaning", label: "Cleaning" },
      ];
    }
    if (key === "profiles") {
      return [
        { key: "link", label: "Link" },
        { key: "merge", label: "Merge" },
        { key: "connect", label: "Auto-connect" },
      ];
    }
    return [];
  };

  const [active, setActive] = useState<CategoryKey>("account");
  const [tool, setTool] = useState<string>("");

  // Deep-link via URL hash — "#gallery" or "#gallery:duplicates" — without
  // pulling in useSearchParams (which would force a Suspense boundary). Legacy
  // pre-redesign hashes are mapped so old bookmarks keep working. Also listens
  // for hashchange so in-page navigation (e.g. the top-nav admin shortcut while
  // already on /settings) switches category.
  useEffect(() => {
    const applyHash = () => {
      const raw = window.location.hash.replace("#", "");
      if (!raw) return;
      const [cat, sub] = raw.split(":");
      const firstSection = (["shorts", "shorts18", "posts", "gallery"] as const).find(
        (s) => perms[s]
      );
      const legacy: Record<string, [CategoryKey, string] | undefined> = {
        import: firstSection ? [firstSection, "import"] : undefined,
        duplicates: firstSection ? [firstSection, "duplicates"] : undefined,
        cleaning: firstSection ? [firstSection, "cleaning"] : undefined,
        fetch: ["shorts", "titles"],
        sync: ["profiles", "connect"],
        merge: ["profiles", "link"],
        danger: ["account", ""],
      };
      let target: CategoryKey | null = null;
      let targetTool = sub ?? "";
      if (allKeys.includes(cat as CategoryKey)) {
        target = cat as CategoryKey;
      } else if (legacy[cat] && allKeys.includes(legacy[cat]![0])) {
        [target, targetTool] = legacy[cat]!;
      }
      if (!target) return;
      const tabs = toolsFor(target);
      setActive(target);
      setTool(
        tabs.length
          ? tabs.some((t) => t.key === targetTool)
            ? targetTool
            : tabs[0].key
          : ""
      );
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allKeys]);

  const select = (key: CategoryKey) => {
    const tabs = toolsFor(key);
    const nextTool = tabs.length ? tabs[0].key : "";
    setActive(key);
    setTool(nextTool);
    window.history.replaceState(
      null,
      "",
      nextTool ? `#${key}:${nextTool}` : `#${key}`
    );
  };

  const selectTool = (key: string) => {
    setTool(key);
    window.history.replaceState(null, "", `#${active}:${key}`);
  };

  const navButton = (c: NavItem, horizontal = false) => (
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

  const navGroup = (title: string, items: NavItem[]) =>
    items.length > 0 && (
      <div className="flex flex-col gap-1 border-t border-white/10 pt-4 first:border-t-0 first:pt-0">
        <div className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-white/30">
          {title}
        </div>
        {items.map((c) => navButton(c))}
      </div>
    );

  const activeSection = (["shorts", "shorts18", "posts", "gallery"] as const).find(
    (s) => s === active
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
          {[...nav.personal, ...nav.library, ...nav.tools, ...nav.admin].map(
            (c) => navButton(c, true)
          )}
        </div>

        <div className="md:grid md:grid-cols-[210px_1fr] md:gap-8">
          {/* Desktop: vertical sidebar */}
          <nav className="hidden md:block">
            <div className="sticky top-6 flex flex-col gap-4">
              {navGroup("Personal", nav.personal)}
              {navGroup("Library", nav.library)}
              {navGroup("Tools", nav.tools)}
              {navGroup("Admin", nav.admin)}
            </div>
          </nav>

          {/* Panel area */}
          <div className="min-w-0">
            {active === "account" && (
              <div className="flex flex-col gap-6">
                <PanelHeader
                  title="Account"
                  desc="Your sign-in credentials and account lifecycle."
                />
                <AccountPanel />
                {!isAdmin && <DangerPanel />}
              </div>
            )}
            {active === "appearance" && (
              <div>
                <PanelHeader
                  title="Appearance"
                  desc="Accent color and background theme for your account."
                />
                <AppearanceSettings
                  initialAccent={accent}
                  initialBg={bgTheme}
                  accentPresets={accentPresets}
                  bgThemes={bgThemes}
                />
              </div>
            )}
            {active === "notifications" && (
              <div>
                <PanelHeader
                  title="Notifications"
                  desc="Push notifications to this device."
                />
                <PushToggle />
              </div>
            )}
            {active === "sessions" && (
              <div>
                <PanelHeader
                  title="Sessions"
                  desc="Devices signed in to your account — revoke any you don't recognize."
                />
                <SessionsManager />
              </div>
            )}
            {active === "adult" && (
              <div>
                <PanelHeader
                  title="18+ access"
                  desc="Where adult content may appear, and the PIN that protects it."
                />
                <AdultPanel
                  showAdultOutside={showAdultOutside}
                  hasAdultPin={hasAdultPin}
                />
              </div>
            )}

            {activeSection && (
              <div>
                <PanelHeader
                  title={SECTION_META[activeSection].label}
                  desc={SECTION_META[activeSection].desc}
                />
                <ToolTabs
                  tools={toolsFor(activeSection)}
                  active={tool}
                  onSelect={selectTool}
                />
                <LibraryToolPanel
                  section={activeSection}
                  tool={tool}
                  isAdmin={isAdmin}
                  username={username}
                />
              </div>
            )}

            {active === "profiles" && isAdmin && (
              <div>
                <PanelHeader
                  title="Profiles"
                  desc="Combine duplicate people and connect creator folders to their social accounts."
                />
                <ToolTabs
                  tools={toolsFor("profiles")}
                  active={tool}
                  onSelect={selectTool}
                />
                {tool === "link" && (
                  <div className="flex flex-col gap-6">
                    <p className="text-sm text-white/50">
                      Linking keeps both profiles but shows them as one person.
                      Reversible.
                    </p>
                    <LinkProfiles />
                  </div>
                )}
                {tool === "merge" && (
                  <div className="flex flex-col gap-6">
                    <p className="text-sm text-white/50">
                      Merging moves everything into one profile and deletes the
                      source. Permanent — prefer linking when unsure.
                    </p>
                    <UnifiedMergeProfiles />
                  </div>
                )}
                {tool === "connect" && (
                  <div className="flex flex-col gap-6">
                    <Card>
                      <h2 className="text-lg font-medium">Instagram</h2>
                      <p className="mt-1 text-sm text-white/50">
                        Connect an Instagram account on a person&apos;s profile
                        (Edit profile → Instagram) and use &ldquo;Sync from
                        Instagram&rdquo; there. Or auto-connect every creator
                        folder whose name is a real Instagram account (100%
                        match):
                      </p>
                      <div className="mt-4">
                        <InstagramAutoConnect />
                      </div>
                    </Card>
                    <Card>
                      <h2 className="text-lg font-medium">TikTok</h2>
                      <p className="mt-1 text-sm text-white/50">
                        Connect a TikTok handle on a person&apos;s profile (Edit
                        profile → TikTok) and sync there — no cookie required
                        for public profiles. Or auto-connect every creator
                        folder whose name is a real TikTok account:
                      </p>
                      <div className="mt-4">
                        <TiktokAutoConnect />
                      </div>
                    </Card>
                  </div>
                )}
              </div>
            )}

            {active === "rename" && (
              <div>
                <PanelHeader
                  title="Rename"
                  desc="Re-title media and fix hashtags — the file on disk is renamed to match."
                />
                <RenameTools isAdmin={isAdmin} perms={perms} />
              </div>
            )}

            {active === "members" && isAdmin && (
              <div>
                <PanelHeader
                  title="Members"
                  desc="Approve invite requests and manage registration codes."
                />
                <AdminInvites />
              </div>
            )}
            {active === "jobs" && isAdmin && (
              <div>
                <PanelHeader
                  title="Background jobs"
                  desc="The in-app scheduler: imports, cleanups, syncs and scans."
                />
                <JobsManager />
              </div>
            )}
            {active === "announce" && isAdmin && (
              <div>
                <PanelHeader
                  title="Announce"
                  desc="Broadcast a notification to every user — release notes, downtime, news."
                />
                <AdminAnnounce />
              </div>
            )}
            {active === "permissions" && isAdmin && (
              <div>
                <PanelHeader
                  title="Permissions"
                  desc="Grant users access to individual library sections in Settings."
                />
                <UserPermissions />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Per-section tool panels (Import / Duplicates / Cleaning / Titles / Sources)
// ---------------------------------------------------------------------------
function LibraryToolPanel({
  section,
  tool,
  isAdmin,
  username,
}: {
  section: SectionKey;
  tool: string;
  isAdmin: boolean;
  username: string | null;
}) {
  if (tool === "import") {
    return (
      <ImportTab section={section} isAdmin={isAdmin} username={username} />
    );
  }
  if (tool === "duplicates") {
    if (section === "shorts") return <ShortsDuplicates channel="main" />;
    if (section === "shorts18") return <ShortsDuplicates channel="18plus" />;
    if (section === "posts") return <PostsDuplicates />;
    return <GalleryDuplicates />;
  }
  if (tool === "cleaning") {
    if (section === "shorts") return <ShortsCleanup channel="main" />;
    if (section === "shorts18") return <ShortsCleanup channel="18plus" />;
    if (section === "posts") return <PostsCleanup />;
    return <GalleryCleanup />;
  }
  if (tool === "titles" && isAdmin) {
    const channel = section === "shorts18" ? "18plus" : "main";
    return (
      <>
        <ShortsTitleFetch channel={channel} />
        <ShortsCaptionBackfill channel={channel} />
      </>
    );
  }
  if (tool === "sources" && isAdmin) {
    return section === "shorts18" ? (
      <ShortsAdmin channel="18plus" basePath="/shorts18" />
    ) : (
      <ShortsAdmin channel="main" basePath="/shorts" />
    );
  }
  return null;
}

// Import tab: the user's own drop folder for the section, plus the shared
// creator folder + manual triggers for admins.
function ImportTab({
  section,
  isAdmin,
  username,
}: {
  section: SectionKey;
  isAdmin: boolean;
  username: string | null;
}) {
  const u = username ?? "…";

  const personal: Record<SectionKey, React.ReactNode> = {
    shorts: (
      <Card>
        <h2 className="text-base font-medium">Your drop folder</h2>
        <p className="mb-2 mt-1 text-sm text-white/50">
          Drop video files here and they import as your own clips:
        </p>
        <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          _import/u_{u}/shorts/
        </code>
        <p className="mt-2 text-sm text-white/50">
          Name a file{" "}
          <code className="text-white/70">title [h_tag][f_profile].mp4</code> to
          set caption and hashtags —{" "}
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
    ),
    shorts18: (
      <Card>
        <h2 className="text-base font-medium">Your drop folder</h2>
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
    ),
    posts: (
      <Card>
        <h2 className="text-base font-medium">Your drop folder</h2>
        <p className="mb-2 mt-1 text-sm text-white/50">
          Drop images here and each imports as your own post:
        </p>
        <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          _import/u_{u}/posts/
        </code>
        <p className="mt-2 text-sm text-white/50">
          Name a file <code className="text-white/70">caption [h_tag].jpg</code>{" "}
          (or drop a <code className="text-white/70">.md</code> sidecar) to set
          caption and hashtags. A subfolder publishes its images PUBLICLY under
          that creator profile.
        </p>
      </Card>
    ),
    gallery: (
      <Card>
        <h2 className="text-base font-medium">Your drop folder</h2>
        <p className="mb-2 mt-1 text-sm text-white/50">
          Drop photos and videos here to import them into your gallery:
        </p>
        <code className="block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
          _import/u_{u}/gallery/
        </code>
        <p className="mt-2 text-sm text-white/50">
          A subfolder (or a{" "}
          <code className="text-white/70">[f_album]</code> token) files the
          media into an album with that name.
        </p>
      </Card>
    ),
  };

  const sharedShorts = (channel: "main" | "18plus") => (
    <Card>
      <h2 className="text-base font-medium">Shared creator folder</h2>
      <p className="mb-2 mt-1 text-sm text-white/50">
        Drop files into the shared creator import folder, then sort them in:
      </p>
      <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
        shorts/{channel}/_import/
      </code>
      <p className="mb-3 text-sm text-white/50">
        Name a file{" "}
        <code className="text-white/70">title [h_tag][f_profile].mp4</code> —{" "}
        <code className="text-white/70">[f_profile]</code> sets the creator
        profile and <code className="text-white/70">[h_tag]</code> adds
        hashtags. A subfolder named after the creator (or the legacy{" "}
        <code className="text-white/70">profile_-_title</code>) still works.
      </p>
      <ShortsImportButton channel={channel} />
    </Card>
  );

  return (
    <div className="flex flex-col gap-6">
      {personal[section]}

      {isAdmin && (section === "shorts" || section === "shorts18") &&
        sharedShorts(section === "shorts18" ? "18plus" : "main")}

      {isAdmin && section === "posts" && (
        <Card>
          <h2 className="text-base font-medium">Shared creator folder</h2>
          <p className="mb-2 mt-1 text-sm text-white/50">
            Drop files into the shared import folder, then sort them in:
          </p>
          <code className="mb-2 block rounded-lg bg-white/5 px-3 py-2 text-xs text-white/70">
            posts/_import/
          </code>
          <p className="mb-3 text-sm text-white/50">
            Name a file{" "}
            <code className="text-white/70">title [h_tag][f_creator].jpg</code>{" "}
            — <code className="text-white/70">[f_creator]</code> sets the
            creator and <code className="text-white/70">[h_tag]</code> adds
            hashtags. A subfolder named after the creator (or the legacy{" "}
            <code className="text-white/70">creator_-_title</code>) still
            works. Videos route to Shorts under the same handle.
          </p>
          <PostsImportButton />
        </Card>
      )}

      {isAdmin ? (
        <UserImportButton />
      ) : (
        <p className="px-1 text-sm text-white/40">
          Drop folders are scanned automatically every few minutes.
        </p>
      )}

      <ImportReview />
    </div>
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
// Danger zone — delete account (non-admins only, shown under Account)
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
