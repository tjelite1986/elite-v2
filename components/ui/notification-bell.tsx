"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { useWs } from "@/components/ws-provider";

interface Notification {
  id: string;
  user: string;
  action: string;
  timestamp: string;
  href: string;
}

// SQLite stores UTC datetimes as "YYYY-MM-DD HH:MM:SS".
function parseUtc(s: string): number {
  return new Date(s.replace(" ", "T") + "Z").getTime();
}

function relativeTime(s: string): string {
  const diff = Date.now() - parseUtc(s);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function initials(email: string): string {
  const name = email.split("@")[0];
  return name.slice(0, 2).toUpperCase();
}

function nameOf(email: string): string {
  return email.split("@")[0];
}

export default function NotificationBell() {
  const router = useRouter();
  const { subscribe } = useWs();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<Notification[]>([]);
  const [count, setCount] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
      setCount(data.unreadCount);
    } catch {
      /* noop */
    }
  }, []);

  // Initial load + light polling to stay in sync (reads clear server-side).
  React.useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  // Refresh immediately when a new message arrives over the socket.
  React.useEffect(() => {
    return subscribe((event) => {
      if (event.type === "message") load();
    });
  }, [subscribe, load]);

  // Close on outside click / Escape.
  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markAllRead = async () => {
    await fetch("/api/notifications", { method: "POST" });
    load();
  };

  const openItem = (n: Notification) => {
    setOpen(false);
    router.push(n.href);
  };

  return (
    <div ref={wrapRef} className="relative flex items-center">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex size-7 items-center justify-center rounded-md text-white/70 transition hover:bg-white/10 hover:text-white"
      >
        <Bell size={15} strokeWidth={2} />
        {count > 0 && (
          <span className="absolute -right-1 -top-1 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[60] w-80 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c22] text-white shadow-2xl">
          <div className="flex items-baseline justify-between gap-4 px-4 py-3">
            <div className="text-sm font-semibold">Notifications</div>
            {count > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs font-medium text-white/60 hover:text-white hover:underline"
              >
                Mark all as read
              </button>
            )}
          </div>
          <div className="h-px bg-white/10" />

          {items.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-white/40">
              You&apos;re all caught up.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto p-1">
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/5"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white/10 text-xs font-semibold">
                    {initials(n.user)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-white/80">
                      <span className="font-medium text-white">
                        {nameOf(n.user)}
                      </span>{" "}
                      {n.action}.
                    </span>
                    <span className="mt-0.5 block text-xs text-white/40">
                      {relativeTime(n.timestamp)}
                    </span>
                  </span>
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-blue-400" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
