"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import MentionInput from "@/components/mention-input";

interface Picked {
  file: File;
  url: string;
}

// Create a post: pick images, write a caption, optionally flag 18+. Posts to
// /api/posts/create as multipart and navigates to the new post on success.
export default function PostComposer({ canFlagAdult }: { canFlagAdult: boolean }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [caption, setCaption] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next = Array.from(files)
      .slice(0, 10 - picked.length)
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPicked((p) => [...p, ...next].slice(0, 10));
  };

  const removeAt = (i: number) => {
    setPicked((p) => {
      URL.revokeObjectURL(p[i].url);
      return p.filter((_, idx) => idx !== i);
    });
  };

  const submit = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("caption", caption);
    fd.set("is_adult", isAdult ? "1" : "0");
    for (const p of picked) fd.append("files", p.file);
    try {
      const res = await fetch("/api/posts/create", { method: "POST", body: fd });
      const d = await res.json().catch(() => ({}));
      if (res.ok) {
        router.push(`/posts/p/${d.id}`);
        router.refresh();
      } else {
        setError(d.error || "Could not share the post.");
        setBusy(false);
      }
    } catch {
      setError("Could not share the post.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md space-y-4">
      <input
        ref={inputRef}
        type="file"
        accept="*/*"
        multiple
        hidden
        onChange={(e) => addFiles(e.target.files)}
      />

      {picked.length === 0 ? (
        <button
          onClick={() => inputRef.current?.click()}
          className="flex aspect-square w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-white/15 text-white/50 transition hover:border-white/30 hover:text-white/70"
        >
          <ImagePlus size={40} />
          <span className="text-sm font-medium">Select photos</span>
        </button>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {picked.map((p, i) => (
            <div key={p.url} className="relative aspect-square overflow-hidden rounded-lg bg-white/5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" className="h-full w-full object-cover" />
              <button
                onClick={() => removeAt(i)}
                className="absolute right-1 top-1 rounded-full bg-black/70 p-1 text-white"
                aria-label="Remove"
              >
                <X size={13} />
              </button>
            </div>
          ))}
          {picked.length < 10 && (
            <button
              onClick={() => inputRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-white/50 hover:text-white/70"
            >
              <ImagePlus size={24} />
            </button>
          )}
        </div>
      )}

      <MentionInput
        value={caption}
        onChange={setCaption}
        placeholder="Write a caption…  #hashtags and @mentions work"
        multiline
        rows={3}
        className="w-full resize-none rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
      />

      {canFlagAdult && (
        <label className="flex items-center gap-2 text-sm text-white/70">
          <input
            type="checkbox"
            checked={isAdult}
            onChange={(e) => setIsAdult(e.target.checked)}
            className="size-4 accent-rose-500"
          />
          Mark as 18+ (hidden until the PIN is unlocked)
        </label>
      )}

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <button
        onClick={submit}
        disabled={busy || picked.length === 0}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-rose-500 px-5 py-3 text-sm font-semibold text-white transition active:scale-95 disabled:opacity-50"
      >
        {busy && <Loader2 size={16} className="animate-spin" />}
        {busy ? "Sharing…" : "Share"}
      </button>
    </div>
  );
}
