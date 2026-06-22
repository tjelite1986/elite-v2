import { NextResponse } from "next/server";
import fs from "node:fs";
import { db, GalleryItemRow } from "@/lib/db";
import { qb, getAll } from "@/lib/kysely";
import { getSession } from "@/lib/auth";
import { parseFilenameDate } from "@/lib/filename-date";
import { originalPathFor, readExifMeta } from "@/lib/gallery-storage";
import { reverseGeocode } from "@/lib/geocode";

export const dynamic = "force-dynamic";

// Cap reverse-geocode lookups per run (Nominatim is ~1/sec, so this also bounds
// the request duration).
const GEOCODE_CAP = 150;

function toSqlite(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

// Re-derive taken_at + GPS for the current user's items from the stored
// originals' EXIF (date falls back to the filename), fixing photos imported
// before EXIF/GPS reading existed. Only writes when something changes.
export async function POST() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = Number(session.sub);

  const items = getAll<
    Pick<
      GalleryItemRow,
      | "id"
      | "filename"
      | "storage_key"
      | "taken_at"
      | "latitude"
      | "longitude"
      | "location_name"
      | "camera"
    >
  >(
    qb
      .selectFrom("gallery_items")
      .select([
        "id",
        "filename",
        "storage_key",
        "taken_at",
        "latitude",
        "longitude",
        "location_name",
        "camera",
      ])
      .where("user_id", "=", userId)
  );

  const updateDate = db.prepare(
    "UPDATE gallery_items SET taken_at = ? WHERE id = ? AND user_id = ?"
  );
  const updateGps = db.prepare(
    "UPDATE gallery_items SET latitude = ?, longitude = ? WHERE id = ? AND user_id = ?"
  );
  const updatePlace = db.prepare(
    "UPDATE gallery_items SET location_name = ? WHERE id = ? AND user_id = ?"
  );
  const updateCamera = db.prepare(
    "UPDATE gallery_items SET camera = ? WHERE id = ? AND user_id = ?"
  );

  let datesUpdated = 0;
  let placesUpdated = 0;
  let namesUpdated = 0;
  let geocoded = 0;

  for (const it of items) {
    const original = originalPathFor(userId, it.storage_key);
    let exifDate: Date | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    try {
      if (fs.existsSync(original)) {
        // exifr reads date + GPS from the original (HEIC included) without a
        // full decode — fast, no heif-convert needed here.
        const meta = await readExifMeta(fs.readFileSync(original));
        exifDate = meta.takenAt;
        lat = meta.latitude;
        lng = meta.longitude;
        if (meta.camera && !it.camera) {
          updateCamera.run(meta.camera, it.id, userId);
        }
      }
    } catch {
      /* ignore unreadable file */
    }

    const resolvedDate = exifDate ?? parseFilenameDate(it.filename);
    if (resolvedDate) {
      const next = toSqlite(resolvedDate);
      if (next !== it.taken_at) {
        updateDate.run(next, it.id, userId);
        datesUpdated++;
      }
    }

    if (lat !== null && lng !== null && (it.latitude === null || it.longitude === null)) {
      updateGps.run(lat, lng, it.id, userId);
      placesUpdated++;
    }

    // Reverse-geocode a place name for items that have coordinates but no name.
    const effLat = lat ?? it.latitude;
    const effLng = lng ?? it.longitude;
    if (
      effLat !== null &&
      effLng !== null &&
      !it.location_name &&
      geocoded < GEOCODE_CAP
    ) {
      geocoded++;
      const name = await reverseGeocode(effLat, effLng);
      if (name) {
        updatePlace.run(name, it.id, userId);
        namesUpdated++;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: items.length,
    datesUpdated,
    placesUpdated,
    namesUpdated,
  });
}
