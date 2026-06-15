"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { InviteDialog } from "@/components/ui/invite-dialog";

interface CodeItem {
  id: number;
  code: string;
  note: string | null;
  email: string | null;
  sent_at: string | null;
  expires_at: string | null;
  created_at: string;
  used_by: number | null;
  used_at: string | null;
  used_by_email: string | null;
}

interface InviteRequest {
  id: number;
  email: string;
  message: string | null;
  status: "pending" | "approved" | "declined";
  created_at: string;
}

export default function AdminPage() {
  const [codes, setCodes] = useState<CodeItem[]>([]);
  const [requests, setRequests] = useState<InviteRequest[]>([]);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(0);
  const [loading, setLoading] = useState(false);
  const [mailConfigured, setMailConfigured] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const [codesRes, reqRes] = await Promise.all([
      fetch("/api/admin/codes"),
      fetch("/api/admin/invite-requests"),
    ]);
    if (codesRes.ok) {
      const data = await codesRes.json();
      setCodes(data.codes);
      setMailConfigured(data.mailConfigured);
    }
    if (reqRes.ok) {
      const data = await reqRes.json();
      setRequests(data.requests);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCode = async () => {
    setLoading(true);
    await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, expiresInDays: expiresInDays || null }),
    });
    setNote("");
    setLoading(false);
    load();
  };

  const approveRequest = async (id: number) => {
    setBusyId(id);
    await fetch(`/api/admin/invite-requests/${id}`, { method: "POST" });
    setBusyId(null);
    load();
  };

  const declineRequest = async (id: number) => {
    setBusyId(id);
    await fetch(`/api/admin/invite-requests/${id}`, { method: "DELETE" });
    setBusyId(null);
    load();
  };

  const deleteCode = async (id: number) => {
    if (!confirm("Delete this invite? The code will stop working.")) return;
    await fetch(`/api/admin/codes/${id}`, { method: "DELETE" });
    load();
  };

  const pending = requests.filter((r) => r.status === "pending");

  const isExpired = (c: CodeItem) =>
    !!c.expires_at &&
    new Date(c.expires_at.replace(" ", "T") + "Z").getTime() <= Date.now();

  const expiryHint = (c: CodeItem) => {
    if (!c.expires_at || c.used_by) return null;
    const ms =
      new Date(c.expires_at.replace(" ", "T") + "Z").getTime() - Date.now();
    if (ms <= 0) return null;
    const days = Math.ceil(ms / 86400000);
    return (
      <span className="text-white/40">
        {" "}
        · expires in {days} day{days === 1 ? "" : "s"}
      </span>
    );
  };

  const codeStatus = (c: CodeItem) => {
    if (c.used_by)
      return <span className="text-red-400">Used by {c.used_by_email}</span>;
    if (isExpired(c)) return <span className="text-white/40">Expired</span>;
    if (c.email && c.sent_at)
      return (
        <span className="text-blue-300">
          Invited{expiryHint(c)}
        </span>
      );
    if (c.email && !c.sent_at)
      return (
        <span className="text-yellow-400">
          Created (not sent){expiryHint(c)}
        </span>
      );
    return (
      <span className="text-green-400">
        Available{expiryHint(c)}
      </span>
    );
  };

  return (
    <main className="text-white px-8 pb-8 pt-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Registration codes</h1>
          <Link href="/" className="text-sm text-white/60 hover:text-white">
            ← Back
          </Link>
        </div>

        {!mailConfigured && (
          <div className="mb-6 rounded-xl border border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
            Email sending is not configured (set SMTP_* in the environment).
            Codes are still generated, but invitations won&apos;t be delivered.
          </div>
        )}

        {/* Invite requests */}
        {pending.length > 0 && (
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-medium">
              Invite requests
              <span className="ml-2 rounded-full bg-white/15 px-2 py-0.5 text-xs">
                {pending.length}
              </span>
            </h2>
            <div className="space-y-2">
              {pending.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.email}</p>
                      {r.message && (
                        <p className="mt-0.5 truncate text-sm text-white/60">
                          {r.message}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => approveRequest(r.id)}
                        disabled={busyId === r.id}
                        className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium transition hover:bg-white/25 disabled:opacity-50"
                      >
                        {busyId === r.id ? "..." : "Approve & send"}
                      </button>
                      <button
                        onClick={() => declineRequest(r.id)}
                        disabled={busyId === r.id}
                        className="rounded-full px-4 py-2 text-sm text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Generate / invite */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g. who it's for)"
            className="flex-1 rounded-xl bg-white/10 px-4 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
          <select
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(Number(e.target.value))}
            className="shrink-0 rounded-xl bg-white/10 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 [&>option]:bg-[#1c1c22]"
          >
            <option value={0}>No expiry</option>
            <option value={1}>Expires in 1 day</option>
            <option value={7}>Expires in 7 days</option>
            <option value={30}>Expires in 30 days</option>
          </select>
          <button
            onClick={createCode}
            disabled={loading}
            className="shrink-0 rounded-full bg-white/15 px-6 py-3 text-sm font-medium hover:bg-white/25 transition disabled:opacity-50"
          >
            {loading ? "..." : "Generate code"}
          </button>
        </div>
        <div className="mb-8">
          <button
            onClick={() => setInviteOpen(true)}
            className="rounded-full border border-white/15 px-6 py-3 text-sm font-medium transition hover:bg-white/10"
          >
            Invite via email
          </button>
        </div>

        {/* Desktop: table */}
        <div className="hidden overflow-hidden rounded-2xl border border-white/10 md:block">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-white/60">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Sent to / note</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {codes.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-white/40">
                    No codes yet. Generate one above.
                  </td>
                </tr>
              )}
              {codes.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="px-4 py-3 font-mono">{c.code}</td>
                  <td className="px-4 py-3 text-white/70">
                    {c.email || c.note || "—"}
                  </td>
                  <td className="px-4 py-3">{codeStatus(c)}</td>
                  <td className="px-4 py-3 text-right">
                    {!c.used_by && (
                      <button
                        onClick={() => deleteCode(c.id)}
                        aria-label="Delete invite"
                        title="Delete invite"
                        className="inline-flex size-8 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-red-400"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="space-y-2 md:hidden">
          {codes.length === 0 && (
            <div className="rounded-2xl border border-white/10 px-4 py-6 text-center text-white/40">
              No codes yet. Generate one above.
            </div>
          )}
          {codes.map((c) => (
            <div
              key={c.id}
              className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm">{c.code}</p>
                  <p className="mt-1 truncate text-sm text-white/60">
                    {c.email || c.note || "—"}
                  </p>
                  <p className="mt-1 text-xs">{codeStatus(c)}</p>
                </div>
                {!c.used_by && (
                  <button
                    onClick={() => deleteCode(c.id)}
                    aria-label="Delete invite"
                    title="Delete invite"
                    className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-white/40 transition hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        mailConfigured={mailConfigured}
        onSent={load}
      />
    </main>
  );
}
