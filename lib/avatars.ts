import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import {
  isSupportedImage,
  isHeifBuffer,
  heicToJpeg,
  getExt,
} from "./gallery-storage";
import { PROFILE_ROOT } from "./storage-roots";

// Account avatars — the picture beside a name in Messages, Channels and the
// nav menu, and the one this app hands to Elitogram in the verify response.
//
// They used to live in the posts library, under POSTS_ROOT/avatars, because
// that is where the creator avatars were. The posts library became its own app
// on 2026-09-16 and took the creator avatars with it, so this store moved to a
// root this app owns: an account is this app's to serve, and a picture served
// from a mount another app writes is a picture that disappears the day that
// mount is dropped.
//
// Not a subdirectory of any u_<user> home: the file is served by handle, and
// keying it by account home would mean moving the file when a name changes.
const AVATARS_DIR = "_avatars";
const AVATAR_SIZE = 320;

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Absolute path for an avatar_key as stored in the database. */
export function avatarPathFor(avatarKey: string): string {
  return path.join(PROFILE_ROOT, avatarKey);
}

/** Content type for an avatar_key. Never echoes an uploaded type back. */
export function avatarMimeFor(avatarKey: string): string {
  return IMAGE_MIME[getExt(avatarKey)] || "image/jpeg";
}

/**
 * Persist an avatar as a square JPEG and return its avatar_key. The key is
 * relative to PROFILE_ROOT, so an existing row keeps meaning the same file if
 * the root ever moves.
 */
export async function storeAvatar(
  filename: string,
  mime: string,
  buffer: Buffer
): Promise<string> {
  if (!isSupportedImage(filename, mime)) {
    throw new Error("Unsupported file type — images only");
  }
  const dir = path.join(PROFILE_ROOT, AVATARS_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const source = isHeifBuffer(buffer) ? heicToJpeg(buffer) : buffer;
  const uuid = randomUUID();
  await sharp(source)
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover" })
    .jpeg({ quality: 82 })
    .toFile(path.join(dir, `${uuid}.jpg`));
  return `${AVATARS_DIR}/${uuid}.jpg`;
}
