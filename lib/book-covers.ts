import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import JSZip from "jszip";
import sharp from "sharp";
import type { BookFormat } from "./books";
import { bookFilePath, coverFilePath } from "./books-storage";

const execFileP = promisify(execFile);

export function coverExists(coverKey: string | null): boolean {
  return Boolean(coverKey) && fs.existsSync(coverFilePath(coverKey as string));
}

// Page count: pdfinfo for PDFs, image-entry count for CBZ, unknown for EPUB.
export async function analyzePageCount(
  format: BookFormat,
  storageKey: string
): Promise<number | null> {
  const src = bookFilePath(storageKey);
  try {
    if (format === "pdf") {
      const { stdout } = await execFileP("pdfinfo", [src]);
      const m = /Pages:\s+(\d+)/.exec(stdout);
      return m ? Number(m[1]) : null;
    }
    if (format === "cbz") {
      const zip = await JSZip.loadAsync(await fs.promises.readFile(src));
      return Object.values(zip.files).filter(
        (f) => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name)
      ).length;
    }
  } catch {
    /* ignore */
  }
  return null;
}

// Generate a JPEG cover at BOOKS_ROOT/.covers/<slug>.jpg. Returns the cover key
// (filename) on success, or null. PDFs use poppler's pdftoppm; EPUB/CBZ pull a
// likely cover image out of the zip and normalize it with sharp.
export async function extractCover(
  slug: string,
  format: BookFormat,
  storageKey: string
): Promise<string | null> {
  const src = bookFilePath(storageKey);
  const coverKey = `${slug}.jpg`;
  const dest = coverFilePath(coverKey);
  try {
    if (format === "pdf") {
      // pdftoppm appends ".jpg" to the prefix with -singlefile.
      const prefix = dest.replace(/\.jpg$/, "");
      await execFileP("pdftoppm", [
        "-jpeg",
        "-singlefile",
        "-f",
        "1",
        "-l",
        "1",
        "-scale-to",
        "700",
        src,
        prefix,
      ]);
      return fs.existsSync(dest) ? coverKey : null;
    }

    // EPUB / CBZ — both are zip archives of images/resources.
    const zip = await JSZip.loadAsync(await fs.promises.readFile(src));
    const images = Object.values(zip.files)
      .filter((f) => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (images.length === 0) return null;
    const pick = images.find((f) => /cover/i.test(f.name)) || images[0];
    const data = await pick.async("nodebuffer");
    await sharp(data)
      .resize(700, 700, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toFile(dest);
    return coverKey;
  } catch {
    return null;
  }
}
