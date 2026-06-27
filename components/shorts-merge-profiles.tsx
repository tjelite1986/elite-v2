"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface P {
  id: number;
  name: string;
  clips: number;
}

// Admin tool: link several handles for the same model into one profile.
export default function ShortsMergeProfiles({
  channel,
}: {
  channel: "main" | "18plus";
}) {
  const [profiles, setProfiles] = useState<P[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [primary, setPrimary] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/admin/shorts/profiles?channel=${channel}`);
    if (!r.ok) return;
    const d = await r.json();
    setProfiles(d.profiles ?? []);
  }, [channel]);

  useEffect(() => {
    load();
  }, [load]);

  function toggle(id: number) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  // The kept profile: the explicit pick if still selected, else the selected one
  // with the most clips.
  const keepId = useMemo(() => {
    const ids = Array.from(sel);
    if (primary && sel.has(primary)) return primary;
    let best: number | null = null;
    let bestClips = -1;
    for (const id of ids) {
      const c = profiles.find((p) => p.id === id)?.clips ?? 0;
      if (c > bestClips) {
        bestClips = c;
        best = id;
      }
    }
    return best;
  }, [sel, primary, profiles]);

  async function merge() {
    if (!keepId || sel.size < 2) return;
    const mergeIds = Array.from(sel).filter((id) => id !== keepId);
    if (mergeIds.length === 0) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/admin/shorts/merge-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ primaryId: keepId, mergeIds }),
      });
      const d = await r.json();
      if (r.ok) {
        setMsg(`Merged ${d.merged} profile(s), moved ${d.reassigned} clip(s).`);
        setSel(new Set());
        setPrimary(null);
        await load();
      } else {
        setMsg(d.error || "Merge failed.");
      }
    } catch {
      setMsg("Merge failed.");
    } finally {
      setBusy(false);
    }
  }

  const filtered = profiles.filter((p) =>
    p.name.toLowerCase().includes(q.trim().toLowerCase())
  );

  return (
    <section className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">Merge profiles</h2>
      <p className="mb-3 text-sm text-white/50">
        Link several handles for the same model into one. Select 2 or more, mark
        which to keep (★), then merge — their clips move to the kept profile and
        the other handles become aliases, so a future import reuses the kept one.
      </p>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search profiles…"
        className="mb-2 w-full rounded-lg bg-white/5 px-3 py-2 text-sm text-white outline-none ring-1 ring-white/10 placeholder:text-white/30 focus:ring-white/30"
      />
      <div className="max-h-72 divide-y divide-white/5 overflow-y-auto rounded-2xl border border-white/10">
        {filtered.map((p) => {
          const on = sel.has(p.id);
          const keep = on && keepId === p.id;
          return (
            <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(p.id)}
                className="size-4 accent-rose-500"
              />
              <span className="flex-1 truncate text-white/90">{p.name}</span>
              <span className="text-xs text-white/40">{p.clips} clips</span>
              {on && (
                <button
                  type="button"
                  onClick={() => setPrimary(p.id)}
                  className={
                    "rounded-full px-2.5 py-1 text-xs font-medium transition " +
                    (keep
                      ? "bg-amber-400/25 text-amber-200 ring-1 ring-amber-300/40"
                      : "bg-white/5 text-white/50 ring-1 ring-white/10 hover:bg-white/10")
                  }
                >
                  {keep ? "★ keep" : "keep"}
                </button>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-3 py-6 text-center text-white/40">No profiles.</div>
        )}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || sel.size < 2 || !keepId}
          onClick={merge}
          className="rounded-full bg-rose-500 px-5 py-2 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-40"
        >
          {sel.size >= 2 ? `Merge ${sel.size - 1} into 1` : "Merge"}
        </button>
        {msg && <span className="text-sm text-white/60">{msg}</span>}
      </div>
    </section>
  );
}
