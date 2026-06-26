"use client";

import { useEffect, useState } from "react";
import { Loader2, LogOut, Monitor, Smartphone } from "lucide-react";

interface Session {
  jti: string;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_seen_at: string;
  current: boolean;
}

function deviceLabel(ua: string | null): { name: string; mobile: boolean } {
  if (!ua) return { name: "Unknown device", mobile: false };
  const mobile = /Mobile|Android|iPhone|iPad/i.test(ua);
  let os = "";
  if (/Android/i.test(ua)) os = "Android";
  else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  const name = [browser, os].filter(Boolean).join(" on ") || "Unknown device";
  return { name, mobile };
}

function relative(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
}

export default function SessionsManager() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) setSessions((await res.json()).sessions);
    else setSessions([]);
  };

  useEffect(() => {
    load();
  }, []);

  const revoke = async (jti: string) => {
    setBusy(true);
    setSessions((s) => s?.filter((x) => x.jti !== jti) ?? null);
    await fetch("/api/sessions/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jti }),
    }).catch(() => {});
    setBusy(false);
  };

  const revokeOthers = async () => {
    if (!confirm("Sign out all other devices?")) return;
    setBusy(true);
    await fetch("/api/sessions/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ others: true }),
    }).catch(() => {});
    await load();
    setBusy(false);
  };

  const others = sessions?.filter((s) => !s.current) ?? [];

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Active sessions</h2>
          <p className="mt-1 text-sm text-white/50">
            Devices currently signed in to your account. Revoke any you don&apos;t
            recognise.
          </p>
        </div>
        {others.length > 0 && (
          <button
            onClick={revokeOthers}
            disabled={busy}
            className="shrink-0 rounded-full bg-white/10 px-4 py-2 text-sm font-medium hover:bg-white/20 disabled:opacity-50"
          >
            Sign out others
          </button>
        )}
      </div>

      <div className="mt-5 space-y-2">
        {sessions === null ? (
          <div className="py-4 text-center text-white/40">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-white/40">No active sessions.</p>
        ) : (
          sessions.map((s) => {
            const { name, mobile } = deviceLabel(s.user_agent);
            return (
              <div
                key={s.jti}
                className="flex items-center gap-3 rounded-xl bg-white/5 px-4 py-3"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-white/70">
                  {mobile ? (
                    <Smartphone className="h-4 w-4" />
                  ) : (
                    <Monitor className="h-4 w-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{name}</span>
                    {s.current && (
                      <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-[11px] font-semibold text-green-300">
                        This device
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-white/40">
                    {s.ip ? `${s.ip} · ` : ""}active {relative(s.last_seen_at)}
                  </div>
                </div>
                {!s.current && (
                  <button
                    onClick={() => revoke(s.jti)}
                    disabled={busy}
                    className="shrink-0 rounded-md p-2 text-white/50 hover:bg-white/10 hover:text-red-300 disabled:opacity-50"
                    aria-label="Revoke session"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
