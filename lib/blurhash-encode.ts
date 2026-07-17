import sharp from "sharp";
import { encode } from "blurhash";

// Compact placeholder hash for a stored image (the thumb is plenty — blurhash
// only keeps a handful of DCT components anyway). Null on any decode failure;
// a missing placeholder must never block an ingest.
export async function blurhashFromFile(file: string): Promise<string | null> {
  try {
    const { data, info } = await sharp(file)
      .resize(32, 32, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
  } catch {
    return null;
  }
}
