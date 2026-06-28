"use client";

import { useEffect, useState } from "react";

// Live local time + date for the dashboard header. Rendered client-side only
// (returns a stable placeholder until mounted) to avoid hydration mismatch.
export default function ClockWidget() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "--:--:--";
  const date = now
    ? now.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

  return (
    <div className="text-left sm:text-right">
      <p className="text-3xl font-semibold tabular-nums leading-none tracking-tight text-white">
        {time}
      </p>
      <p className="mt-1 text-xs capitalize text-white/50">{date}</p>
    </div>
  );
}
