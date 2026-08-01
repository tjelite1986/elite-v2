"use client";

import { useEffect, useState } from "react";

// The current week as seven cells with today filled in — the "week row" from
// the Layout Studio sketch. Client-side only (a stable placeholder until
// mounted) because the server's idea of "today" would hydrate-mismatch.
export default function WeekWidget() {
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => {
    setToday(new Date());
    // Re-check hourly so an open tab rolls over at midnight.
    const id = setInterval(() => setToday(new Date()), 60 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  // Monday-first, the way a Swedish week reads.
  const days = (() => {
    if (!today) return [];
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d;
    });
  })();

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <p className="mb-2 text-xs uppercase tracking-wider text-white/50">This week</p>
      <div className="flex items-stretch justify-between gap-1">
        {(days.length ? days : Array.from({ length: 7 }, () => null)).map((d, i) => {
          const isToday = !!d && !!today && d.toDateString() === today.toDateString();
          return (
            <div
              key={i}
              className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 ${
                isToday ? "bg-sky-500 text-white" : "bg-white/5"
              }`}
            >
              <span className={`text-[10px] ${isToday ? "opacity-80" : "text-white/40"}`}>
                {d ? d.toLocaleDateString("sv-SE", { weekday: "short" }) : "–"}
              </span>
              <span className="text-sm font-medium tabular-nums">{d ? d.getDate() : "–"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
