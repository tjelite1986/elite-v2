"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Section = "shorts" | "shorts18" | "posts" | "gallery";

const SECTION_LABELS: Record<Section, string> = {
  shorts: "Shorts",
  shorts18: "18+",
  posts: "Photos (Posts)",
  gallery: "Gallery",
};

interface Item {
  id: number;
  title: string;
}

const card = "rounded-2xl border border-white/10 bg-white/5 p-6";
const input =
  "w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400";

export default function RenameTools({
  isAdmin,
  perms,
}: {
  isAdmin: boolean;
  perms: { shorts: boolean; shorts18: boolean; posts: boolean; gallery: boolean };
}) {
  const sections = (["shorts", "shorts18", "posts", "gallery"] as Section[]).filter(
    (s) => perms[s]
  );
  const [section, setSection] = useState<Section>(sections[0] ?? "shorts");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/rename?section=${section}&q=${encodeURIComponent(q)}`
      );
      const data = await res.json().catch(() => ({}));
      setItems(Array.isArray(data.items) ? data.items : []);
    } finally {
      setLoading(false);
    }
  }, [section, q]);

  useEffect(() => {
    if (sections.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  if (!sections.length && !isAdmin) {
    return <p className="text-sm text-white/50">No sections available to rename.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      {sections.length > 0 && (
        <div className={card}>
          <h2 className="text-lg font-medium">Rename file & tags</h2>
          <p className="mt-1 text-sm text-white/50">
            Fix junk titles and add hashtags. The file on disk is renamed to match,
            so it&apos;s easy to find when browsing the folder.
          </p>

          <div className="mt-4 flex flex-wrap gap-1">
            {sections.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setSection(s);
                  setEditing(null);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-medium transition",
                  section === s
                    ? "bg-white text-black"
                    : "bg-white/10 text-white/70 hover:text-white"
                )}
              >
                {SECTION_LABELS[s]}
              </button>
            ))}
          </div>

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
                placeholder="Search current titles / filenames…"
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

          <div className="mt-4 flex flex-col gap-2">
            {loading && (
              <div className="flex items-center gap-2 text-sm text-white/50">
                <Loader2 size={16} className="animate-spin" /> Loading…
              </div>
            )}
            {!loading && items.length === 0 && (
              <p className="text-sm text-white/40">No items.</p>
            )}
            {items.map((it) =>
              editing === it.id ? (
                <RenameRow
                  key={it.id}
                  section={section}
                  item={it}
                  onDone={() => {
                    setEditing(null);
                    load();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setEditing(it.id)}
                  className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3 py-2 text-left text-sm hover:bg-white/10"
                >
                  <span className="truncate text-white/80">
                    {it.title || <span className="text-white/30">(untitled)</span>}
                  </span>
                  <span className="shrink-0 text-xs text-white/40">#{it.id}</span>
                </button>
              )
            )}
          </div>
        </div>
      )}

      {isAdmin && <ProfileRename />}
    </div>
  );
}

// Inline edit row: title + hashtags, posts to /api/rename.
function RenameRow({
  section,
  item,
  onDone,
  onCancel,
}: {
  section: Section;
  item: Item;
  onDone: () => void;
  onCancel: () => void;
}) {
  // Seed the title from the current value, stripping any existing #tags into the
  // tag field so the user edits them separately.
  const initialTags = (item.title.match(/#[\w]+/g) ?? [])
    .map((t) => t.slice(1))
    .join(" ");
  const initialTitle = item.title.replace(/#[\w]+/g, "").trim();
  const [title, setTitle] = useState(initialTitle);
  const [tags, setTags] = useState(initialTags);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/rename", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section, id: item.id, title, tags }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Rename failed.");
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/15 bg-white/5 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className={input}
        autoFocus
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Hashtags (space or comma separated)"
        className={`${input} mt-2`}
      />
      {error && <div className="mt-2 text-sm text-red-400">{error}</div>}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
        >
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 transition"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface Profile {
  user_id: number;
  username: string;
  display_name: string | null;
}

// Admin-only: rename a user profile's handle + display name.
function ProfileRename() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/rename/profile")
      .then((r) => r.json())
      .then((d) => setProfiles(Array.isArray(d.profiles) ? d.profiles : []))
      .catch(() => {});
  }, []);

  const pick = (p: Profile) => {
    setSel(p.user_id);
    setUsername(p.username);
    setDisplayName(p.display_name ?? "");
    setMsg(null);
  };

  const save = async () => {
    if (sel == null) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/rename/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: sel, username, display_name: displayName }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ ok: false, text: data.error || "Failed." });
        return;
      }
      setMsg({ ok: true, text: "Profile renamed." });
      setProfiles((ps) =>
        ps.map((p) =>
          p.user_id === sel
            ? { ...p, username, display_name: displayName || null }
            : p
        )
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={card}>
      <h2 className="text-lg font-medium">Rename profile</h2>
      <p className="mt-1 text-sm text-white/50">
        Change a user&apos;s handle (username) and display name.
      </p>
      <select
        value={sel ?? ""}
        onChange={(e) => {
          const p = profiles.find((x) => x.user_id === Number(e.target.value));
          if (p) pick(p);
        }}
        className={`${input} mt-4`}
      >
        <option value="" disabled>
          Select a profile…
        </option>
        {profiles.map((p) => (
          <option key={p.user_id} value={p.user_id}>
            @{p.username}
            {p.display_name ? ` — ${p.display_name}` : ""}
          </option>
        ))}
      </select>

      {sel != null && (
        <div className="mt-3 flex flex-col gap-2">
          <label className="text-xs uppercase tracking-wide text-white/40">
            Handle
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="username"
            className={input}
          />
          <label className="mt-1 text-xs uppercase tracking-wide text-white/40">
            Display name
          </label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Display name"
            className={input}
          />
          {msg && (
            <div className={cn("text-sm", msg.ok ? "text-green-400" : "text-red-400")}>
              {msg.text}
            </div>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="mt-2 self-start rounded-full bg-white/15 px-5 py-2.5 text-sm font-medium hover:bg-white/25 transition disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}
