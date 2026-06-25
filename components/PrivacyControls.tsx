"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Camera,
  Eye,
  EyeOff,
  Film,
  Globe,
  Image as ImageIcon,
  Loader2,
  Mail,
  Maximize2,
  MousePointer2,
  Shield,
  X,
} from "lucide-react";

const STORAGE_KEY = "privacy_controls_v1";

interface Prefs {
  blurMedia: boolean;
  blurPii: boolean;
  pickerOn: boolean;
  proxyExternalImages: boolean;
  captureVideos: boolean;
  fullPage: boolean;
}

const DEFAULT_PREFS: Prefs = {
  blurMedia: true,
  blurPii: true,
  pickerOn: false,
  proxyExternalImages: false,
  captureVideos: true,
  fullPage: false,
};

function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return {
      blurMedia: typeof parsed.blurMedia === "boolean" ? parsed.blurMedia : true,
      blurPii: typeof parsed.blurPii === "boolean" ? parsed.blurPii : true,
      pickerOn: false,
      proxyExternalImages:
        typeof parsed.proxyExternalImages === "boolean"
          ? parsed.proxyExternalImages
          : false,
      captureVideos:
        typeof parsed.captureVideos === "boolean" ? parsed.captureVideos : true,
      fullPage:
        typeof parsed.fullPage === "boolean" ? parsed.fullPage : false,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function findBlurTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  // Walk up to find an img/video/explicit-blur-target ancestor. Stop short
  // of body/html so we never accidentally blur the whole page.
  let el: HTMLElement | null = target;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.dataset && el.dataset.screenshotHide === "1") return null;
    if (
      el.tagName === "IMG" ||
      el.tagName === "VIDEO" ||
      el.dataset?.blurTarget === "1"
    ) {
      return el;
    }
    el = el.parentElement;
  }
  // No img/video ancestor — blur just the element the user actually tapped,
  // not its huge container.
  if (target.dataset && target.dataset.screenshotHide === "1") return null;
  return target;
}

export default function PrivacyControls() {
  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [open, setOpen] = useState(false);
  const [shooting, setShooting] = useState(false);
  const [flash, setFlash] = useState<
    { kind: "ok" | "error"; message: string; details?: string } | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [manualCount, setManualCount] = useState(0);
  const manualSetRef = useRef<Set<HTMLElement>>(new Set());

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          blurMedia: prefs.blurMedia,
          blurPii: prefs.blurPii,
          proxyExternalImages: prefs.proxyExternalImages,
          captureVideos: prefs.captureVideos,
          fullPage: prefs.fullPage,
        }),
      );
    } catch {}
  }, [
    prefs.blurMedia,
    prefs.blurPii,
    prefs.proxyExternalImages,
    prefs.captureVideos,
    prefs.fullPage,
  ]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const body = document.body;
    body.classList.toggle("privacy-blur-media", enabled && prefs.blurMedia);
    body.classList.toggle("privacy-blur-pii", enabled && prefs.blurPii);
  }, [enabled, prefs.blurMedia, prefs.blurPii]);

  useEffect(() => {
    if (!enabled) return;
    if (!prefs.pickerOn) return;

    const onClick = (e: MouseEvent) => {
      const target = findBlurTarget(e.target);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      if (target.dataset.manualBlur === "1") {
        delete target.dataset.manualBlur;
        manualSetRef.current.delete(target);
      } else {
        target.dataset.manualBlur = "1";
        manualSetRef.current.add(target);
      }
      setManualCount(manualSetRef.current.size);
    };
    const onContext = (e: MouseEvent) => {
      const target = findBlurTarget(e.target);
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      target.dataset.manualBlur = "1";
      manualSetRef.current.add(target);
      setManualCount(manualSetRef.current.size);
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("contextmenu", onContext, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("contextmenu", onContext, true);
    };
  }, [enabled, prefs.pickerOn]);

  const clearManual = useCallback(() => {
    manualSetRef.current.forEach((el) => {
      delete el.dataset.manualBlur;
    });
    manualSetRef.current.clear();
    setManualCount(0);
  }, []);

  const takeScreenshot = useCallback(async () => {
    if (shooting) return;
    setShooting(true);
    setFlash(null);
    const wasPicker = prefs.pickerOn;
    if (wasPicker) setPrefs((p) => ({ ...p, pickerOn: false }));
    await new Promise((r) => setTimeout(r, 30));

    const { toPng } = await import("html-to-image");
    const node = document.documentElement;

    // Full-page mode needs the inner scroll container (<main> with
    // overflow-y-auto in DashboardShell) to be expanded to its full
    // scrollHeight so documentElement.scrollHeight actually measures the
    // whole page. Restore all touched styles afterwards.
    const fullPageRestores: Array<() => void> = [];
    if (prefs.fullPage) {
      const expand = (el: HTMLElement, height?: number) => {
        const prev = el.style.cssText;
        if (height != null) el.style.height = `${height}px`;
        el.style.maxHeight = "none";
        el.style.overflow = "visible";
        fullPageRestores.push(() => {
          el.style.cssText = prev;
        });
      };
      const main = document.querySelector("main") as HTMLElement | null;
      if (main) {
        expand(main, main.scrollHeight);
        // Walk up and unlock every overflow-hidden / fixed-height ancestor.
        let parent: HTMLElement | null = main.parentElement;
        while (parent && parent !== document.body) {
          const cs = getComputedStyle(parent);
          if (
            cs.overflow !== "visible" ||
            cs.overflowY !== "visible" ||
            cs.height !== "auto"
          ) {
            expand(parent);
          }
          parent = parent.parentElement;
        }
      }
      expand(document.body);
      expand(document.documentElement);
      // Give layout a frame to recompute after the style changes.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }

    // Some pages render <img> elements whose src is junk (HTML data URLs,
    // page paths returned by a buggy SW, etc.). html-to-image throws when
    // it tries to load those. We filter them out at the clone level so
    // they're never seen, but the rest of the page renders normally.
    const IMAGE_PATH_RE = /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)(\?.*)?$/i;
    const isBogusImageSrc = (img: HTMLImageElement): boolean => {
      const src = img.src || "";
      if (!src) return true;
      if (src.startsWith("data:text/")) return true;
      if (!src.startsWith("data:") && !src.startsWith("blob:")) {
        try {
          const u = new URL(src, window.location.href);
          if (
            u.origin === window.location.origin &&
            !u.pathname.startsWith("/api/") &&
            !IMAGE_PATH_RE.test(u.pathname)
          ) {
            return true;
          }
        } catch {
          return true;
        }
      }
      if (img.complete && img.naturalWidth === 0) return true;
      return false;
    };

    const baseOpts = {
      cacheBust: true,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor:
        getComputedStyle(document.body).backgroundColor || "#0f172a",
      filter: (n: Node) => {
        if (!(n instanceof HTMLElement)) return true;
        if (n.dataset?.screenshotHide === "1") return false;
        if (n.tagName === "IMG" && isBogusImageSrc(n as HTMLImageElement)) {
          return false;
        }
        return true;
      },
      // KEY: when html-to-image fetches an img.src and the bytes can't be
      // decoded as an image (e.g. an `<img src="/feed">` whose response is
      // HTML), the cloned img fires `error` and rejects the embed promise.
      // Providing onImageErrorHandler swallows that rejection so toPng
      // continues. The broken img just renders blank in the screenshot.
      onImageErrorHandler: () => {
        /* swallow */
      },
      width: document.documentElement.clientWidth,
      // Full-page mode captures the entire scrollable height instead of the
      // current viewport. Capped at 16000px to avoid OOM on mobile (typical
      // browser canvas dimension limit is around 8192–16384). The transform
      // is dropped in full-page mode so we start from the very top.
      height: prefs.fullPage
        ? Math.min(
            16000,
            Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight,
            ),
          )
        : window.innerHeight,
      style: prefs.fullPage
        ? undefined
        : {
            transform: `translateY(-${window.scrollY}px)`,
          },
    };
    const PLACEHOLDER =
      "data:image/svg+xml;utf8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="100%" height="100%" fill="#1f2937"/><text x="50%" y="50%" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">image blocked</text></svg>',
      );
    const SKIP_TAGS = new Set(["IFRAME", "AUDIO"]);

    // Swap any <img> whose src clearly isn't an image (data:text/html,
    // page URLs the SW served wrongly, etc.) to a placeholder data URL
    // so the screenshot doesn't bomb on them.
    const swapBrokenImages = (): (() => void) => {
      const swaps: Array<{ img: HTMLImageElement; originalSrc: string }> = [];
      const imgs = Array.from(node.querySelectorAll("img"));
      for (const img of imgs) {
        const src = img.src || "";
        const isHtmlDataUrl = src.startsWith("data:text/");
        const isBroken = img.complete && img.naturalWidth === 0;
        if (!isHtmlDataUrl && !isBroken) continue;
        if (src.startsWith("data:image/")) continue;
        swaps.push({ img, originalSrc: src });
        img.src = PLACEHOLDER;
      }
      return () => swaps.forEach((s) => (s.img.src = s.originalSrc));
    };

    // Replace bogus <img> elements with empty <canvas> elements of the
    // same size. Canvas has no src to load and can never throw an image
    // error — html-to-image just serializes it via toDataURL().
    type SwappedImg = { img: HTMLImageElement; canvas: HTMLCanvasElement };
    const swappedBogusImgs: SwappedImg[] = [];
    // Also clear bogus <source> elements inside <picture>.
    type ClearedSource = { source: HTMLSourceElement; srcset: string };
    const clearedSources: ClearedSource[] = [];

    for (const img of Array.from(node.querySelectorAll("img"))) {
      if (!isBogusImageSrc(img) || !img.parentNode) continue;
      const canvas = document.createElement("canvas");
      const rect = img.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width || img.width || 1));
      canvas.height = Math.max(1, Math.round(rect.height || img.height || 1));
      canvas.className = img.className;
      canvas.style.cssText = img.style.cssText;
      try {
        img.parentNode.replaceChild(canvas, img);
        swappedBogusImgs.push({ img, canvas });
      } catch {}
    }

    for (const source of Array.from(
      node.querySelectorAll("picture source[srcset], source[srcset]"),
    )) {
      const s = source as HTMLSourceElement;
      const srcset = s.srcset;
      if (
        srcset &&
        (srcset.includes("data:text/") || srcset.startsWith(window.location.origin))
      ) {
        clearedSources.push({ source: s, srcset });
        s.srcset = "";
      }
    }

    // Global error-event swallower for any img/source error that fires
    // *during* the screenshot. html-to-image's listeners can't see what
    // they don't get notified about.
    const errorBlocker = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "IMG" || t.tagName === "SOURCE" || t.tagName === "IMAGE")
      ) {
        e.stopImmediatePropagation();
        e.stopPropagation();
        e.preventDefault();
      }
    };
    window.addEventListener("error", errorBlocker, true);
    document.addEventListener("error", errorBlocker, true);

    console.log(
      `[screenshot] swapped ${swappedBogusImgs.length} bogus imgs, cleared ${clearedSources.length} source srcsets`,
    );

    // Opt-in pre-passes. Default OFF so the basic flow runs untouched.
    let restoreProxy: (() => void) | null = null;
    if (prefs.proxyExternalImages) {
      try {
        const origin = window.location.origin;
        const swaps: Array<{
          img: HTMLImageElement;
          originalSrc: string;
          originalSrcset: string | null;
        }> = [];
        for (const img of Array.from(node.querySelectorAll("img"))) {
          let u: URL | null = null;
          try {
            u = new URL(img.src, window.location.href);
          } catch {}
          if (!u) continue;
          if (u.protocol === "data:" || u.protocol === "blob:") continue;
          if (u.origin === origin) continue;
          if (u.protocol !== "http:" && u.protocol !== "https:") continue;
          swaps.push({
            img,
            originalSrc: img.src,
            originalSrcset: img.getAttribute("srcset"),
          });
        }
        const blobToDataURL = (blob: Blob): Promise<string> =>
          new Promise((res, rej) => {
            const r = new FileReader();
            r.onloadend = () => res(r.result as string);
            r.onerror = () => rej(r.error);
            r.readAsDataURL(blob);
          });
        await Promise.all(
          swaps.map(async (s) => {
            try {
              const ctl = new AbortController();
              const t = setTimeout(() => ctl.abort(), 8000);
              const r = await fetch(
                `${origin}/api/image-proxy?url=${encodeURIComponent(s.originalSrc)}`,
                { signal: ctl.signal },
              );
              clearTimeout(t);
              if (r.ok) {
                const blob = await r.blob();
                if (blob.size > 0 && blob.size < 8 * 1024 * 1024) {
                  s.img.removeAttribute("srcset");
                  s.img.src = await blobToDataURL(blob);
                }
              }
            } catch {}
          }),
        );
        restoreProxy = () =>
          swaps.forEach((s) => {
            s.img.src = s.originalSrc;
            if (s.originalSrcset !== null)
              s.img.setAttribute("srcset", s.originalSrcset);
          });
      } catch (err) {
        console.warn("[screenshot] proxy pre-pass failed", err);
      }
    }

    // ALWAYS replace every <video> element with a <canvas>. html-to-image's
    // cloneVideoElement has two failure paths on /clips, /shorts18, /tiktok:
    //  1. video.currentSrc empty → falls back to fetching video.poster.
    //     If poster is empty too, fetch("") returns the page HTML and the
    //     screenshot bombs with a data:text/html error.
    //  2. video.currentSrc set → drawImage to canvas, toDataURL. With MSE/
    //     range-streamed videos on Android Chrome, drawImage may produce a
    //     black frame even when readyState >= 2.
    // We bypass both by swapping the <video> for a <canvas> *of identical
    // size and styling*. If we can draw a frame, we do (good capture).
    // If not, the canvas stays transparent — but no fetch is attempted,
    // so no failure.
    const restoreCanvases: Array<() => void> = [];
    const isCanvasBlank = (
      canvas: HTMLCanvasElement,
      ctx: CanvasRenderingContext2D,
    ): boolean => {
      try {
        const samples = [
          [Math.floor(canvas.width / 4), Math.floor(canvas.height / 4)],
          [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)],
          [
            Math.floor((canvas.width * 3) / 4),
            Math.floor((canvas.height * 3) / 4),
          ],
        ];
        for (const [x, y] of samples) {
          const d = ctx.getImageData(x, y, 1, 1).data;
          if (d[3] > 0 && (d[0] > 4 || d[1] > 4 || d[2] > 4)) return false;
        }
        return true;
      } catch {
        return false;
      }
    };
    const loadImage = (url: string): Promise<HTMLImageElement | null> =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });

    const videos = Array.from(node.querySelectorAll("video"));
    for (const video of videos) {
      try {
        const canvas = document.createElement("canvas");
        const w =
          video.videoWidth || video.clientWidth || video.offsetWidth || 1;
        const h =
          video.videoHeight || video.clientHeight || video.offsetHeight || 1;
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        let drewSomething = false;
        if (ctx && video.readyState >= 2 && video.videoWidth > 0) {
          try {
            ctx.drawImage(video, 0, 0, w, h);
            drewSomething = !isCanvasBlank(canvas, ctx);
          } catch {}
        }
        // If drawImage gave a blank/black canvas (Android Chrome MSE quirk),
        // fall back to the video's poster image.
        if (!drewSomething && ctx) {
          const posterUrl = video.poster || video.getAttribute("poster") || "";
          if (posterUrl && !posterUrl.startsWith("data:")) {
            const posterImg = await loadImage(posterUrl);
            if (posterImg) {
              try {
                ctx.clearRect(0, 0, w, h);
                ctx.drawImage(posterImg, 0, 0, w, h);
                drewSomething = true;
              } catch {}
            }
          }
        }
        canvas.className = video.className;
        canvas.style.cssText = video.style.cssText;
        const parent = video.parentNode;
        if (!parent) continue;
        parent.replaceChild(canvas, video);
        restoreCanvases.push(() => {
          try {
            parent.replaceChild(video, canvas);
          } catch {}
        });
        console.log(
          `[screenshot] <video> -> canvas ${w}x${h}, drew=${drewSomething}, posterFallback=${!drewSomething ? "tried" : "no"}`,
        );
      } catch {}
    }
    console.log(
      `[screenshot] replaced ${restoreCanvases.length} <video> elements with canvases`,
    );

    let dataUrl: string | null = null;
    let firstErr: any = null;
    let secondErr: any = null;

    try {
      dataUrl = await toPng(node, baseOpts);
    } catch (err) {
      firstErr = err;
      console.warn("[screenshot] attempt 1 failed", err);
    }

    if (!dataUrl) {
      const restore = swapBrokenImages();
      try {
        dataUrl = await toPng(node, {
          ...baseOpts,
          imagePlaceholder: PLACEHOLDER,
          skipFonts: true,
        });
      } catch (err) {
        secondErr = err;
        console.warn("[screenshot] attempt 2 failed", err);
      } finally {
        restore();
      }
    }

    if (!dataUrl) {
      const restore = swapBrokenImages();
      try {
        dataUrl = await toPng(node, {
          ...baseOpts,
          imagePlaceholder: PLACEHOLDER,
          skipFonts: true,
          filter: (n: Node) => {
            if (!(n instanceof HTMLElement)) return true;
            if (n.dataset?.screenshotHide === "1") return false;
            if (SKIP_TAGS.has(n.tagName)) return false;
            return true;
          },
        });
      } catch (err) {
        console.error("[screenshot] all attempts failed", err);
        const buildDetails = (e: any): string => {
          if (!e || typeof e !== "object") return String(e);
          const parts: string[] = [];
          if (e.name) parts.push(`name: ${e.name}`);
          if (e.message) parts.push(`message: ${e.message}`);
          const target = (e as any).target;
          if (target?.src)
            parts.push(`target.src: ${String(target.src).slice(0, 200)}`);
          if (target?.tagName) parts.push(`target.tagName: ${target.tagName}`);
          if (e.stack) parts.push(`stack:\n${e.stack}`);
          return parts.join("\n") || "(no details)";
        };
        setFlash({
          kind: "error",
          message: `Screenshot failed: ${err && (err as any).message ? (err as any).message : "unknown"}`,
          details: [
            `URL: ${window.location.href}`,
            `UA: ${navigator.userAgent}`,
            `viewport: ${document.documentElement.clientWidth}x${window.innerHeight}, dpr ${window.devicePixelRatio}`,
            "",
            "--- attempt 1 (full render) ---",
            buildDetails(firstErr),
            "",
            "--- attempt 2 (placeholders + swap broken imgs) ---",
            buildDetails(secondErr),
            "",
            "--- attempt 3 (also skip iframe/audio) ---",
            buildDetails(err),
          ].join("\n"),
        });
      } finally {
        restore();
      }
    }

    // Restore opt-in pre-passes regardless of attempt outcome.
    restoreCanvases.forEach((fn) => fn());
    if (restoreProxy) restoreProxy();
    fullPageRestores.forEach((fn) => fn());

    // Restore the bogus imgs (swap canvases back).
    for (const s of swappedBogusImgs) {
      try {
        if (s.canvas.parentNode) s.canvas.parentNode.replaceChild(s.img, s.canvas);
      } catch {}
    }
    for (const c of clearedSources) {
      try {
        c.source.srcset = c.srcset;
      } catch {}
    }
    window.removeEventListener("error", errorBlocker, true);
    document.removeEventListener("error", errorBlocker, true);

    if (dataUrl) {
      const link = document.createElement("a");
      const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      link.download = `elite-${ts}.png`;
      link.href = dataUrl;
      link.click();
      setFlash({ kind: "ok", message: "Saved." });
    }

    if (wasPicker) setPrefs((p) => ({ ...p, pickerOn: true }));
    setShooting(false);
  }, [prefs.pickerOn, prefs.proxyExternalImages, prefs.captureVideos, shooting]);

  useEffect(() => {
    if (!flash || flash.kind !== "ok") return;
    // If there are details to inspect, leave the toast persistent so the
    // user can copy them. Only auto-dismiss the plain "Saved." case.
    if (flash.details) return;
    const t = setTimeout(() => setFlash(null), 3000);
    return () => clearTimeout(t);
  }, [flash]);

  const copyError = useCallback(async () => {
    if (!flash) return;
    const text = flash.details
      ? `${flash.message}\n\n${flash.details}`
      : flash.message;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback: select text manually
      const el = document.getElementById("privacy-error-text");
      if (el && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [flash]);

  return (
    <div
      data-screenshot-hide="1"
      className="fixed bottom-3 right-3 z-[1100] flex flex-col items-end gap-2 select-none"
    >
      {open && (
        <div className="w-72 rounded-lg border border-gray-700 bg-gray-900/95 backdrop-blur shadow-xl p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-white flex items-center gap-1.5">
              <Shield className="w-4 h-4 text-violet-300" /> Privacy mode
            </h3>
            <button
              onClick={() => setOpen(false)}
              className="text-gray-400 hover:text-white"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
            <span className="flex items-center gap-1.5">
              {enabled ? (
                <Eye className="w-3.5 h-3.5 text-violet-300" />
              ) : (
                <EyeOff className="w-3.5 h-3.5 text-gray-500" />
              )}
              Master toggle
            </span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-violet-500 w-4 h-4"
            />
          </label>

          <div className="space-y-1.5 pl-1 border-l-2 border-gray-800 ml-1">
            <label
              className={`flex items-center justify-between text-xs cursor-pointer ${
                enabled ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5" /> Blur images & videos
              </span>
              <input
                type="checkbox"
                checked={prefs.blurMedia}
                disabled={!enabled}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, blurMedia: e.target.checked }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
            <label
              className={`flex items-center justify-between text-xs cursor-pointer ${
                enabled ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> Blur email / profile PII
              </span>
              <input
                type="checkbox"
                checked={prefs.blurPii}
                disabled={!enabled}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, blurPii: e.target.checked }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
            <label
              className={`flex items-center justify-between text-xs cursor-pointer ${
                enabled ? "text-gray-300" : "text-gray-600"
              }`}
            >
              <span className="flex items-center gap-1.5">
                <MousePointer2 className="w-3.5 h-3.5" /> Tap to blur (custom)
              </span>
              <input
                type="checkbox"
                checked={prefs.pickerOn}
                disabled={!enabled}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, pickerOn: e.target.checked }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-1.5">
            <p className="text-[10px] uppercase tracking-wider text-gray-500">
              Screenshot options
            </p>
            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5" /> Proxy external images
              </span>
              <input
                type="checkbox"
                checked={prefs.proxyExternalImages}
                onChange={(e) =>
                  setPrefs((p) => ({
                    ...p,
                    proxyExternalImages: e.target.checked,
                  }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <Film className="w-3.5 h-3.5" /> Include video frames
              </span>
              <input
                type="checkbox"
                checked={prefs.captureVideos}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, captureVideos: e.target.checked }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
            <label className="flex items-center justify-between text-xs text-gray-300 cursor-pointer">
              <span className="flex items-center gap-1.5">
                <Maximize2 className="w-3.5 h-3.5" /> Full page
              </span>
              <input
                type="checkbox"
                checked={prefs.fullPage}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, fullPage: e.target.checked }))
                }
                className="accent-violet-500 w-4 h-4"
              />
            </label>
            <p className="text-[10px] text-gray-500 leading-snug">
              Full page captures the entire scrollable height (max 16000px).
              Leave off for a faster viewport-only shot.
            </p>
          </div>

          {manualCount > 0 && (
            <div className="flex items-center justify-between text-[11px] text-gray-400">
              <span>{manualCount} manual element{manualCount === 1 ? "" : "s"} blurred</span>
              <button
                onClick={clearManual}
                className="text-violet-300 hover:text-violet-200 underline-offset-2 hover:underline"
              >
                Clear
              </button>
            </div>
          )}

          {prefs.pickerOn && (
            <div className="text-[11px] text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
              Tap or right-click any element to toggle blur. Disable picker before navigating.
            </div>
          )}

          <button
            onClick={takeScreenshot}
            disabled={shooting}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-sm font-medium"
          >
            {shooting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Rendering…
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" /> Download screenshot (PNG)
              </>
            )}
          </button>

          {flash && flash.kind === "ok" && (
            <div className="rounded border border-emerald-700/50 bg-emerald-950/30 p-2 space-y-1.5">
              <div className="text-[11px] font-medium text-emerald-200">
                {flash.message}
              </div>
              {flash.details && (
                <pre
                  id="privacy-error-text"
                  className="text-[10px] text-emerald-100/80 bg-black/40 rounded p-1.5 max-h-32 overflow-auto whitespace-pre-wrap"
                  style={{ userSelect: "text" }}
                >
                  {flash.details}
                </pre>
              )}
              {flash.details && (
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={copyError}
                    className="text-[11px] px-2 py-0.5 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-100"
                  >
                    {copied ? "Copied!" : "Copy details"}
                  </button>
                  <button
                    onClick={() => setFlash(null)}
                    className="text-[11px] text-gray-400 hover:text-white"
                  >
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          )}

          {flash && flash.kind === "error" && (
            <div className="rounded border border-rose-700/50 bg-rose-950/30 p-2 space-y-1.5">
              <div className="text-[11px] font-medium text-rose-200">
                {flash.message}
              </div>
              {flash.details && (
                <pre
                  id="privacy-error-text"
                  className="text-[10px] text-rose-100/80 bg-black/40 rounded p-1.5 max-h-32 overflow-auto whitespace-pre-wrap select-text user-select-text"
                  style={{ userSelect: "text" }}
                >
                  {flash.details}
                </pre>
              )}
              <div className="flex items-center justify-between gap-2">
                <button
                  onClick={copyError}
                  className="text-[11px] px-2 py-0.5 rounded bg-rose-600/30 hover:bg-rose-600/50 text-rose-100"
                >
                  {copied ? "Copied!" : "Copy full error"}
                </button>
                <button
                  onClick={() => setFlash(null)}
                  className="text-[11px] text-gray-400 hover:text-white"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          <p className="text-[10px] text-gray-500 leading-snug">
            Screenshot excludes this widget and the browser chrome (URL bar).
            Renders the current viewport.
          </p>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-11 h-11 rounded-full shadow-lg flex items-center justify-center border ${
          enabled
            ? "bg-violet-600 border-violet-400 text-white"
            : "bg-white/10 border-white/20 text-white/80 hover:bg-white/20 hover:text-white"
        }`}
        aria-label="Privacy controls"
        title={enabled ? "Privacy mode ON" : "Privacy mode"}
      >
        <Shield className="w-5 h-5" />
      </button>
    </div>
  );
}
