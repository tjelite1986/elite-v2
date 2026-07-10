import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type { ShortChannel } from "./db";
import { getShort } from "./shorts";
import {
  PROFILE_ROOT,
  channelDir,
  videoPathFor,
  posterPathFor,
} from "./shorts-storage";
import { findOrCreateShortProfile } from "./user-import";

// Move a clip between the main and 18+ channels, re-homing it the same way an
// import into the target channel would: the files move to the target channel's
// tree and a creator clip gets a find-or-create profile with the same name on
// the target channel (merged-handle aliases apply). Category resets to
// 'uncategorized' — the buckets are channel-specific and an admin re-sorts.

const UPLOAD_KEY_RE = /^(u_[^/]+)\/(shorts18|shorts)\/(.*)$/;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// rename(2) fails with EXDEV between bind mounts (PROFILE_ROOT and SHORTS_ROOT
// are separate volumes in production) — fall back to copy + unlink.
function moveFile(src: string, dest: string) {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

// Pick a destination basename that doesn't collide with an existing file.
function uniqueDest(destDir: string, base: string): string {
  let dest = path.join(destDir, base);
  if (!fs.existsSync(dest)) return dest;
  const ext = base.toLowerCase().endsWith(".web.mp4") ? ".web.mp4" : path.extname(base);
  const stem = base.slice(0, base.length - ext.length);
  dest = path.join(destDir, `${stem}_${randomUUID().slice(0, 8)}${ext}`);
  return dest;
}

// Relocate one file to the target channel and return its new storage key. A
// per-user upload key swaps its section segment (u_<x>/shorts/ <-> u_<x>/shorts18/,
// deeper collection subfolders preserved); a creator key keeps its relative path
// but resolves under the target channel's SHORTS_ROOT dir.
function moveOne(key: string, from: ShortChannel, to: ShortChannel): string {
  const src = videoPathFor(from, key);
  const upload = key.match(UPLOAD_KEY_RE);
  let newKey: string;
  let dest: string;
  if (upload) {
    const section = to === "18plus" ? "shorts18" : "shorts";
    const rel = `${upload[1]}/${section}/${upload[3]}`;
    ensureDir(path.dirname(path.join(PROFILE_ROOT, rel)));
    dest = uniqueDest(path.dirname(path.join(PROFILE_ROOT, rel)), path.basename(rel));
    newKey = path.relative(PROFILE_ROOT, dest);
  } else {
    const destDir = path.join(channelDir(to), path.dirname(key) === "." ? "" : path.dirname(key));
    ensureDir(destDir);
    dest = uniqueDest(destDir, path.basename(key));
    newKey = path.relative(channelDir(to), dest);
  }
  moveFile(src, dest);
  return newKey;
}

export function moveShortChannel(
  shortId: number,
  target: ShortChannel
): { ok: true; channel: ShortChannel } | { ok: false; error: string } {
  const short = getShort(shortId);
  if (!short) return { ok: false, error: "Not found" };
  if (short.channel === target) return { ok: true, channel: target };
  const from = short.channel as ShortChannel;

  const newStorageKey = moveOne(short.storage_key, from, target);
  let newPosterKey: string | null = null;
  if (short.poster_key) {
    try {
      // Poster resolution mirrors the video: same mover, poster path resolver.
      const src = posterPathFor(from, short.poster_key);
      if (fs.existsSync(src)) {
        newPosterKey = moveOne(short.poster_key, from, target);
      }
    } catch {
      // Poster missing or unmovable: drop the reference rather than fail the
      // move — the transcoder can backfill a poster later.
      newPosterKey = null;
    }
  }

  // A creator clip follows its creator: same profile name on the target channel
  // (find-or-create, honoring merged-handle aliases), like a folder import would.
  let newProfileId: number | null = null;
  if (short.profile_id) {
    const profile = db
      .prepare("SELECT name FROM short_profiles WHERE id = ?")
      .get(short.profile_id) as { name: string } | undefined;
    if (profile?.name) {
      newProfileId = findOrCreateShortProfile(profile.name, target);
    }
  }

  db.prepare(
    `UPDATE shorts
        SET channel = ?, storage_key = ?, poster_key = ?, profile_id = ?,
            category = 'uncategorized'
      WHERE id = ?`
  ).run(target, newStorageKey, newPosterKey, newProfileId, shortId);

  return { ok: true, channel: target };
}
