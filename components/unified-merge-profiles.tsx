"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface Person {
  handle: string;
  displayName: string | null;
  userId: number | null;
  photos: number;
  shortsMain: number;
  shorts18: number;
}

const input =
  "w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

// Admin tool: merge several handles for the same person into one, spanning
// Posts, Shorts and 18+ at once (the unified /people handle namespace). The kept
// profile survives; the others are re-pointed into it via /api/profiles/merge.
export default function UnifiedMergeProfiles() {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [primary, setPrimary] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/people?q=${encodeURIComponent(q)}&limit=60`);
      const d = await r.json().catch(() => ({}));
      setPeople(Array.isArray(d.items) ? d.items : []);
    } finally {
      setLoading(false);
    }
  }, [q]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = (p: Person) => p.photos + p.shortsMain + p.shorts18;

  // The kept profile: the explicit pick if still selected, else the selected one
  // with the most content.
  const keep = useMemo(() => {
    if (primary && sel.has(primary)) return primary;
    let best: string | null = null;
    let bestN = -1;
    for (const h of Array.from(sel)) {
      const p = people.find((x) => x.handle === h);
      const n = p ? total(p) : 0;
      if (n > bestN) {
        bestN = n;
        best = h;
      }
    }
    return best;
  }, [sel, primary, people]);

  function toggle(h: string) {
    setSel((prev) => {
      const n = new Set(prev);
      n.has(h) ? n.delete(h) : n.add(h);
      return n;
    });
  }

  async function merge() {
    if (!keep || sel.size < 2) return;
    setBusy(true);
    setMsg(null);
    const sources = Array.from(sel).filter((h) => h !== keep);
    let ok = 0;
    let fail = 0;
    let lastErr = "";
    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      try {
        // Only the LAST call carries the rename: renaming on the first call
        // changes the kept handle, and every later call would then hit the
        // "name already taken" clash against the just-renamed profile.
        const isLast = i === sources.length - 1;
        const r = await fetch("/api/profiles/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetHandle: keep,
            sourceHandle: src,
            newName: isLast ? newName.trim() || undefined : undefined,
          }),
        });
        const d = await r.json().catch(() => ({}));
        if (r.ok) ok++;
        else {
          fail++;
          lastErr = d.error || "merge failed";
        }
      } catch {
        fail++;
      }
    }
    setBusy(false);
    setMsg({
      ok: fail === 0,
      text:
        fail === 0
          ? `Merged ${ok} profile(s) into @${keep}.`
          : `${ok} merged, ${fail} failed: ${lastErr}`,
    });
    setSel(new Set());
    setPrimary(null);
    setNewName("");
    load();
  }

  const counts = (p: Person) =>
    [
      p.photos ? `${p.photos} photos` : "",
      p.shortsMain ? `${p.shortsMain} shorts` : "",
      p.shorts18 ? `${p.shorts18} 18+` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "no content";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h2 className="text-lg font-medium">Merge profiles</h2>
      <p className="mt-1 text-sm text-white/50">
        One list across Posts, Shorts and 18+. Tick the handles for the same
        person, mark the one to keep with the star, then merge.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
        className="mt-4 flex gap-2"
      >
        <div className="relative flex-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
          />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search people…"
            className={`${input} pl-9`}
          />
        </div>
        <button
          type="submit"
          className="rounded-xl bg-white/15 px-4 py-2.5 text-sm font-medium hover:bg-white/25 transition"
        >
          Search
        </button>
      </form>

      <div className="mt-4 flex max-h-[28rem] flex-col gap-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center gap-2 text-sm text-white/50">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        )}
        {!loading && people.length === 0 && (
          <p className="text-sm text-white/40">No people.</p>
        )}
        {people.map((p) => {
          const checked = sel.has(p.handle);
          const isKeep = keep === p.handle;
          return (
            <div
              key={p.handle}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2",
                checked ? "bg-white/10" : "hover:bg-white/5"
              )}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(p.handle)}
                className="size-4 shrink-0 accent-rose-500"
              />
              <button
                type="button"
                onClick={() => toggle(p.handle)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="truncate text-sm text-white/90">
                  {p.displayName || p.handle}
                  <span className="ml-1 text-white/40">@{p.handle}</span>
                </div>
                <div className="truncate text-xs text-white/40">{counts(p)}</div>
              </button>
              {checked && (
                <button
                  type="button"
                  onClick={() => setPrimary(p.handle)}
                  title="Keep this one"
                  className={cn(
                    "shrink-0 rounded-full p-1.5 transition",
                    isKeep
                      ? "text-amber-400"
                      : "text-white/30 hover:text-white/60"
                  )}
                >
                  <Star size={16} fill={isKeep ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {sel.size >= 2 && keep && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-sm text-white/70">
            Keep <span className="font-semibold">@{keep}</span>, merge{" "}
            {sel.size - 1} other(s) into it.
          </p>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Optional: rename the kept profile"
            className={`${input} mt-3`}
          />
          <button
            type="button"
            onClick={merge}
            disabled={busy}
            className="mt-3 flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Merge {sel.size} profiles
          </button>
        </div>
      )}

      {msg && (
        <div
          className={cn(
            "mt-3 text-sm",
            msg.ok ? "text-green-400" : "text-red-400"
          )}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
