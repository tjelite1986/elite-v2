"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Image as ImageIcon } from "lucide-react";
import type { ProfileLink } from "@/lib/profiles";

// Edit a profile's cross-section extras: cover banner, bio, and labeled links.
// Works for the viewer's own profile or, for admins, any creator.
export default function ProfileExtrasEditor({
  handle,
  initialBio,
  initialLinks,
  hasBanner,
}: {
  handle: string;
  initialBio: string;
  initialLinks: ProfileLink[];
  hasBanner: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [bio, setBio] = useState(initialBio);
  const [links, setLinks] = useState<ProfileLink[]>(
    initialLinks.length ? initialLinks : []
  );
  const [bannerBust, setBannerBust] = useState(hasBanner ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setLink = (i: number, field: keyof ProfileLink, value: string) =>
    setLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  const addLink = () => setLinks((ls) => [...ls, { label: "", url: "" }]);
  const removeLink = (i: number) => setLinks((ls) => ls.filter((_, idx) => idx !== i));

  const uploadBanner = async (file: File) => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/extras`, {
      method: "POST",
      body: fd,
    });
    if (res.ok) {
      setBannerBust(Date.now());
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not upload banner.");
    }
    setBusy(false);
  };

  const save = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    // Normalize: drop blank rows, ensure a protocol.
    const clean = links
      .filter((l) => l.url.trim())
      .map((l) => ({
        label: l.label.trim(),
        url: /^https?:\/\//i.test(l.url.trim()) ? l.url.trim() : `https://${l.url.trim()}`,
      }));
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/extras`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio, links: clean }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setLinks(clean);
      setMsg("Saved.");
      router.refresh();
    } else {
      setError(d.error || "Could not save.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">Cover banner</span>
        <div className="overflow-hidden rounded-2xl bg-white/5">
          {bannerBust ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/profiles/${encodeURIComponent(handle)}/banner?b=${bannerBust}`}
              alt=""
              className="h-32 w-full object-cover sm:h-40"
            />
          ) : (
            <div className="flex h-32 w-full items-center justify-center text-white/30 sm:h-40">
              <ImageIcon size={32} />
            </div>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => e.target.files?.[0] && uploadBanner(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="mt-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15"
        >
          {bannerBust ? "Change banner" : "Upload banner"}
        </button>
      </div>

      {/* Bio */}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Bio</span>
        <textarea
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          rows={3}
          maxLength={500}
          className="w-full resize-none rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/30"
        />
      </label>

      {/* Links */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">Links</span>
        <div className="space-y-2">
          {links.map((l, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={l.label}
                onChange={(e) => setLink(i, "label", e.target.value)}
                placeholder="Label"
                className="w-28 shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <input
                value={l.url}
                onChange={(e) => setLink(i, "url", e.target.value)}
                placeholder="https://…"
                className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <button
                onClick={() => removeLink(i)}
                className="rounded-xl px-2 text-rose-300 transition hover:text-rose-400"
                aria-label="Remove link"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        {links.length < 10 && (
          <button
            onClick={addLink}
            className="mt-2 flex items-center gap-1.5 text-sm text-white/60 hover:text-white"
          >
            <Plus size={14} /> Add link
          </button>
        )}
      </div>

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
