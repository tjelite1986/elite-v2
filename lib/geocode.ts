// Reverse geocoding via Nominatim (OpenStreetMap's free API), mirroring elite.
// Usage policy: max ~1 request/second and a descriptive User-Agent are required.

let lastFetchAt = 0;

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  suburb?: string;
  county?: string;
  country?: string;
}

function pickPlace(addr: NominatimAddress | undefined): string | null {
  if (!addr) return null;
  const candidates = [
    addr.city,
    addr.town,
    addr.village,
    addr.hamlet,
    addr.municipality,
    addr.suburb,
    addr.county,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

// Resolve coordinates to a concise "Place, Country" name, or null. Self-throttles
// to honour Nominatim's 1 req/sec limit (callers can loop without their own wait).
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  const wait = Math.max(0, 1100 - (Date.now() - lastFetchAt));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetchAt = Date.now();

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=14&addressdetails=1`,
      {
        headers: {
          "User-Agent": "EliteV2Gallery/1.0 (personal use)",
          "Accept-Language": "sv,en",
        },
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      display_name?: string;
      address?: NominatimAddress;
    };
    const place = pickPlace(data.address);
    const country = data.address?.country?.trim() || null;
    const name = [place, country].filter(Boolean).join(", ");
    return name || data.display_name || null;
  } catch {
    return null;
  }
}
