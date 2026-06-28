import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 600;

// Location for the dashboard weather widget. Configurable via env, defaults to
// Stockholm. Set WEATHER_LAT / WEATHER_LON / WEATHER_PLACE to change it.
const LAT = Number(process.env.WEATHER_LAT ?? "59.3293");
const LON = Number(process.env.WEATHER_LON ?? "18.0686");
const PLACE = process.env.WEATHER_PLACE ?? "Stockholm";

interface OpenMeteoResponse {
  current?: {
    time: string;
    temperature_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    precipitation: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation: number[];
  };
}

// WMO weather code -> emoji
function codeEmoji(code: number | null): string {
  if (code === null || code === undefined) return "❓";
  if (code === 0) return "☀️";
  if (code === 1 || code === 2) return "🌤️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code === 95) return "⛈️";
  if (code === 96 || code === 99) return "⛈️";
  return "🌡️";
}

// Weather for the configured location via Open-Meteo (free, no API key).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!Number.isFinite(LAT) || !Number.isFinite(LON)) {
    return NextResponse.json({ error: "Invalid location configured", place: PLACE }, { status: 500 });
  }

  const params = new URLSearchParams({
    latitude: LAT.toFixed(4),
    longitude: LON.toFixed(4),
    current: "temperature_2m,weather_code,wind_speed_10m,precipitation",
    hourly: "temperature_2m,weather_code,precipitation",
    timezone: "Europe/Stockholm",
    forecast_days: "2",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "elite-v2" },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 600 },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Open-Meteo HTTP ${res.status}`, place: PLACE }, { status: 502 });
    }
    const data = (await res.json()) as OpenMeteoResponse;
    if (!data.current || !data.hourly) {
      return NextResponse.json({ error: "Malformed response", place: PLACE }, { status: 502 });
    }

    // Forecast: next hours, every 3rd hour starting from now, up to 8 entries.
    const hourly = data.hourly;
    const nowMs = Date.now();
    const forecast: Array<{ time: string; temp: number | null; emoji: string }> = [];
    for (let i = 0; i < hourly.time.length && forecast.length < 8; i++) {
      const t = new Date(hourly.time[i]).getTime();
      if (t < nowMs) continue;
      if (forecast.length > 0) {
        const last = new Date(forecast[forecast.length - 1].time).getTime();
        if (t - last < 3 * 60 * 60 * 1000) continue;
      }
      forecast.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m[i] ?? null,
        emoji: codeEmoji(hourly.weather_code[i] ?? null),
      });
    }

    return NextResponse.json({
      place: PLACE,
      now: {
        temp: data.current.temperature_2m,
        emoji: codeEmoji(data.current.weather_code),
      },
      forecast,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Weather fetch failed", place: PLACE },
      { status: 502 }
    );
  }
}
