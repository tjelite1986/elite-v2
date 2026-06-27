"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RefreshCw, Download, AlertTriangle, Trash2, ImagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ManageApp {
  id: number;
  slug: string;
  name: string;
  section: string;
  category: string;
  requiresPin: boolean;
  featured: boolean;
  editorsChoice: boolean;
  enabled: boolean;
  installCount: number;
  ratingAvg: number;
  ratingCount: number;
  currentVersion: string | null;
  iconUrl: string;
  source: string;
  autoUpdate: boolean;
  updateAvailable: boolean;
  availableVersion: string | null;
  reviewFlag: string | null;
  playPackage: string | null;
  modapkUrl: string | null;
  fdroidPackage: string | null;
  apkpureUrl: string | null;
  lastCheckedAt: string | null;
  createdAt: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  local: "Archive",
  github: "GitHub",
  fdroid: "F-Droid",
  playstore: "Play Store",
};

function Toggle({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs font-medium transition",
        on ? "bg-white text-black" : "bg-white/10 text-white/50 hover:bg-white/15"
      )}
    >
      {label}
    </button>
  );
}

const IMPORT_CFG: Record<string, { endpoint: string; field: string }> = {
  github: { endpoint: "/api/store/admin/import/github", field: "repo" },
  fdroid: { endpoint: "/api/store/admin/import/fdroid", field: "packageId" },
  playstore: { endpoint: "/api/store/admin/import/playstore", field: "packageId" },
};

// Detect the source from a pasted ref. URLs + "owner/repo" are unambiguous; a
// bare dotted package id (com.foo.bar) could be F-Droid OR Play, so it returns
// null and the user picks via the dropdown.
function detectSource(input: string): keyof typeof IMPORT_CFG | null {
  const s = input.trim();
  if (/github\.com/i.test(s) || /^[\w.-]+\/[\w.-]+$/.test(s)) return "github";
  if (/f-droid\.org/i.test(s)) return "fdroid";
  if (/play\.google\.com/i.test(s)) return "playstore";
  return null;
}

// Single "Add an app" input + a source selector (Auto / GitHub / F-Droid / Play).
function UnifiedImport({ onDone }: { onDone: (msg: string) => void }) {
  const [value, setValue] = useState("");
  const [source, setSource] = useState("auto");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const v = value.trim();
    if (!v || busy) return;
    const src = source === "auto" ? detectSource(v) : (source as keyof typeof IMPORT_CFG);
    if (!src) {
      onDone("Pick GitHub / F-Droid / Play for a bare package id.");
      return;
    }
    const cfg = IMPORT_CFG[src];
    setBusy(true);
    try {
      const res = await fetch(cfg.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [cfg.field]: v }),
      });
      const json = await res.json();
      onDone(res.ok ? `Imported "${json.name}"` : `Import: ${json.error}`);
      if (res.ok) setValue("");
    } catch {
      onDone("Import: request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="GitHub repo/URL, F-Droid or Play package id, or a store URL"
        className="w-full rounded-lg bg-black/30 px-3 py-1.5 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10"
      />
      <select
        value={source}
        onChange={(e) => setSource(e.target.value)}
        className="shrink-0 rounded-lg bg-white/10 px-2 py-1.5 text-sm text-white outline-none"
      >
        <option value="auto" className="bg-neutral-900">Auto</option>
        <option value="github" className="bg-neutral-900">GitHub</option>
        <option value="fdroid" className="bg-neutral-900">F-Droid</option>
        <option value="playstore" className="bg-neutral-900">Play</option>
      </select>
      <button
        onClick={submit}
        disabled={busy}
        className="shrink-0 rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
      >
        {busy ? "…" : "Add"}
      </button>
    </div>
  );
}

const linkBtn =
  "rounded-full px-2.5 py-1 text-xs font-medium disabled:opacity-50";

// One address input + two buttons (Link Play / Link Mod APK) plus the linked
// states with their own actions.
function AppLinks({
  app,
  onDone,
}: {
  app: ManageApp;
  onDone: (msg?: string) => void;
}) {
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(url: string, method: string, body?: unknown): Promise<any> {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  }

  async function linkPlay() {
    if (!addr.trim() || busy) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-play`, "PUT", {
      packageId: addr.trim(),
      refreshMeta: true,
    });
    setBusy(false);
    if (ok) setAddr("");
    onDone(ok ? `Linked Play: ${json.playName}${json.icon ? " + logo" : ""}` : `Play: ${json.error}`);
  }

  async function linkMod() {
    if (!addr.trim() || busy) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-modapk`, "PUT", {
      url: addr.trim(),
    });
    setBusy(false);
    if (ok) setAddr("");
    onDone(
      ok
        ? `Mod APK: ${json.name}${json.version ? ` v${json.version}` : ""}${json.icon ? " + logo" : ""}${json.banner ? " + banner" : ""}`
        : `Mod APK: ${json.error}`
    );
  }

  async function linkFdroid() {
    if (!addr.trim() || busy) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-fdroid`, "PUT", {
      packageId: addr.trim(),
      refreshMeta: true,
    });
    setBusy(false);
    if (ok) setAddr("");
    onDone(
      ok
        ? `F-Droid: ${json.name}${json.version ? ` v${json.version}` : ""}${json.icon ? " + logo" : ""}`
        : `F-Droid: ${json.error}`
    );
  }

  async function linkApkpure() {
    if (!addr.trim() || busy) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-apkpure`, "PUT", {
      url: addr.trim(),
    });
    setBusy(false);
    if (ok) setAddr("");
    onDone(
      ok
        ? `APKPure: ${json.name}${json.version ? ` v${json.version}` : ""}${json.icon ? " + logo" : ""}${json.screenshots ? ` + ${json.screenshots} shots` : ""}`
        : `APKPure: ${json.error}`
    );
  }

  async function refetchApkpure() {
    if (busy || !app.apkpureUrl) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-apkpure`, "PUT", {
      url: app.apkpureUrl,
    });
    setBusy(false);
    onDone(ok ? `Refreshed APKPure: ${json.name}` : `APKPure: ${json.error}`);
  }

  async function refetchMod() {
    if (busy || !app.modapkUrl) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-modapk`, "PUT", {
      url: app.modapkUrl,
    });
    setBusy(false);
    onDone(ok ? `Re-fetched: ${json.name}` : `Mod APK: ${json.error}`);
  }

  async function checkPlay() {
    if (busy) return;
    setBusy(true);
    await call(`/api/store/admin/apps/${app.id}/check`, "POST");
    setBusy(false);
    onDone();
  }

  // Re-pull metadata (icon / description / screenshots) for an already-linked
  // Play package without retyping it.
  async function refetchPlay() {
    if (busy || !app.playPackage) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-play`, "PUT", {
      packageId: app.playPackage,
      refreshMeta: true,
    });
    setBusy(false);
    onDone(ok ? `Refreshed Play: ${json.playName}${json.icon ? " + logo" : ""}` : `Play: ${json.error}`);
  }

  async function refetchFdroid() {
    if (busy || !app.fdroidPackage) return;
    setBusy(true);
    const { ok, json } = await call(`/api/store/admin/apps/${app.id}/link-fdroid`, "PUT", {
      packageId: app.fdroidPackage,
      refreshMeta: true,
    });
    setBusy(false);
    onDone(ok ? `Refreshed F-Droid: ${json.name}${json.icon ? " + logo" : ""}` : `F-Droid: ${json.error}`);
  }

  async function unlink(kind: "play" | "modapk" | "fdroid" | "apkpure") {
    setBusy(true);
    await call(`/api/store/admin/apps/${app.id}/link-${kind}`, "DELETE");
    setBusy(false);
    const label =
      kind === "play" ? "Play" : kind === "fdroid" ? "F-Droid" : kind === "apkpure" ? "APKPure" : "Mod APK";
    onDone(`${label} link removed`);
  }

  async function checkFdroid() {
    if (busy) return;
    setBusy(true);
    await call(`/api/store/admin/apps/${app.id}/check`, "POST");
    setBusy(false);
    onDone();
  }

  return (
    <div className="mt-2 space-y-1.5 border-t border-white/5 pt-2">
      {/* Address input row + two link buttons */}
      <input
        value={addr}
        onChange={(e) => setAddr(e.target.value)}
        placeholder="Play / F-Droid package id, or an APKPure / mod-apk URL"
        className="w-full rounded-lg bg-black/30 px-2.5 py-1.5 text-xs text-white placeholder-white/30 outline-none ring-1 ring-white/10"
      />
      <div className="flex flex-wrap gap-1.5">
        {app.source !== "playstore" && (
          <button
            onClick={linkPlay}
            disabled={busy}
            className={cn(linkBtn, "bg-sky-500/80 text-white hover:bg-sky-500")}
          >
            Link Play
          </button>
        )}
        {app.source !== "fdroid" && (
          <button
            onClick={linkFdroid}
            disabled={busy}
            className={cn(linkBtn, "bg-indigo-500/80 text-white hover:bg-indigo-500")}
          >
            Link F-Droid
          </button>
        )}
        <button
          onClick={linkApkpure}
          disabled={busy}
          className={cn(linkBtn, "bg-orange-500/80 text-white hover:bg-orange-500")}
        >
          Link APKPure
        </button>
        <button
          onClick={linkMod}
          disabled={busy}
          className={cn(linkBtn, "bg-emerald-500/80 text-white hover:bg-emerald-500")}
        >
          Link Mod APK
        </button>
      </div>

      {/* Linked states */}
      {app.playPackage && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="truncate text-sky-300">Play: {app.playPackage}</span>
          <button onClick={refetchPlay} disabled={busy} className={cn(linkBtn, "bg-sky-500/80 text-white hover:bg-sky-500")}>
            Refresh
          </button>
          <button onClick={checkPlay} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/80 hover:bg-white/15")}>
            Check
          </button>
          <button onClick={() => unlink("play")} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/70 hover:bg-white/15")}>
            Unlink
          </button>
        </div>
      )}
      {app.fdroidPackage && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="truncate text-indigo-300">F-Droid: {app.fdroidPackage}</span>
          <button onClick={refetchFdroid} disabled={busy} className={cn(linkBtn, "bg-indigo-500/80 text-white hover:bg-indigo-500")}>
            Refresh
          </button>
          <button onClick={checkFdroid} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/80 hover:bg-white/15")}>
            Check
          </button>
          <button onClick={() => unlink("fdroid")} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/70 hover:bg-white/15")}>
            Unlink
          </button>
        </div>
      )}
      {app.apkpureUrl && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="truncate text-orange-300">
            APKPure: {app.apkpureUrl.replace(/^https?:\/\//, "")}
          </span>
          <button onClick={refetchApkpure} disabled={busy} className={cn(linkBtn, "bg-orange-500/80 text-white hover:bg-orange-500")}>
            Refresh
          </button>
          <button onClick={() => unlink("apkpure")} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/70 hover:bg-white/15")}>
            Unlink
          </button>
        </div>
      )}
      {app.modapkUrl && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="truncate text-emerald-300">
            Mod APK: {app.modapkUrl.replace(/^https?:\/\//, "")}
          </span>
          <button onClick={refetchMod} disabled={busy} className={cn(linkBtn, "bg-emerald-500/80 text-white hover:bg-emerald-500")}>
            Re-fetch
          </button>
          <button onClick={() => unlink("modapk")} disabled={busy} className={cn(linkBtn, "bg-white/10 text-white/70 hover:bg-white/15")}>
            Unlink
          </button>
        </div>
      )}
    </div>
  );
}

export default function StoreManage({ apps }: { apps: ManageApp[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(apps);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  // Filters / sort for the app list.
  const [query, setQuery] = useState("");
  const [linkState, setLinkState] = useState<"all" | "linked" | "unlinked">("all");
  const [updatesOnly, setUpdatesOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "added" | "checked" | "updates">("name");

  // Re-sync local rows when the server data refreshes (router.refresh), so link
  // / check / import results show without a manual page reload.
  useEffect(() => {
    setRows(apps);
  }, [apps]);

  function refresh(m?: string) {
    if (m) setMsg(m);
    router.refresh();
  }

  async function setFlag(
    id: number,
    flag: "featured" | "editors_choice" | "enabled",
    value: boolean
  ) {
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              featured: flag === "featured" ? value : r.featured,
              editorsChoice: flag === "editors_choice" ? value : r.editorsChoice,
              enabled: flag === "enabled" ? value : r.enabled,
            }
          : r
      )
    );
    await fetch(`/api/store/admin/apps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ flag, value }),
    });
  }

  async function post(url: string, body?: unknown): Promise<any> {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json().catch(() => ({}));
  }

  async function rescan() {
    setBusy("rescan");
    const json = await post("/api/store/admin/sync");
    setBusy("");
    refresh(`Archive: scanned ${json.scanned}, +${json.inserted}, ~${json.updated}.`);
  }

  async function checkAll(source: string) {
    setBusy("check");
    const json = await post("/api/store/admin/check-updates", { source });
    setBusy("");
    refresh(`Checked ${json.checked}, ${json.updates} update(s), ${json.errors} error(s).`);
  }

  async function updateAll() {
    setBusy("update-all");
    const json = await post("/api/store/admin/update-all");
    setBusy("");
    refresh(`Updated ${json.updated}, failed ${json.failed}.`);
  }

  async function rowCheck(id: number) {
    setBusy(`row-${id}`);
    await post(`/api/store/admin/apps/${id}/check`);
    setBusy("");
    refresh();
  }
  async function rowUpdate(id: number) {
    setBusy(`row-${id}`);
    const json = await post(`/api/store/admin/apps/${id}/update`);
    setBusy("");
    refresh(json.status ? `Update: ${json.status}` : undefined);
  }
  async function rowApprove(id: number) {
    setBusy(`row-${id}`);
    await post(`/api/store/admin/apps/${id}/approve-signer`);
    setBusy("");
    refresh("Signer approved — run Update now.");
  }
  async function rowAuto(id: number, enabled: boolean) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, autoUpdate: enabled } : r)));
    await fetch(`/api/store/admin/apps/${id}/auto-update`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  }

  async function uploadIcon(id: number, file?: File) {
    if (!file) return;
    setBusy(`row-${id}`);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/store/admin/apps/${id}/icon`, {
      method: "PUT",
      body: form,
    });
    setBusy("");
    refresh(res.ok ? "Icon updated." : "Icon upload failed.");
  }

  async function deleteApp(id: number, name: string) {
    if (!window.confirm(`Delete "${name}" from the catalog?`)) return;
    setBusy(`row-${id}`);
    await fetch(`/api/store/admin/apps/${id}`, { method: "DELETE" });
    setRows((rs) => rs.filter((r) => r.id !== id));
    setBusy("");
    refresh(`Deleted "${name}".`);
  }

  const isLinked = (a: ManageApp) =>
    !!(a.playPackage || a.modapkUrl || a.fdroidPackage || a.apkpureUrl) ||
    ["github", "fdroid", "playstore"].includes(a.source);

  const q = query.trim().toLowerCase();
  const visibleRows = rows
    .filter((a) => {
      if (q && !`${a.name} ${a.slug}`.toLowerCase().includes(q)) return false;
      if (linkState === "linked" && !isLinked(a)) return false;
      if (linkState === "unlinked" && isLinked(a)) return false;
      if (updatesOnly && !a.updateAvailable) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === "added") {
        // Most-recently-added first (created_at desc), tiebreak by id.
        const c = (b.createdAt || "").localeCompare(a.createdAt || "");
        return c !== 0 ? c : b.id - a.id;
      }
      if (sortBy === "checked") {
        // Most-recently-checked first; never-checked last.
        return (b.lastCheckedAt || "").localeCompare(a.lastCheckedAt || "");
      }
      if (sortBy === "updates") {
        if (a.updateAvailable !== b.updateAvailable) return a.updateAvailable ? -1 : 1;
        return a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });

  const updateCount = rows.filter((a) => a.updateAvailable).length;
  const chip = (active: boolean) =>
    cn(
      "rounded-full px-3 py-1.5 text-xs font-medium transition",
      active ? "bg-white text-black" : "bg-white/10 text-white/80 hover:bg-white/15"
    );

  return (
    <div>
      {/* Add from external sources — one input + a source selector */}
      <div className="mb-4 space-y-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <p className="text-sm font-semibold text-white">Add an app</p>
        <UnifiedImport onDone={refresh} />
        <p className="text-xs text-white/40">
          Auto-detects from a URL or owner/repo. For a bare package id, pick
          F-Droid or Play in the dropdown.
        </p>
      </div>

      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={rescan}
          disabled={!!busy}
          className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-50"
        >
          <RefreshCw className={cn("h-4 w-4", busy === "rescan" && "animate-spin")} />
          Rescan archive
        </button>
        <button
          onClick={() => checkAll("all")}
          disabled={!!busy}
          className="rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          Check all updates
        </button>
        <button
          onClick={() => checkAll("playstore")}
          disabled={!!busy}
          className="rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          Check Play
        </button>
        <button
          onClick={updateAll}
          disabled={!!busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-sky-500 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          <Download className="h-4 w-4" /> Update all
        </button>
        {msg && <span className="text-xs text-white/50">{msg}</span>}
      </div>

      {/* Filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search apps…"
          className="min-w-[140px] flex-1 rounded-full bg-white/[0.06] px-4 py-1.5 text-sm text-white placeholder-white/30 outline-none ring-1 ring-white/10 focus:ring-white/30"
        />
        <button className={chip(linkState === "all")} onClick={() => setLinkState("all")}>
          All
        </button>
        <button className={chip(linkState === "unlinked")} onClick={() => setLinkState("unlinked")}>
          Unlinked
        </button>
        <button className={chip(linkState === "linked")} onClick={() => setLinkState("linked")}>
          Linked
        </button>
        <button className={chip(updatesOnly)} onClick={() => setUpdatesOnly((v) => !v)}>
          Updates{updateCount ? ` (${updateCount})` : ""}
        </button>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white outline-none ring-1 ring-white/10"
        >
          <option value="name">Sort: Name</option>
          <option value="added">Sort: Recently added</option>
          <option value="checked">Sort: Last checked</option>
          <option value="updates">Sort: Updates first</option>
        </select>
        <span className="text-xs text-white/40">
          {visibleRows.length}/{rows.length}
        </span>
      </div>

      <div className="space-y-2">
        {visibleRows.length === 0 && (
          <p className="rounded-2xl bg-white/[0.03] p-6 text-center text-sm text-white/40 ring-1 ring-white/10">
            No apps match the filter.
          </p>
        )}
        {visibleRows.map((a) => (
          <div
            key={a.id}
            className="space-y-2 rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10"
          >
            {/* Clickable header → app page */}
            <Link href={`/store/${a.slug}`} className="flex items-center gap-3 hover:opacity-90">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.iconUrl}
                alt=""
                className="h-12 w-12 shrink-0 rounded-xl ring-1 ring-white/10"
                loading="lazy"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">
                  {a.name}
                  {a.requiresPin && <span className="ml-2 text-xs text-rose-400">18+</span>}
                  {a.reviewFlag && (
                    <span className="ml-2 inline-flex items-center gap-1 text-xs text-amber-400">
                      <AlertTriangle className="h-3 w-3" /> {a.reviewFlag}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-white/40">
                  {SOURCE_LABEL[a.source] || a.source} · {a.category} ·{" "}
                  {a.currentVersion ? `v${a.currentVersion}` : "no version"}
                  {a.updateAvailable && a.availableVersion && (
                    <span className="text-sky-300"> · update v{a.availableVersion}</span>
                  )}
                </p>
              </div>
            </Link>

            {/* Toggles + actions on their own row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Toggle on={a.featured} label="Featured" onClick={() => setFlag(a.id, "featured", !a.featured)} />
              <Toggle
                on={a.editorsChoice}
                label="Editor's"
                onClick={() => setFlag(a.id, "editors_choice", !a.editorsChoice)}
              />
              <Toggle
                on={a.enabled}
                label={a.enabled ? "Enabled" : "Hidden"}
                onClick={() => setFlag(a.id, "enabled", !a.enabled)}
              />
              <label className="inline-flex cursor-pointer items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/70 hover:bg-white/15">
                <ImagePlus className="h-3 w-3" /> Icon
                <input
                  type="file"
                  accept="*/*"
                  className="hidden"
                  onChange={(e) => uploadIcon(a.id, e.target.files?.[0])}
                />
              </label>
              <button
                onClick={() => deleteApp(a.id, a.name)}
                disabled={busy === `row-${a.id}`}
                className="inline-flex items-center gap-1 rounded-full bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/30 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>

            {/* Update controls for external sources */}
            {a.source !== "local" && (
              <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-2">
                <button
                  onClick={() => rowCheck(a.id)}
                  disabled={busy === `row-${a.id}`}
                  className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/80 hover:bg-white/15 disabled:opacity-50"
                >
                  Check
                </button>
                {a.source !== "playstore" && (
                  <button
                    onClick={() => rowUpdate(a.id)}
                    disabled={busy === `row-${a.id}`}
                    className="rounded-full bg-sky-500/80 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    Update now
                  </button>
                )}
                {a.source !== "playstore" && (
                  <Toggle
                    on={a.autoUpdate}
                    label="Auto-update"
                    onClick={() => rowAuto(a.id, !a.autoUpdate)}
                  />
                )}
                {a.reviewFlag === "signer_mismatch" && (
                  <button
                    onClick={() => rowApprove(a.id)}
                    className="rounded-full bg-amber-500/80 px-2.5 py-1 text-xs font-medium text-black hover:bg-amber-500"
                  >
                    Approve new signer
                  </button>
                )}
              </div>
            )}

            {/* Link a Play package and/or a mod-apk page (address + 2 buttons). */}
            <AppLinks app={a} onDone={refresh} />
          </div>
        ))}
      </div>
    </div>
  );
}
