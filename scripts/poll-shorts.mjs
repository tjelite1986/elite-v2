#!/usr/bin/env node
// Shorts auto-poller (phase v1c). Runs INSIDE the elitev2 container via
// `docker exec` on a host systemd timer. For every short_profiles row with
// auto_poll=1 it fetches the latest clips from the source, downloads new ones
// into the channel folder as a `pending` short, and lets the v1b transcoder
// turn them into .web.mp4.
//
// Two source types:
//   - yt-dlp : source_ref is a channel/playlist URL (YouTube, TikTok, …);
//              entries are enumerated with `yt-dlp --flat-playlist`.
//   - rss    : source_ref is an RSS/Atom feed; <item> links/enclosures are the
//              candidates and still downloaded through yt-dlp (generic extractor).
//
// Dedup is by (profile_id, source_id): a clip already downloaded for the profile,
// or listed in the profile's sticky skipped_ids, is never fetched again.
// A lockfile guards against overlapping runs. Output goes to journald.

import Database from "better-sqlite3";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR || "/app/data";
const DB_PATH = path.join(DATA_DIR, "elitev2.db");
const SHORTS_ROOT = process.env.SHORTS_ROOT || "/shorts-store";
const YT_DLP = process.env.YT_DLP_BIN || "yt-dlp";
const LOCK = "/tmp/elitev2-shorts-poll.lock";

const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// --- Single-run lock -------------------------------------------------------
let lockFd;
try {
  lockFd = fs.openSync(LOCK, "wx");
  fs.writeSync(lockFd, String(process.pid));
} catch (err) {
  if (err.code === "EEXIST") {
    try {
      const pid = Number(fs.readFileSync(LOCK, "utf8").trim());
      process.kill(pid, 0);
      process.exit(0);
    } catch {
      fs.rmSync(LOCK, { force: true });
      lockFd = fs.openSync(LOCK, "wx");
      fs.writeSync(lockFd, String(process.pid));
    }
  } else {
    throw err;
  }
}
process.on("exit", () => {
  try {
    fs.closeSync(lockFd);
    fs.rmSync(LOCK, { force: true });
  } catch {
    /* best effort */
  }
});

// --- Helpers ---------------------------------------------------------------
function channelDir(channel) {
  return path.join(SHORTS_ROOT, channel === "18plus" ? "18plus" : "main");
}

// Per-profile subfolder, kept identical to lib/shorts-storage.ts profileSlug().
function profileSlug(name) {
  const slug = (name || "unknown")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 64);
  return slug || "unknown";
}

// Resolve (and create) the folder a profile's clips live in.
function profileDir(channel, name) {
  const dir = path.join(channelDir(channel), profileSlug(name));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isHttp(u) {
  return typeof u === "string" && /^https?:\/\//i.test(u);
}

// Enumerate the latest candidate clips for a profile. Returns
// [{ id, title, url }] newest-first, capped to `limit`.
function enumerateCandidates(profile, limit) {
  if (profile.source_type === "rss") return enumerateRss(profile.source_ref, limit);
  return enumerateYtDlp(profile.source_ref, limit);
}

function enumerateYtDlp(ref, limit) {
  let out;
  try {
    out = execFileSync(
      YT_DLP,
      [
        "--flat-playlist",
        "--dump-json",
        "--playlist-end", String(limit),
        "--no-warnings",
        ref,
      ],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
    );
  } catch (err) {
    // yt-dlp exits non-zero on partial failures but may still print usable
    // lines on stdout; fall back to whatever it produced.
    out = err.stdout ? String(err.stdout) : "";
    if (!out) throw err;
  }
  const items = [];
  for (const line of out.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      const id = e.id ? String(e.id) : null;
      if (!id) continue;
      let url = isHttp(e.url) ? e.url : isHttp(e.webpage_url) ? e.webpage_url : null;
      // YouTube flat entries sometimes give only the bare id.
      if (!url && /youtube/i.test(e.ie_key || e.extractor || "")) {
        url = `https://www.youtube.com/watch?v=${id}`;
      }
      if (!url) continue;
      items.push({ id, title: e.title || null, url });
    } catch {
      /* skip unparseable line */
    }
  }
  return items.slice(0, limit);
}

async function enumerateRss(ref, limit) {
  const res = await fetch(ref, { headers: { "User-Agent": "elitev2-shorts/1.0" } });
  if (!res.ok) throw new Error(`RSS fetch ${res.status}`);
  const xml = await res.text();
  const items = [];
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) || [];
  for (const b of blocks) {
    const enclosure = b.match(/<enclosure[^>]*url=["']([^"']+)["']/i)?.[1];
    const link =
      b.match(/<link[^>]*href=["']([^"']+)["']/i)?.[1] || // Atom
      b.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim(); // RSS
    const url = isHttp(enclosure) ? enclosure : isHttp(link) ? link : null;
    if (!url) continue;
    const guid =
      b.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() || url;
    const title = b.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
      ?.replace(/<!\[CDATA\[|\]\]>/g, "")
      .trim();
    items.push({ id: guid, title: title || null, url });
    if (items.length >= limit) break;
  }
  return items;
}

function download(url, dir, uuid) {
  execFileSync(
    YT_DLP,
    [
      "--no-playlist",
      "-f", "best[height<=1920][ext=mp4]/best[height<=1920]/best",
      "--merge-output-format", "mp4",
      "-o", path.join(dir, `${uuid}.%(ext)s`),
      "--no-warnings", "--no-progress", "--quiet",
      url,
    ],
    { stdio: "ignore", timeout: 5 * 60 * 1000 }
  );
  // Locate whatever extension yt-dlp produced.
  const produced = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${uuid}.`) && !f.endsWith(".part"));
  return produced.length ? produced[0] : null;
}

// --- Main ------------------------------------------------------------------
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 10000"); // tolerate the app/transcoder writing too

// With a profile id argument, poll just that profile on demand (ignores the
// auto_poll flag) — used by the "Poll now" button and on profile create.
// Without one, poll every profile with auto_poll enabled (the timer path).
const argId = process.argv[2] ? Number(process.argv[2]) : null;
const profiles = argId
  ? db.prepare("SELECT * FROM short_profiles WHERE id = ?").all(argId)
  : db.prepare("SELECT * FROM short_profiles WHERE auto_poll = 1").all();

let totalNew = 0;

for (const profile of profiles) {
  const limit = Math.max(1, Math.min(profile.videos_limit || 20, 100));
  let skipped = [];
  try {
    skipped = JSON.parse(profile.skipped_ids || "[]");
  } catch {
    skipped = [];
  }
  const seen = new Set(
    db
      .prepare(
        "SELECT source_id FROM shorts WHERE profile_id = ? AND source_id IS NOT NULL"
      )
      .all(profile.id)
      .map((r) => r.source_id)
  );
  for (const s of skipped) seen.add(String(s));

  let candidates;
  try {
    candidates = await enumerateCandidates(profile, limit);
  } catch (err) {
    log(`profile ${profile.id} (${profile.name}): enumerate failed: ${err.message}`);
    continue;
  }

  const fresh = candidates.filter((c) => !seen.has(String(c.id)));
  if (fresh.length === 0) {
    db.prepare("UPDATE short_profiles SET last_polled_at = datetime('now') WHERE id = ?").run(
      profile.id
    );
    continue;
  }

  log(`profile ${profile.id} (${profile.name}): ${fresh.length} new of ${candidates.length}`);
  const slug = profileSlug(profile.name);
  const dir = profileDir(profile.channel, profile.name);

  const insert = db.prepare(
    `INSERT INTO shorts
       (channel, profile_id, uploader_id, caption, storage_key, poster_key,
        mime_type, source, source_id, status)
     VALUES (?, ?, NULL, ?, ?, NULL, 'video/mp4', 'poll', ?, 'pending')`
  );

  for (const c of fresh) {
    const uuid = randomUUID();
    try {
      const file = download(c.url, dir, uuid);
      if (!file) throw new Error("no file produced");
      // storage_key is relative to the channel dir and includes the profile
      // subfolder, so the transcoder + media routes resolve it unchanged.
      const storageKey = `${slug}/${file}`;
      insert.run(profile.channel, profile.id, c.title, storageKey, String(c.id));
      totalNew++;
      log(`  + ${c.id} -> ${storageKey}`);
    } catch (err) {
      log(`  ! ${c.id} download failed: ${String(err.message).slice(0, 120)}`);
    }
  }

  db.prepare("UPDATE short_profiles SET last_polled_at = datetime('now') WHERE id = ?").run(
    profile.id
  );
}

if (totalNew > 0) log(`poll complete: ${totalNew} new clip(s) queued for transcode`);
db.close();
