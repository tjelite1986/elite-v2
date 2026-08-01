"use client";

import { useEffect, useState } from "react";

// Live local time + date for the dashboard header. Rendered client-side only
// (returns a stable placeholder until mounted) to avoid hydration mismatch.
export default function ClockWidget({ align = "right" }: { align?: "right" | "center" }) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // Ticks per minute, since seconds are not shown.
    const id = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(id);
  }, []);

  const time = now
    ? now.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  const date = now
    ? now.toLocaleDateString("sv-SE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";

  const centred = align === "center";
  return (
    <div className={centred ? "py-2 text-center" : "text-left sm:text-right"}>
      <p
        className={`font-semibold tabular-nums leading-none tracking-tight text-white ${
          centred ? "text-5xl" : "text-3xl"
        }`}
      >
        {time}
      </p>
      <p className="mt-1 text-xs capitalize text-white/50">{date}</p>
    </div>
  );
}
