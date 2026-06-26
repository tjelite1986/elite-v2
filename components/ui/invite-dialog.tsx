"use client";

import * as React from "react";
import { UserRoundPlus, Check, Copy, X } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

interface SentResult {
  email: string;
  code: string;
  sent: boolean;
}

interface InviteDialogProps {
  open: boolean;
  onClose: () => void;
  mailConfigured: boolean;
  // Called after invites are created so the parent can refresh its code list.
  onSent?: () => void;
}

/**
 * Invite-by-email dialog, styled to match the app's dark theme. UX adapted
 * from the originui "invite members" component: a stack of email inputs with
 * "add another", a send button, and a copyable registration link.
 */
export function InviteDialog({
  open,
  onClose,
  mailConfigured,
  onSent,
}: InviteDialogProps) {
  const [emails, setEmails] = React.useState<string[]>([""]);
  const [note, setNote] = React.useState("");
  const [expiresInDays, setExpiresInDays] = React.useState(7);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [results, setResults] = React.useState<SentResult[] | null>(null);
  const [copied, setCopied] = React.useState(false);

  const registerLink =
    typeof window !== "undefined" ? `${window.location.origin}/register` : "/register";

  // Reset transient state whenever the dialog is opened.
  React.useEffect(() => {
    if (open) {
      setEmails([""]);
      setNote("");
      setExpiresInDays(7);
      setError("");
      setResults(null);
      setLoading(false);
    }
  }, [open]);

  // Close on Escape.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Device Back closes the dialog instead of leaving the page.
  useBackDismiss(open, onClose);

  if (!open) return null;

  const addEmail = () => setEmails((prev) => [...prev, ""]);
  const changeEmail = (i: number, value: string) =>
    setEmails((prev) => prev.map((e, idx) => (idx === i ? value : e)));
  const removeEmail = (i: number) =>
    setEmails((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const handleSend = async () => {
    setError("");
    const cleaned = emails.map((e) => e.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setError("Add at least one email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emails: cleaned,
          note: note.trim() || undefined,
          expiresInDays: expiresInDays || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to send invites.");
        return;
      }
      setResults(data.results || []);
      onSent?.();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(registerLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#1c1c22] p-6 text-white shadow-2xl">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 flex size-7 items-center justify-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
        >
          <X size={16} strokeWidth={2} />
        </button>

        <div className="mb-5 flex flex-col gap-2">
          <div className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/5">
            <UserRoundPlus size={18} strokeWidth={2} className="opacity-80" />
          </div>
          <h2 className="text-lg font-semibold">Invite team members</h2>
          <p className="text-sm text-white/50">
            Each invite generates a single-use registration code and emails it.
          </p>
        </div>

        {!mailConfigured && (
          <div className="mb-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-xs text-yellow-200">
            Email sending is not configured. Codes will be generated but not
            delivered — copy them from the table after sending.
          </div>
        )}

        {results ? (
          <div className="space-y-3">
            <p className="text-sm text-white/70">Invites created:</p>
            <div className="space-y-2">
              {results.map((r) => (
                <div
                  key={r.email}
                  className="flex items-center justify-between rounded-xl bg-white/5 px-4 py-2.5 text-sm"
                >
                  <span className="truncate text-white/80">{r.email}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-white/60">{r.code}</span>
                    {r.sent ? (
                      <span className="text-xs text-green-400">Sent</span>
                    ) : (
                      <span className="text-xs text-yellow-400">Not sent</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <button
              onClick={onClose}
              className="mt-2 w-full rounded-full bg-white/10 px-5 py-3 text-sm font-medium transition hover:bg-white/20"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <label className="text-sm font-medium text-white/80">Invite via email</label>
              {emails.map((email, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="email"
                    value={email}
                    placeholder="name@example.com"
                    onChange={(e) => changeEmail(i, e.target.value)}
                    className="flex-1 rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  />
                  {emails.length > 1 && (
                    <button
                      onClick={() => removeEmail(i)}
                      aria-label="Remove"
                      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-white"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={addEmail}
                className="text-sm text-white/60 underline hover:text-white hover:no-underline"
              >
                + Add another
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-white/80">
                Note <span className="text-white/40">(optional)</span>
              </label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Included in the invite email"
                className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <div className="mt-4 space-y-2">
              <label className="text-sm font-medium text-white/80">Expiry</label>
              <select
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(Number(e.target.value))}
                className="w-full rounded-xl bg-white/10 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 [&>option]:bg-[#1c1c22]"
              >
                <option value={0}>No expiry</option>
                <option value={1}>Expires in 1 day</option>
                <option value={7}>Expires in 7 days</option>
                <option value={30}>Expires in 30 days</option>
              </select>
            </div>

            {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

            <button
              onClick={handleSend}
              disabled={loading}
              className="mt-5 w-full rounded-full bg-white/15 px-5 py-3 text-sm font-medium transition hover:bg-white/25 disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send invites"}
            </button>

            <hr className="my-5 border-white/10" />

            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">
                Or share the registration link
              </label>
              <div className="relative">
                <input
                  readOnly
                  value={registerLink}
                  className="w-full rounded-xl bg-white/10 px-4 py-2.5 pr-11 text-sm text-white/70 focus:outline-none"
                />
                <button
                  onClick={handleCopy}
                  aria-label={copied ? "Copied" : "Copy"}
                  className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-white/60 transition hover:text-white"
                >
                  {copied ? (
                    <Check size={16} className="stroke-green-400" />
                  ) : (
                    <Copy size={16} />
                  )}
                </button>
              </div>
              <p className="text-xs text-white/40">
                Anyone with this link still needs a valid registration code.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
