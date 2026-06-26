"use client";

import * as React from "react";
import { X, Loader2, Send } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

export type SharePayload =
  | { type: "photos"; ids: number[] }
  | { type: "album"; albumId: number; name: string };

interface ShareUser {
  id: number;
  email: string;
}

interface ShareDialogProps {
  open: boolean;
  payload: SharePayload | null;
  onClose: () => void;
  onShared?: () => void;
}

function initials(email: string): string {
  const n = email.split("@")[0] || email;
  return (n.replace(/[^a-zA-Z]/g, "").slice(0, 2) || n.slice(0, 2)).toUpperCase();
}

// Pick a recipient and send the selected photos / album as a chat message.
export function ShareDialog({ open, payload, onClose, onShared }: ShareDialogProps) {
  const [users, setUsers] = React.useState<ShareUser[]>([]);
  const [note, setNote] = React.useState("");
  const [busyId, setBusyId] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setNote("");
    fetch("/api/messages/users")
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]));
  }, [open]);

  // Device Back closes the share dialog instead of leaving the page.
  useBackDismiss(open, onClose);

  if (!open || !payload) return null;

  const count =
    payload.type === "photos" ? payload.ids.length : undefined;
  const title =
    payload.type === "album"
      ? `Share album “${payload.name}”`
      : `Share ${count} photo${count === 1 ? "" : "s"}`;

  const shareWith = async (userId: number) => {
    setBusyId(userId);
    try {
      const body: Record<string, unknown> = {
        recipientId: userId,
        body: note.trim() || undefined,
        attachmentType: payload.type,
      };
      if (payload.type === "photos") body.ids = payload.ids;
      else body.albumId = payload.albumId;

      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onShared?.();
        onClose();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-sm rounded-2xl border border-white/10 bg-[#1c1c22] p-5 text-white shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
        >
          <X size={16} />
        </button>
        <h2 className="mb-1 text-lg font-semibold">{title}</h2>
        <p className="mb-4 text-sm text-white/50">Send to a person in your chat.</p>

        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a message (optional)"
          className="mb-3 w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
        />

        {users.length === 0 ? (
          <div className="py-8 text-center text-sm text-white/40">
            No other users to share with yet.
          </div>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => shareWith(u.id)}
                disabled={busyId !== null}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-white/5 disabled:opacity-50"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-xs font-semibold">
                  {initials(u.email)}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {u.email.split("@")[0]}
                </span>
                {busyId === u.id ? (
                  <Loader2 size={16} className="animate-spin text-white/60" />
                ) : (
                  <Send size={16} className="text-white/40" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
