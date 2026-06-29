"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Search, Star, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";

interface Person {
  handle: string;
  displayName: string | null;
  userId: number | null;
  photos: number;
  shortsMain: number;
  shorts18: number;
}

interface Group {
  primary: string;
  members: string[];
}

const input =
  "w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

// Admin tool: non-destructively link several handles for the same person so all
// their content shows under one "face" — but the underlying profiles stay
// separate and keep syncing on their own. Distinct from Merge (which folds +
// deletes the source).
export default function LinkProfiles() {
  const [people, setPeople] = useState<Person[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [primary, setPrimary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);

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

  const loadGroups = useCallback(async () => {
    const r = await fetch("/api/profiles/link");
    const d = await r.json().catch(() => ({}));
    setGroups(Array.isArray(d.groups) ? d.groups : []);
  }, []);

  useEffect(() => {
    load();
    loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = (p: Person) => p.photos + p.shortsMain + p.shorts18;

  const face = useMemo(() => {
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

  async function link() {
    if (!face || sel.size < 2) return;
    setBusy(true);
    setMsg(null);
    const members = Array.from(sel).filter((h) => h !== face);
    try {
      const r = await fetch("/api/profiles/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primaryHandle: face, memberHandles: members }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg({ ok: false, text: d.error || "Link failed." });
        return;
      }
      setMsg({ ok: true, text: `Linked ${members.length} profile(s) under @${face}.` });
      setSel(new Set());
      setPrimary(null);
      setGroups(Array.isArray(d.groups) ? d.groups : groups);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(memberHandle: string) {
    const r = await fetch("/api/profiles/link", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberHandle }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setGroups(Array.isArray(d.groups) ? d.groups : []);
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
      <h2 className="text-lg font-medium">Link profiles</h2>
      <p className="mt-1 text-sm text-white/50">
        Show several profiles as one without merging — each keeps its own folder
        and keeps syncing from its own Instagram/TikTok. Tick the handles, star
        the one to show as the face, then link.
      </p>

      {groups.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-white/40">
            Existing links
          </h3>
          {groups.map((g) => (
            <div key={g.primary} className="rounded-xl bg-white/5 px-3 py-2 text-sm">
              <span className="font-semibold text-amber-300">@{g.primary}</span>
              <span className="text-white/40"> ← </span>
              {g.members.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span className="text-white/30">, </span>}
                  <span className="inline-flex items-center gap-1">
                    @{m}
                    <button
                      type="button"
                      onClick={() => unlink(m)}
                      title="Unlink"
                      className="text-white/40 hover:text-rose-300"
                    >
                      <Link2Off size={13} />
                    </button>
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}

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
          const isFace = face === p.handle;
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
                  title="Show as the face"
                  className={cn(
                    "shrink-0 rounded-full p-1.5 transition",
                    isFace ? "text-amber-400" : "text-white/30 hover:text-white/60"
                  )}
                >
                  <Star size={16} fill={isFace ? "currentColor" : "none"} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {sel.size >= 2 && face && (
        <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-sm text-white/70">
            Show <span className="font-semibold">@{face}</span> as the face for{" "}
            {sel.size} linked profiles.
          </p>
          <button
            type="button"
            onClick={link}
            disabled={busy}
            className="mt-3 flex items-center gap-1.5 rounded-full bg-rose-500 px-5 py-2.5 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Link {sel.size} profiles
          </button>
        </div>
      )}

      {msg && (
        <div
          className={cn("mt-3 text-sm", msg.ok ? "text-green-400" : "text-red-400")}
        >
          {msg.text}
        </div>
      )}
    </div>
  );
}
