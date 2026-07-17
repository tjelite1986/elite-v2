"use client";

import { useEffect, useRef } from "react";
import { decode } from "blurhash";

// Tiny canvas rendering of a blurhash placeholder — painted once, sits behind
// the real image while it streams in.
export default function BlurhashCanvas({ hash, className }: { hash: string; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    try {
      const pixels = decode(hash, 32, 32);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const img = ctx.createImageData(32, 32);
      img.data.set(pixels);
      ctx.putImageData(img, 0, 0);
    } catch {
      /* malformed hash — keep the plain background */
    }
  }, [hash]);
  return <canvas ref={ref} width={32} height={32} className={className} aria-hidden />;
}
