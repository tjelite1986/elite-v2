"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import PostAvatar from "@/components/post-avatar";

interface Profile {
  username: string;
  display_name: string | null;
  bio: string | null;
}

// Edit the viewer's shared public profile: avatar, username, display name, bio.
export default function PostProfileEditor({ initial }: { initial: Profile }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(initial.username);
  const [displayName, setDisplayName] = useState(initial.display_name ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [avatarBust, setAvatarBust] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uploadAvatar = async (file: File) => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
    if (res.ok) {
      setAvatarBust(Date.now());
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not upload avatar.");
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, display_name: displayName, bio }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setMsg("Saved.");
      router.refresh();
    } else {
      setError(d.error || "Could not save.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <span key={avatarBust}>
          <PostAvatar username={username} size={72} className="text-lg" />
        </span>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && uploadAvatar(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15"
        >
          Change avatar
        </button>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Username</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Display name</span>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </label>

      {error && <p className="text-sm text-rose-400">{error}</p>}
      {msg && <p className="text-sm text-emerald-400">{msg}</p>}

      <button
        onClick={save}
        disabled={busy}
        className="flex items-center justify-center gap-2 rounded-full bg-rose-500 px-6 py-2.5 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        Save profile
      </button>
    </div>
  );
}
