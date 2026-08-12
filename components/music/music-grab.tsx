"use client";

import { useCallback, useState } from "react";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MusicLibrary } from "@/lib/music-client";

// Admin-only shortcut: hand a URL to Grabbit, which downloads the audio, tags
// it and files it into this Navidrome library. The track shows up here after
// Navidrome's next scan (hourly, or forced from the Navidrome UI).
export default function MusicGrab({ library }: { library: MusicLibrary }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [artists, setArtists] = useState("");
  const [album, setAlbum] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!/^https?:\/\//i.test(url.trim())) {
      setStatus("Enter a full http(s) URL");
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/music/grab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          library,
          artists: artists.trim() || undefined,
          album: album.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.ok === false) {
        setStatus(data.error || "Download failed");
      } else {
        setStatus("Queued — it appears after Navidrome's next scan.");
        setUrl("");
        setArtists("");
        setAlbum("");
      }
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [url, artists, album, library]);

  return (
    <div className="mx-4 mt-4 rounded-xl border border-white/10 bg-white/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm"
      >
        <Download size={16} className="text-white/50" />
        <span className="flex-1">Add music from a link</span>
        <ChevronDown
          size={16}
          className={cn("text-white/40 transition", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-2 border-t border-white/10 p-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
          />
          <div className="flex gap-2">
            <input
              value={artists}
              onChange={(e) => setArtists(e.target.value)}
              placeholder="Artist (optional)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              placeholder="Album (optional)"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
            />
          </div>
          <button
            onClick={submit}
            disabled={busy || !url.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-white py-2 text-sm font-medium text-black transition hover:bg-white/90 disabled:opacity-40"
          >
            {busy && <Loader2 size={15} className="animate-spin" />}
            Download to {library === "kids" ? "kids library" : "library"}
          </button>
          {status && <p className="text-xs text-white/50">{status}</p>}
        </div>
      )}
    </div>
  );
}
