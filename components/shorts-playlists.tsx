"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Trash2, ListVideo, Pencil, Check, X } from "lucide-react";

interface Playlist {
  id: number;
  name: string;
  item_count: number;
  cover_id: number | null;
}

export default function ShortsPlaylists({
  basePath = "/shorts",
}: {
  // Section base path, so playlist links stay within the current section.
  basePath?: string;
}) {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");

  const refresh = async () => {
    const res = await fetch("/api/shorts/playlists");
    if (res.ok) setPlaylists((await res.json()).playlists || []);
    setLoaded(true);
  };

  useEffect(() => {
    refresh();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const res = await fetch("/api/shorts/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (res.ok) {
        setName("");
        await refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Playlist) => {
    if (!confirm(`Delete playlist "${p.name}"?`)) return;
    await fetch(`/api/shorts/playlists/${p.id}`, { method: "DELETE" });
    refresh();
  };

  const startEdit = (p: Playlist) => {
    setEditing(p.id);
    setEditName(p.name);
  };

  const saveEdit = async (p: Playlist) => {
    const n = editName.trim();
    setEditing(null);
    if (!n || n === p.name) return;
    await fetch(`/api/shorts/playlists/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    refresh();
  };

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-16 text-white">
      <h1 className="mb-4 px-1 text-lg font-semibold">Playlists</h1>

      <form onSubmit={create} className="mb-6 flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          className="flex-1 rounded-full bg-white/10 px-4 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold transition active:scale-95 disabled:opacity-50"
        >
          <Plus size={16} /> Create
        </button>
      </form>

      {loaded && playlists.length === 0 ? (
        <p className="py-12 text-center text-sm text-white/50">
          No playlists yet. Create one above, then tap the bookmark on any clip to
          save it here.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {playlists.map((p) => (
            <div
              key={p.id}
              className="group relative overflow-hidden rounded-xl bg-white/5 ring-1 ring-white/10"
            >
              <Link href={`${basePath}/playlists/${p.id}`}>
                <div className="flex aspect-[9/16] items-center justify-center bg-black/30">
                  {p.cover_id ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/shorts/${p.cover_id}/poster`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <ListVideo size={32} className="text-white/30" />
                  )}
                </div>
              </Link>
              <div className="p-2.5">
                {editing === p.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(p);
                        if (e.key === "Escape") setEditing(null);
                      }}
                      className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-white/40"
                    />
                    <button onClick={() => saveEdit(p)} className="text-emerald-400" title="Save">
                      <Check size={16} />
                    </button>
                    <button onClick={() => setEditing(null)} className="text-white/50" title="Cancel">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <Link href={`${basePath}/playlists/${p.id}`} className="block">
                    <div className="truncate text-sm font-semibold">{p.name}</div>
                    <div className="text-xs text-white/50">
                      {p.item_count} clip{p.item_count === 1 ? "" : "s"}
                    </div>
                  </Link>
                )}
              </div>
              {editing !== p.id && (
                <div className="absolute right-2 top-2 flex gap-1">
                  <button
                    onClick={() => startEdit(p)}
                    className="rounded-full bg-black/60 p-1.5 text-white/70 hover:text-white"
                    title="Rename playlist"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => remove(p)}
                    className="rounded-full bg-black/60 p-1.5 text-white/70 hover:text-rose-300"
                    title="Delete playlist"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
