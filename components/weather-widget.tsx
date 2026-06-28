"use client";

import { useEffect, useState } from "react";
import { Cloud, Loader2 } from "lucide-react";

interface WeatherData {
  place: string;
  now: { temp: number | null; emoji: string };
  forecast: Array<{ time: string; temp: number | null; emoji: string }>;
  error?: string;
}

// Current conditions + short forecast for the configured location.
// Data comes from /api/weather (Open-Meteo, cached server-side for 10 min).
export default function WeatherWidget() {
  const [data, setData] = useState<WeatherData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/weather")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setData(d));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
        <Cloud size={13} className="text-sky-400" />
        <span>Weather{data?.place ? ` · ${data.place}` : ""}</span>
      </div>
      {!data ? (
        <Loader2 size={16} className="animate-spin text-white/40" />
      ) : data.error ? (
        <p className="text-xs text-red-400">{data.error}</p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="text-4xl leading-none">{data.now.emoji}</span>
            <p className="text-3xl font-semibold tabular-nums">
              {data.now.temp !== null ? `${data.now.temp.toFixed(0)}°` : "—"}
            </p>
          </div>
          {data.forecast.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto">
              {data.forecast.map((f, i) => (
                <div
                  key={i}
                  className="min-w-[44px] flex-shrink-0 rounded-xl bg-white/5 px-2 py-1.5 text-center"
                >
                  <p className="text-[9px] text-white/40">
                    {new Date(f.time).toLocaleTimeString("sv-SE", { hour: "2-digit" })}
                  </p>
                  <p className="text-base leading-none">{f.emoji}</p>
                  <p className="text-[10px] tabular-nums text-white/70">
                    {f.temp !== null ? `${f.temp.toFixed(0)}°` : "—"}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
