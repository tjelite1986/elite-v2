"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Megaphone, Send } from "lucide-react";

interface SentAnnouncement {
  message: string;
  href: string | null;
  created_at: string;
  recipients: number;
}

function formatWhen(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Admin tool: broadcast a system announcement to every user's notifications
// (plus web push), with a log of recent broadcasts underneath.
export default function AdminAnnounce() {
  const [message, setMessage] = useState("");
  const [href, setHref] = useState("");
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(
    null
  );
  const [recent, setRecent] = useState<SentAnnouncement[]>([]);

  const loadRecent = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/announce");
      if (res.ok) setRecent((await res.json()).announcements || []);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    loadRecent();
  }, [loadRecent]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;
    if (!confirm("Send this announcement to every user?")) return;
    setSending(true);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/announce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          href: href.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setFeedback({ ok: true, text: `Sent to ${data.recipients} users.` });
        setMessage("");
        setHref("");
        loadRecent();
      } else {
        setFeedback({
          ok: false,
          text: data.error || "Could not send the announcement.",
        });
      }
    } catch {
      setFeedback({ ok: false, text: "Could not send the announcement." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-6">
      <form
        onSubmit={send}
        className="rounded-2xl border border-white/10 bg-white/5 p-6"
      >
        <label className="mb-1.5 block text-sm font-medium">Message</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="What's new? Shown as an Elite notification for every user."
          className="w-full resize-y rounded-xl bg-white/10 px-4 py-3 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />
        <div className="mt-1 text-right text-xs text-white/40">
          {message.length}/500
        </div>

        <label className="mb-1.5 mt-3 block text-sm font-medium">
          Link <span className="font-normal text-white/40">(optional, in-app path)</span>
        </label>
        <input
          value={href}
          onChange={(e) => setHref(e.target.value)}
          placeholder="/messages"
          className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/30"
        />

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={sending || !message.trim()}
            className="flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2.5 text-sm font-medium transition hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            Send to everyone
          </button>
          {feedback && (
            <span
              className={
                feedback.ok ? "text-sm text-green-400" : "text-sm text-red-400"
              }
            >
              {feedback.text}
            </span>
          )}
        </div>
      </form>

      <div>
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white/70">
          <Megaphone size={15} /> Recent announcements
        </div>
        {recent.length === 0 ? (
          <div className="text-sm text-white/40">Nothing sent yet.</div>
        ) : (
          <div className="space-y-2">
            {recent.map((a, i) => (
              <div
                key={`${a.created_at}-${i}`}
                className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm"
              >
                <div className="text-white/90">{a.message}</div>
                <div className="mt-1 text-xs text-white/40">
                  {formatWhen(a.created_at)} · {a.recipients} recipients
                  {a.href && <> · {a.href}</>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
