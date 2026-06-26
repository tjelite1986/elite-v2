import { db } from "./db";

// Auto-detected "trips": time-contiguous clusters of geotagged photos taken away
// from home. Derived on the fly (no storage) — deterministic from the photos.

const GAP_MS = 2 * 24 * 60 * 60 * 1000; // a >2-day gap starts a new trip
const MIN_PHOTOS = 4;
const MIN_KM_FROM_HOME = 40;

interface Geo {
  id: number;
  lat: number;
  lng: number;
  taken_at: string;
  location_name: string | null;
}

export interface Trip {
  key: string;
  name: string;
  start: string;
  end: string;
  count: number;
  coverId: number;
  itemIds: number[];
}

function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const ms = (s: string) => new Date(s.replace(" ", "T") + "Z").getTime();

export function computeTrips(userId: number): Trip[] {
  const rows = db
    .prepare(
      `SELECT id, latitude AS lat, longitude AS lng, taken_at, location_name
       FROM gallery_items
       WHERE user_id = ? AND is_deleted = 0
         AND latitude IS NOT NULL AND longitude IS NOT NULL
       ORDER BY taken_at ASC, id ASC`
    )
    .all(userId) as Geo[];
  if (rows.length < MIN_PHOTOS) return [];

  // Home ≈ the centroid of the most photo-dense ~11km grid cell (robust against
  // trips, which are a minority of a long photo history).
  const buckets = new Map<string, { count: number; latSum: number; lngSum: number }>();
  for (const r of rows) {
    const k = `${r.lat.toFixed(1)},${r.lng.toFixed(1)}`;
    const b = buckets.get(k) ?? { count: 0, latSum: 0, lngSum: 0 };
    b.count++;
    b.latSum += r.lat;
    b.lngSum += r.lng;
    buckets.set(k, b);
  }
  let home: { lat: number; lng: number } | null = null;
  let best = 0;
  for (const b of Array.from(buckets.values())) {
    if (b.count > best) {
      best = b.count;
      home = { lat: b.latSum / b.count, lng: b.lngSum / b.count };
    }
  }

  // Split the time-ordered photos into contiguous segments.
  const segments: Geo[][] = [];
  let cur: Geo[] = [];
  for (const r of rows) {
    if (cur.length && ms(r.taken_at) - ms(cur[cur.length - 1].taken_at) > GAP_MS) {
      segments.push(cur);
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) segments.push(cur);

  const trips: Trip[] = [];
  for (const seg of segments) {
    if (seg.length < MIN_PHOTOS) continue;
    const cLat = seg.reduce((s, r) => s + r.lat, 0) / seg.length;
    const cLng = seg.reduce((s, r) => s + r.lng, 0) / seg.length;
    if (home && haversineKm(cLat, cLng, home.lat, home.lng) < MIN_KM_FROM_HOME) {
      continue; // too close to home — not a trip
    }
    // Name = most common place name in the segment, else a date label.
    const counts = new Map<string, number>();
    for (const r of seg) {
      if (r.location_name) counts.set(r.location_name, (counts.get(r.location_name) ?? 0) + 1);
    }
    let name = "";
    let nb = 0;
    for (const [n, c] of Array.from(counts.entries()))
      if (c > nb) ((nb = c), (name = n));
    const start = seg[0].taken_at;
    const end = seg[seg.length - 1].taken_at;
    if (!name) {
      name = `Trip · ${new Date(start.replace(" ", "T")).toLocaleDateString(
        "en-US",
        { month: "short", year: "numeric", timeZone: "UTC" }
      )}`;
    }
    trips.push({
      key: `trip-${seg[0].id}`,
      name,
      start,
      end,
      count: seg.length,
      coverId: seg[0].id,
      itemIds: seg.map((r) => r.id),
    });
  }
  trips.sort((a, b) => b.start.localeCompare(a.start));
  return trips;
}
