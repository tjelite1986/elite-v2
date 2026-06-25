"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, X, Lock, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export default function ShortsUpload({
  defaultChannel,
  basePath = "/shorts",
  lockChannel = false,
}: {
  defaultChannel: "main" | "18plus";
  // Section base path, so the 18+ section keeps its own URL space.
  basePath?: string;
  // When true the channel is fixed to defaultChannel and the selector is hidden
  // (each section uploads only to its own channel — main and 18+ never mix).
  lockChannel?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [channel, setChannel] = useState<"main" | "18plus">(defaultChannel);
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (f: File | null) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", caption);
      form.append("channel", channel);
      form.append("visibility", visibility);
      const res = await fetch("/api/shorts/upload", {
        method: "POST",
        body: form,
      });
      if (res.ok) {
        router.push(basePath);
        router.refresh();
        return;
      }
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Upload failed");
    } catch {
      setError("Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg px-4 py-8 text-white">
      <h1 className="mb-6 text-xl font-semibold">Upload a short</h1>

      <form onSubmit={submit} className="space-y-5">
        {/* Dropzone / preview */}
        {!file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex aspect-[9/16] max-h-[60vh] w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/20 bg-white/5 text-white/60 transition hover:bg-white/10"
          >
            <UploadCloud size={40} />
            <span className="text-sm">Tap to choose a video</span>
          </button>
        ) : (
          <div className="relative mx-auto aspect-[9/16] max-h-[60vh] overflow-hidden rounded-2xl bg-black">
            {previewUrl && (
              <video
                src={previewUrl}
                className="h-full w-full object-contain"
                controls
                playsInline
              />
            )}
            <button
              type="button"
              onClick={() => pick(null)}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5"
            >
              <X size={18} />
            </button>
          </div>
        )}

        {/*
          accept="*\/*" on purpose: a media-only accept (video/*) makes Android
          13+ open the restricted system photo picker, which only exposes
          MediaStore (Google Photos + the camera folder). Allowing any type opens
          the full file browser so the user can pick a video from Downloads, an
          SD card, or any other folder. The server still rejects non-videos
          (isSupportedVideo) and the preview below shows what was chosen.
        */}
        <input
          ref={inputRef}
          type="file"
          accept="*/*"
          className="hidden"
          onChange={(e) => pick(e.target.files?.[0] ?? null)}
        />

        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          placeholder="Caption (optional)"
          rows={3}
          className="w-full resize-none rounded-xl bg-white/10 px-4 py-3 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />

        {/* Channel selector — hidden when the section locks the channel */}
        {!lockChannel && (
        <div className="flex gap-2">
          {(["main", "18plus"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setChannel(c)}
              className={cn(
                "flex-1 rounded-full px-4 py-2 text-sm font-medium transition",
                channel === c
                  ? c === "18plus"
                    ? "bg-rose-500 text-white"
                    : "bg-white text-black"
                  : "bg-white/10 text-white/70"
              )}
            >
              {c === "18plus" ? "18+" : "Main"}
            </button>
          ))}
        </div>
        )}

        {/* Visibility — who can see this clip */}
        <div>
          <div className="flex gap-2">
            {([
              { v: "private", label: "Private", icon: <Lock size={15} /> },
              { v: "public", label: "Public", icon: <Globe size={15} /> },
            ] as const).map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => setVisibility(o.v)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition",
                  visibility === o.v ? "bg-white text-black" : "bg-white/10 text-white/70"
                )}
              >
                {o.icon}
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-1.5 px-1 text-xs text-white/45">
            {visibility === "private"
              ? "Only you can see this clip."
              : "Everyone can see this clip in the feed."}
          </p>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}

        <button
          type="submit"
          disabled={!file || busy}
          className="w-full rounded-full bg-rose-500 py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50"
        >
          {busy ? "Uploading…" : "Post"}
        </button>
      </form>
    </div>
  );
}
