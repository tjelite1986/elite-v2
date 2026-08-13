"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Hash, Loader2, Send, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import type { MusicLink } from "@/lib/music-share";
import { musicShareUrl } from "@/lib/music-share";
import { Cover } from "@/components/music/common";

interface ShareUser {
  id: number;
  email: string;
}
interface ShareChannel {
  id: number;
  name: string;
}

// Share a track, album, artist or playlist into Elite: copy the link, hand it
// to the OS share sheet, or send it straight into a DM or a channel. The link
// is an ordinary in-app URL, and the chat renders it as a playable card
// (components/music/music-link-card.tsx).
export default function MusicShareSheet({
  open,
  onClose,
  link,
  albumId,
  title,
  subtitle,
  coverArt,
}: {
  open: boolean;
  onClose: () => void;
  link: MusicLink;
  /** A song lives inside its album's page, so its link needs the album id. */
  albumId?: string | null;
  title: string;
  subtitle?: string | null;
  coverArt: string | null;
}) {
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [channels, setChannels] = useState<ShareChannel[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBackDismiss(open, onClose);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setSentTo(null);
    setCopied(false);
    setError(null);
    fetch("/api/messages/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users || []))
      .catch(() => setUsers([]));
    fetch("/api/channels")
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => setChannels(d.channels || []))
      .catch(() => setChannels([]));
  }, [open]);

  const url = open ? musicShareUrl(link, albumId) : "";
  const messageBody = useCallback(() => {
    const text = note.trim();
    return text ? `${text}\n${url}` : url;
  }, [note, url]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy the link");
    }
  }, [url]);

  const nativeShare = useCallback(async () => {
    try {
      await navigator.share({ title, text: subtitle || undefined, url });
    } catch {
      /* dismissing the OS sheet is not an error */
    }
  }, [subtitle, title, url]);

  const sendToUser = useCallback(
    async (user: ShareUser) => {
      setBusy(`u${user.id}`);
      setError(null);
      try {
        const res = await fetch("/api/messages", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ recipientId: user.id, body: messageBody() }),
        });
        if (!res.ok) throw new Error("Could not send the message");
        setSentTo(`u${user.id}`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [messageBody]
  );

  const sendToChannel = useCallback(
    async (channel: ShareChannel) => {
      setBusy(`c${channel.id}`);
      setError(null);
      try {
        const res = await fetch(`/api/channels/${channel.id}/messages`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: messageBody() }),
        });
        if (!res.ok) throw new Error("Could not post to the channel");
        setSentTo(`c${channel.id}`);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [messageBody]
  );

  if (!open) return null;

  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <div className="fixed inset-0 z-[110] flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#16161c] pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:max-w-sm sm:rounded-2xl sm:border">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <Cover
            coverArt={coverArt}
            library={link.library}
            size={96}
            rounded="rounded"
            className="h-10 w-10 shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{title}</p>
            <p className="truncate text-xs text-white/40">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-white/40 hover:text-white"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-2 px-4 py-3">
          <button
            onClick={copy}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-sm text-white/70 transition hover:text-white"
          >
            {copied ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          {canNativeShare && (
            <button
              onClick={nativeShare}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 py-2 text-sm text-white/70 transition hover:text-white"
            >
              <Share2 size={15} />
              Share
            </button>
          )}
        </div>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a message (optional)"
          className="mx-4 mb-3 w-[calc(100%-2rem)] rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm outline-none focus:border-white/30"
        />

        {error && <p className="px-4 pb-2 text-xs text-rose-400">{error}</p>}

        {users.length > 0 && (
          <Section title="Send to">
            {users.map((user) => (
              <Row
                key={`u${user.id}`}
                label={user.email.split("@")[0]}
                busy={busy === `u${user.id}`}
                sent={sentTo === `u${user.id}`}
                onClick={() => sendToUser(user)}
                avatar={
                  <span className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[11px] font-semibold">
                    {initials(user.email)}
                  </span>
                }
              />
            ))}
          </Section>
        )}

        {channels.length > 0 && (
          <Section title="Channels">
            {channels.map((channel) => (
              <Row
                key={`c${channel.id}`}
                label={channel.name}
                busy={busy === `c${channel.id}`}
                sent={sentTo === `c${channel.id}`}
                onClick={() => sendToChannel(channel)}
                avatar={
                  <span className="flex size-8 items-center justify-center rounded-full bg-white/10 text-white/60">
                    <Hash size={15} />
                  </span>
                }
              />
            ))}
          </Section>
        )}

        {users.length === 0 && channels.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-white/40">
            Nobody to send to yet — copy the link instead.
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-white/5 pt-2">
      <p className="px-4 pb-1 text-[11px] uppercase tracking-wide text-white/30">
        {title}
      </p>
      {children}
    </div>
  );
}

function Row({
  label,
  avatar,
  busy,
  sent,
  onClick,
}: {
  label: string;
  avatar: React.ReactNode;
  busy: boolean;
  sent: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || sent}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition hover:bg-white/5",
        sent && "opacity-60"
      )}
    >
      {avatar}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {busy ? (
        <Loader2 size={15} className="animate-spin text-white/50" />
      ) : sent ? (
        <Check size={15} className="text-emerald-400" />
      ) : (
        <Send size={15} className="text-white/30" />
      )}
    </button>
  );
}

function initials(email: string): string {
  const name = email.split("@")[0] || email;
  return (name.replace(/[^a-zA-Z]/g, "").slice(0, 2) || name.slice(0, 2)).toUpperCase();
}
