import path from "path";
import { existsSync, mkdirSync } from "fs";

// Book files live in a mounted volume (BOOKS_ROOT); covers in a .covers subdir.
const BOOKS_ROOT = process.env.BOOKS_ROOT || path.join(process.cwd(), "books-store");
const COVERS_DIR = path.join(BOOKS_ROOT, ".covers");

function ensureDirs() {
  if (!existsSync(BOOKS_ROOT)) mkdirSync(BOOKS_ROOT, { recursive: true });
  if (!existsSync(COVERS_DIR)) mkdirSync(COVERS_DIR, { recursive: true });
}

export function booksRoot(): string {
  ensureDirs();
  return BOOKS_ROOT;
}

export function coversDir(): string {
  ensureDirs();
  return COVERS_DIR;
}

export function bookFilePath(storageKey: string): string {
  return path.join(booksRoot(), storageKey);
}

export function coverFilePath(coverKey: string): string {
  return path.join(coversDir(), coverKey);
}

// Guard against path traversal: a resolved path must stay under BOOKS_ROOT.
export function isUnderBooksRoot(p: string): boolean {
  const root = path.resolve(booksRoot());
  const resolved = path.resolve(p);
  return resolved === root || resolved.startsWith(root + path.sep);
}
