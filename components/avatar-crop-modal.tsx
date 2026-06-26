"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { useBackDismiss } from "@/lib/use-back-dismiss";

const BOX = 300; // on-screen crop viewport (square), px
const OUT = 512; // exported avatar size, px

// Crop/zoom a picked image to a square before uploading it as an avatar. Pan by
// dragging, zoom with the slider; the visible square is exported to a 512px JPEG.
export default function AvatarCropModal({
  file,
  onCancel,
  onCropped,
}: {
  file: File;
  onCancel: () => void;
  onCropped: (blob: Blob) => Promise<void> | void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useBackDismiss(true, onCancel);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Baseline scale so the image always covers the square at zoom = 1.
  const baseScale = img ? BOX / Math.min(img.naturalWidth, img.naturalHeight) : 1;
  const scale = baseScale * zoom;
  const dW = img ? img.naturalWidth * scale : 0;
  const dH = img ? img.naturalHeight * scale : 0;

  // Keep the image covering the viewport (no empty gaps).
  const clamp = (p: { x: number; y: number }) => ({
    x: Math.min(0, Math.max(BOX - dW, p.x)),
    y: Math.min(0, Math.max(BOX - dH, p.y)),
  });

  useEffect(() => {
    if (img) setPos(clamp({ x: (BOX - dW) / 2, y: (BOX - dH) / 2 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, zoom]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setPos(
      clamp({
        x: drag.current.px + (e.clientX - drag.current.x),
        y: drag.current.py + (e.clientY - drag.current.y),
      })
    );
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const confirm = async () => {
    if (!img) return;
    setBusy(true);
    const canvas = document.createElement("canvas");
    canvas.width = OUT;
    canvas.height = OUT;
    const ctx = canvas.getContext("2d")!;
    // Map the viewport's source rectangle out of the original image.
    const sx = -pos.x / scale;
    const sy = -pos.y / scale;
    const sSize = BOX / scale;
    ctx.drawImage(img, sx, sy, sSize, sSize, 0, 0, OUT, OUT);
    const blob: Blob | null = await new Promise((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.9)
    );
    if (blob) await onCropped(blob);
    setBusy(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-neutral-900 p-5 text-white">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">Crop photo</h3>
          <button onClick={onCancel} aria-label="Cancel" className="p-1">
            <X size={20} />
          </button>
        </div>

        <div
          className="relative mx-auto overflow-hidden rounded-full bg-black"
          style={{ width: BOX, height: BOX, touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={img.src}
              alt=""
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                width: dW,
                height: dH,
                left: pos.x,
                top: pos.y,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-white/40" />
            </div>
          )}
          <div className="pointer-events-none absolute inset-0 rounded-full ring-1 ring-white/30" />
        </div>

        <input
          type="range"
          min={1}
          max={3}
          step={0.01}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="mt-4 w-full accent-blue-500"
          aria-label="Zoom"
        />

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!img || busy}
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-5 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
