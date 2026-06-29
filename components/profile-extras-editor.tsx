"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2, Image as ImageIcon, Eye, EyeOff } from "lucide-react";
import PostAvatar from "@/components/post-avatar";
import AvatarCropModal from "@/components/avatar-crop-modal";
import type { ProfileLink, ProfileField } from "@/lib/profiles";

// Edit a profile's cross-section extras: cover banner, bio, labeled links, and
// the connected Instagram source. Works for the viewer's own profile or, for
// admins, any creator.
export default function ProfileExtrasEditor({
  handle,
  initialBio,
  initialLocation,
  initialLinks,
  initialFields,
  hasBanner,
  initialInstagram,
  initialIgAutoPoll,
  initialTiktok,
  initialTtAutoPoll,
}: {
  handle: string;
  initialBio: string;
  initialLocation: string;
  initialLinks: ProfileLink[];
  initialFields: ProfileField[];
  hasBanner: boolean;
  initialInstagram: string;
  initialIgAutoPoll: boolean;
  initialTiktok: string;
  initialTtAutoPoll: boolean;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const avatarRef = useRef<HTMLInputElement>(null);
  const [avatarBust, setAvatarBust] = useState(0);
  const [bio, setBio] = useState(initialBio);
  const [location, setLocation] = useState(initialLocation);
  const [links, setLinks] = useState<ProfileLink[]>(
    initialLinks.length ? initialLinks : []
  );
  const [fields, setFields] = useState<ProfileField[]>(initialFields ?? []);
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [instagram, setInstagram] = useState(initialInstagram);
  const [igAutoPoll, setIgAutoPoll] = useState(initialIgAutoPoll);
  const [tiktok, setTiktok] = useState(initialTiktok);
  const [ttAutoPoll, setTtAutoPoll] = useState(initialTtAutoPoll);
  const [cookieState, setCookieState] = useState<"active" | "expired" | "missing" | null>(null);
  const [bannerBust, setBannerBust] = useState(hasBanner ? 1 : 0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/instagram/cookies")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setCookieState(d.alive ? "active" : d.enabled ? "expired" : "missing");
      })
      .catch(() => {});
  }, []);

  const setLink = (i: number, field: keyof ProfileLink, value: string) =>
    setLinks((ls) => ls.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  const addLink = () => setLinks((ls) => [...ls, { label: "", url: "" }]);
  const removeLink = (i: number) => setLinks((ls) => ls.filter((_, idx) => idx !== i));

  const setField = (i: number, key: "label" | "value", value: string) =>
    setFields((fs) => fs.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  const toggleFieldPublic = (i: number) =>
    setFields((fs) =>
      fs.map((f, idx) => (idx === i ? { ...f, public: !f.public } : f))
    );
  const addField = () =>
    setFields((fs) => [...fs, { label: "", value: "", public: true }]);
  const removeField = (i: number) =>
    setFields((fs) => fs.filter((_, idx) => idx !== i));

  const uploadAvatar = async (file: Blob) => {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("file", file, "avatar.jpg");
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/avatar`, {
      method: "POST",
      body: fd,
    });
    if (res.ok) {
      setAvatarBust(Date.now());
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Could not upload avatar.");
    }
    setBusy(false);
  };

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
    const cleanFields = fields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim(), public: f.public }))
      .filter((f) => f.label && f.value);
    const res = await fetch(`/api/profiles/${encodeURIComponent(handle)}/extras`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bio,
        location: location.trim(),
        links: clean,
        fields: cleanFields,
        instagramHandle: instagram.trim(),
        igAutoPoll,
        tiktokHandle: tiktok.trim(),
        ttAutoPoll,
      }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setLinks(clean);
      setFields(cleanFields);
      setMsg("Saved.");
      router.refresh();
    } else {
      setError(d.error || "Could not save.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      {/* Avatar */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">Profile picture</span>
        <div className="flex items-center gap-4">
          <PostAvatar
            key={avatarBust}
            username={handle}
            size={72}
            className="text-xl"
            version={avatarBust}
          />
          <input
            ref={avatarRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setCropFile(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => avatarRef.current?.click()}
            disabled={busy}
            className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold transition hover:bg-white/15 disabled:opacity-50"
          >
            Change picture
          </button>
        </div>
      </div>

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
          accept="*/*"
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

      {/* Location */}
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-white/50">Location</span>
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. Stockholm, Sweden"
          maxLength={80}
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
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

      {/* Custom fields */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">
          Details
        </span>
        <p className="mb-2 text-xs text-white/40">
          Labeled facts (e.g. Pronouns, Work). Toggle the eye to make a field
          private — only you see private fields.
        </p>
        <div className="space-y-2">
          {fields.map((f, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={f.label}
                onChange={(e) => setField(i, "label", e.target.value)}
                placeholder="Label"
                className="w-28 shrink-0 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <input
                value={f.value}
                onChange={(e) => setField(i, "value", e.target.value)}
                placeholder="Value"
                className="flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
              />
              <button
                type="button"
                onClick={() => toggleFieldPublic(i)}
                className={`rounded-xl px-2 transition ${
                  f.public ? "text-white/60 hover:text-white" : "text-amber-300"
                }`}
                aria-label={f.public ? "Make private" : "Make public"}
                title={f.public ? "Public — everyone can see this" : "Private — only you"}
              >
                {f.public ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                type="button"
                onClick={() => removeField(i)}
                className="rounded-xl px-2 text-rose-300 transition hover:text-rose-400"
                aria-label="Remove field"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        {fields.length < 12 && (
          <button
            type="button"
            onClick={addField}
            className="mt-2 flex items-center gap-1.5 text-sm text-white/60 hover:text-white"
          >
            <Plus size={14} /> Add field
          </button>
        )}
      </div>

      {/* Instagram source */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">Instagram</span>
        <input
          value={instagram}
          onChange={(e) => setInstagram(e.target.value)}
          placeholder="@username or instagram.com/username"
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={igAutoPoll}
            onChange={(e) => setIgAutoPoll(e.target.checked)}
          />
          Auto-poll daily (pull new posts automatically)
        </label>
        <p className="mt-1 text-xs text-white/40">
          Connect an Instagram account to import its photos as posts and videos
          as shorts on this profile. Use the “Sync from Instagram” button on the
          profile to pull now.
        </p>
        {cookieState === "expired" && (
          <p className="mt-1 text-xs text-amber-400">
            Session cookies are set but expired — re-export cookies.txt or sync will fail.
          </p>
        )}
        {cookieState === "missing" && (
          <p className="mt-1 text-xs text-amber-400">
            No session cookies set — sync needs a logged-in cookies.txt at
            /mnt/4tb/elitev2/instagram/cookies.txt.
          </p>
        )}
        {cookieState === "active" && (
          <p className="mt-1 text-xs text-emerald-400">Session cookies: active.</p>
        )}
      </div>

      {/* TikTok source */}
      <div>
        <span className="mb-1 block text-xs font-medium text-white/50">TikTok</span>
        <input
          value={tiktok}
          onChange={(e) => setTiktok(e.target.value)}
          placeholder="@username or tiktok.com/@username"
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <label className="mt-2 flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={ttAutoPoll}
            onChange={(e) => setTtAutoPoll(e.target.checked)}
          />
          Auto-poll daily (pull new posts automatically)
        </label>
        <p className="mt-1 text-xs text-white/40">
          Connect a TikTok account to import its videos as shorts (and photo
          posts as posts) on this profile. No login cookie is required — use the
          “Sync from TikTok” button on the profile to pull now.
        </p>
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

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onCropped={async (blob) => {
            setCropFile(null);
            await uploadAvatar(blob);
          }}
        />
      )}
    </div>
  );
}
