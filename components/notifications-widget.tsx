"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, Loader2 } from "lucide-react";

interface Notification {
  id: string;
  user: string;
  action: string;
  timestamp: string;
  href: string;
  read: boolean;
}

/**
 * The newest few notifications on the dashboard — the "notification list" from
 * the Layout Studio sketch, fed by the same /api/notifications the bell uses so
 * the two can never disagree.
 */
export default function NotificationsWidget({ limit = 4 }: { limit?: number }) {
  const [items, setItems] = useState<Notification[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/notifications")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        const list = Array.isArray(d) ? d : (d?.notifications ?? []);
        setItems(Array.isArray(list) ? list : []);
      })
      .catch(() => !cancelled && setItems([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const shown = (items ?? []).slice(0, limit);

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
        <Bell size={13} className="text-sky-400" />
        <span>Notifications</span>
      </div>

      {!items ? (
        <Loader2 size={16} className="animate-spin text-white/40" />
      ) : shown.length === 0 ? (
        <p className="text-xs text-white/40">Nothing new.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {shown.map((n) => (
            <li key={n.id}>
              <Link
                href={n.href || "#"}
                className="flex items-center gap-3 py-2 transition hover:opacity-80"
              >
                {/* An unread row keeps its dot; a read one keeps the column so
                    the text stays aligned between them. */}
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    n.read ? "bg-transparent" : "bg-sky-400"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-sm ${
                      n.read ? "text-white/60" : "font-medium text-white"
                    }`}
                  >
                    {n.user}
                  </span>
                  <span className="block truncate text-xs text-white/40">{n.action}</span>
                </span>
                <span className="shrink-0 text-[11px] text-white/35">{n.timestamp}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
