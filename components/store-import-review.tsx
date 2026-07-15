"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { FolderSearch, Search, Trash2, PackagePlus } from "lucide-react";
import { cn } from "@/lib/utils";

// Review queue for the app-store folder import: APKs dropped in the import
// folder that could not be auto-matched. The admin attaches each file to a
// suggested app, picks one manually, links it to a NEW app found on the Play
// Store, creates a bare app from the parsed name, or discards the file.

export interface ImportReviewItem {
  id: number;
  originalName: string;
  parsedName: string | null;
  parsedVersion: string | null;
  packageName: string | null;
  fileSize: number;
  reason: string;
  matchedAppId: number | null;
  suggestions: { appId: number; name: string; score: number; why: string }[];
  createdAt: string;
}

export interface PickableApp {
  id: number;
  name: string;
  iconUrl: string;
}

interface PlayResult {
  packageId: string;
  name: string;
  developer: string | null;
  iconUrl: string | null;
  score: number;
}

function formatSize(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes > 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

const REASON_LABEL: Record<string, string> = {
  no_match: "No matching app",
  ambiguous: "Several candidates",
  duplicate: "Version already exists",
  signer_mismatch: "Signing key mismatch",
};

const btn =
  "rounded-full px-3 py-1.5 text-xs font-medium transition disabled:opacity-50";

function ReviewCard({
  item,
  apps,
  busy,
  onDecide,
}: {
  item: ImportReviewItem;
  apps: PickableApp[];
  busy: boolean;
  onDecide: (
    body: Record<string, unknown>,
    confirmText?: string
  ) => Promise<void>;
}) {
  const [pickQuery, setPickQuery] = useState("");
  const [playQuery, setPlayQuery] = useState(item.parsedName || "");
  const [playResults, setPlayResults] = useState<PlayResult[] | null>(null);
  const [playBusy, setPlayBusy] = useState(false);

  const picks = pickQuery.trim()
    ? apps
        .filter((a) => a.name.toLowerCase().includes(pickQuery.trim().toLowerCase()))
        .slice(0, 6)
    : [];

  async function searchPlay() {
    setPlayBusy(true);
    setPlayResults(null);
    try {
      const res = await fetch(
        `/api/store/admin/import/play-search?q=${encodeURIComponent(playQuery)}`
      );
      const json = await res.json();
      setPlayResults(json.results || []);
    } catch {
      setPlayResults([]);
    }
    setPlayBusy(false);
  }

  return (
    <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all text-sm font-semibold text-white">
          {item.originalName}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            item.reason === "signer_mismatch" || item.reason === "duplicate"
              ? "bg-amber-500/20 text-amber-300"
              : "bg-white/10 text-white/60"
          )}
        >
          {REASON_LABEL[item.reason] || item.reason}
        </span>
      </div>
      <p className="mt-1 text-xs text-white/50">
        {item.parsedName && <>Name: {item.parsedName} · </>}
        {item.parsedVersion && <>Version: {item.parsedVersion} · </>}
        {item.packageName && <>Package: {item.packageName} · </>}
        {formatSize(item.fileSize)}
      </p>

      {item.suggestions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-white/50">Attach to:</span>
          {item.suggestions.map((s) => (
            <button
              key={s.appId}
              disabled={busy}
              onClick={() =>
                onDecide({ action: "attach", appId: s.appId })
              }
              title={s.why}
              className={cn(btn, "bg-white text-black")}
            >
              {s.name}
              <span className="ml-1 text-black/50">
                {Math.round(s.score * 100)}%
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Manual pick from the whole catalog */}
      <div className="mt-2">
        <input
          value={pickQuery}
          onChange={(e) => setPickQuery(e.target.value)}
          placeholder="Attach to another app — type to search the catalog"
          className="w-full rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none ring-1 ring-white/10 focus:ring-white/30"
        />
        {picks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {picks.map((a) => (
              <button
                key={a.id}
                disabled={busy}
                onClick={() => onDecide({ action: "attach", appId: a.id })}
                className={cn(btn, "flex items-center gap-1.5 bg-white/10 text-white hover:bg-white/15")}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.iconUrl} alt="" className="h-4 w-4 rounded" />
                {a.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Link to a NEW app via Play Store search */}
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={playQuery}
          onChange={(e) => setPlayQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && playQuery.trim() && searchPlay()}
          placeholder="Search Play Store to create a new app"
          className="min-w-0 flex-1 rounded-lg bg-white/[0.06] px-3 py-1.5 text-xs text-white placeholder-white/30 outline-none ring-1 ring-white/10 focus:ring-white/30"
        />
        <button
          onClick={searchPlay}
          disabled={busy || playBusy || !playQuery.trim()}
          className={cn(btn, "flex items-center gap-1 bg-white/10 text-white hover:bg-white/15")}
        >
          <Search className={cn("h-3.5 w-3.5", playBusy && "animate-pulse")} />
          Search
        </button>
      </div>
      {playResults && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {playResults.length === 0 && (
            <span className="text-xs text-white/40">No Play Store results.</span>
          )}
          {playResults.map((r) => (
            <button
              key={r.packageId}
              disabled={busy}
              onClick={() =>
                onDecide({ action: "create-play", packageId: r.packageId })
              }
              title={r.packageId}
              className={cn(btn, "flex items-center gap-1.5 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25")}
            >
              {r.iconUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={r.iconUrl} alt="" className="h-4 w-4 rounded" />
              )}
              {r.name}
              {r.developer && <span className="text-emerald-300/50">{r.developer}</span>}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button
          disabled={busy}
          onClick={() => onDecide({ action: "create-new" })}
          className={cn(btn, "flex items-center gap-1 bg-white/10 text-white hover:bg-white/15")}
        >
          <PackagePlus className="h-3.5 w-3.5" />
          Create new app{item.parsedName ? ` "${item.parsedName}"` : ""}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            onDecide(
              { action: "discard" },
              `Discard "${item.originalName}"? The file is deleted.`
            )
          }
          className={cn(btn, "flex items-center gap-1 bg-red-500/15 text-red-300 hover:bg-red-500/25")}
        >
          <Trash2 className="h-3.5 w-3.5" />
          Discard
        </button>
      </div>
    </div>
  );
}

export default function StoreImportReview({
  items,
  apps,
  importPath,
}: {
  items: ImportReviewItem[];
  apps: PickableApp[];
  importPath: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(items);
  const [busy, setBusy] = useState<number | "scan" | null>(null);
  const [msg, setMsg] = useState("");

  useEffect(() => setRows(items), [items]);

  async function scan() {
    setBusy("scan");
    try {
      const res = await fetch("/api/store/admin/import/folder", { method: "POST" });
      const json = await res.json();
      const parts: string[] = [];
      for (const i of json.imported || []) {
        parts.push(`${i.file} → ${i.app} ${i.version}${i.promoted ? "" : " (kept older current)"}`);
      }
      for (const p of json.parked || []) parts.push(`${p.file}: ${p.reason}`);
      for (const s of json.skipped || []) parts.push(`${s.file}: ${s.note}`);
      setMsg(
        parts.length
          ? `Scanned ${json.scanned}. ${parts.join(" · ")}`
          : `Scanned ${json.scanned ?? 0} file(s) — nothing to do.`
      );
    } catch {
      setMsg("Scan failed.");
    }
    setBusy(null);
    router.refresh();
  }

  async function decide(
    item: ImportReviewItem,
    body: Record<string, unknown>,
    confirmText?: string
  ) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(item.id);
    try {
      const res = await fetch("/api/store/admin/import/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, ...body }),
      });
      const json = await res.json();
      if (json.ok) {
        setRows((rs) => rs.filter((r) => r.id !== item.id));
        setMsg(
          body.action === "discard"
            ? `Discarded ${item.originalName}.`
            : `${item.originalName} → ${json.appName || "app"} ${json.version || ""}`.trim() + "."
        );
        router.refresh();
      } else if (json.signerMismatch) {
        if (
          window.confirm(
            `${json.error}.\n\nAttach anyway and trust the new signing key?`
          )
        ) {
          setBusy(null);
          await decide(item, { ...body, force: true });
          return;
        }
      } else {
        setMsg(json.error || "Action failed.");
      }
    } catch {
      setMsg("Action failed.");
    }
    setBusy(null);
  }

  return (
    <div className="mb-4 space-y-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">
          Import folder
          {rows.length > 0 && (
            <span className="ml-2 rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] font-medium text-amber-300">
              {rows.length} to review
            </span>
          )}
        </p>
        <button
          onClick={scan}
          disabled={busy !== null}
          className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
        >
          <FolderSearch className={cn("h-3.5 w-3.5", busy === "scan" && "animate-pulse")} />
          Scan now
        </button>
      </div>
      <p className="text-xs text-white/40">
        Drop APK files in <code className="text-white/60">{importPath}</code> —
        they are matched by package id and name and imported automatically;
        anything uncertain lands here for review.
      </p>
      {msg && <p className="text-xs text-emerald-300/90">{msg}</p>}
      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map((item) => (
            <ReviewCard
              key={item.id}
              item={item}
              apps={apps}
              busy={busy === item.id}
              onDecide={(body, confirmText) => decide(item, body, confirmText)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
