"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Minus,
  Plus,
} from "lucide-react";

type Format = "epub" | "pdf" | "cbz";

interface Props {
  slug: string;
  title: string;
  author: string | null;
  format: Format;
  initialPosition: string | null;
  initialFinished: boolean;
}

// Persist reading progress (debounced by the caller's cadence).
function useSaveState(slug: string) {
  return useCallback(
    (patch: { position?: string; percent?: number; finished?: boolean }) => {
      fetch(`/api/books/${slug}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {});
    },
    [slug]
  );
}

export default function BookReader(props: Props) {
  const router = useRouter();
  const save = useSaveState(props.slug);
  const [finished, setFinished] = useState(props.initialFinished);
  const [page, setPage] = useState<{ current: number; total: number } | null>(
    null
  );

  const toggleFinished = () => {
    const next = !finished;
    setFinished(next);
    save({ finished: next });
  };

  const fileUrl = `/api/books/${props.slug}/file`;

  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-[#121212] text-white">
      <header className="flex items-center gap-3 border-b border-white/10 px-3 py-2">
        <button
          onClick={() => router.push("/books")}
          className="rounded-md p-1.5 hover:bg-white/10"
          aria-label="Back to library"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{props.title}</div>
          {props.author && (
            <div className="truncate text-xs text-white/40">{props.author}</div>
          )}
        </div>
        {page && (
          <span className="hidden text-xs text-white/40 sm:inline">
            {page.current} / {page.total}
          </span>
        )}
        <button
          onClick={toggleFinished}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${
            finished
              ? "bg-green-500/20 text-green-300"
              : "bg-white/10 text-white/70 hover:bg-white/20"
          }`}
        >
          <Check className="h-3.5 w-3.5" />
          {finished ? "Finished" : "Mark read"}
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        {props.format === "epub" && (
          <EpubReader
            fileUrl={fileUrl}
            initialPosition={props.initialPosition}
            onProgress={save}
          />
        )}
        {props.format === "pdf" && (
          <PdfReader
            fileUrl={fileUrl}
            initialPosition={props.initialPosition}
            onProgress={save}
            onPage={setPage}
          />
        )}
        {props.format === "cbz" && (
          <CbzReader
            fileUrl={fileUrl}
            initialPosition={props.initialPosition}
            onProgress={save}
            onPage={setPage}
          />
        )}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="absolute inset-0 flex items-center justify-center text-white/40">
      <Loader2 className="h-7 w-7 animate-spin" />
    </div>
  );
}

/* ---------------------------------- EPUB ---------------------------------- */

function EpubReader({
  fileUrl,
  initialPosition,
  onProgress,
}: {
  fileUrl: string;
  initialPosition: string | null;
  onProgress: (p: { position?: string; percent?: number }) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [fontPct, setFontPct] = useState(100);

  useEffect(() => {
    let cancelled = false;
    let book: any;
    (async () => {
      const ePub = (await import("epubjs")).default;
      if (cancelled || !hostRef.current) return;
      book = ePub(fileUrl);
      const rendition = book.renderTo(hostRef.current, {
        width: "100%",
        height: "100%",
        flow: "paginated",
        spread: "auto",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      rendition.themes.register("dark", {
        body: { background: "#121212", color: "#dcdcdc" },
        a: { color: "#7aa2ff" },
      });
      rendition.themes.select("dark");
      rendition.themes.fontSize("100%");
      await rendition.display(initialPosition || undefined);
      if (cancelled) return;
      setLoading(false);

      book.ready
        .then(() => book.locations.generate(1600))
        .then(() => {
          rendition.on("relocated", (loc: any) => {
            const cfi = loc?.start?.cfi;
            if (!cfi) return;
            let percent = 0;
            try {
              percent = Math.round(
                (book.locations.percentageFromCfi(cfi) || 0) * 100
              );
            } catch {
              /* locations not ready */
            }
            onProgress({ position: cfi, percent });
          });
        })
        .catch(() => {});
    })();

    return () => {
      cancelled = true;
      try {
        book?.destroy();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") renditionRef.current?.prev();
      if (e.key === "ArrowRight") renditionRef.current?.next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const setFont = (pct: number) => {
    const clamped = Math.max(70, Math.min(200, pct));
    setFontPct(clamped);
    renditionRef.current?.themes.fontSize(`${clamped}%`);
  };

  return (
    <div className="absolute inset-0">
      {loading && <Spinner />}
      <div ref={hostRef} className="h-full w-full" />
      <ReaderArrows
        onPrev={() => renditionRef.current?.prev()}
        onNext={() => renditionRef.current?.next()}
      />
      <div className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/50 p-1">
        <button
          onClick={() => setFont(fontPct - 10)}
          className="rounded-full p-1.5 hover:bg-white/10"
          aria-label="Smaller text"
        >
          <Minus className="h-4 w-4" />
        </button>
        <span className="w-9 text-center text-xs text-white/60">{fontPct}%</span>
        <button
          onClick={() => setFont(fontPct + 10)}
          className="rounded-full p-1.5 hover:bg-white/10"
          aria-label="Larger text"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ---------------------------------- PDF ----------------------------------- */

function PdfReader({
  fileUrl,
  initialPosition,
  onProgress,
  onPage,
}: {
  fileUrl: string;
  initialPosition: string | null;
  onProgress: (p: { position?: string; percent?: number }) => void;
  onPage: (p: { current: number; total: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [pageNum, setPageNum] = useState(Number(initialPosition) || 1);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({
        url: fileUrl,
        withCredentials: true,
      }).promise;
      if (cancelled) return;
      docRef.current = doc;
      setTotal(doc.numPages);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      try {
        docRef.current?.destroy();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  // Render the current page whenever it (or the loaded doc) changes.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !canvasRef.current || total === 0) return;
    let cancelled = false;
    (async () => {
      const safe = Math.max(1, Math.min(total, pageNum));
      const pdfPage = await doc.getPage(safe);
      if (cancelled || !canvasRef.current) return;
      const parentW = canvasRef.current.parentElement?.clientWidth || 800;
      const base = pdfPage.getViewport({ scale: 1 });
      const scale = Math.min(2.5, (parentW - 16) / base.width);
      const viewport = pdfPage.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d")!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await pdfPage.render({ canvasContext: ctx, viewport }).promise;
      onPage({ current: safe, total });
      onProgress({
        position: String(safe),
        percent: Math.round((safe / total) * 100),
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageNum, total]);

  return (
    <div className="absolute inset-0 overflow-auto bg-black">
      {loading && <Spinner />}
      <div className="flex min-h-full items-start justify-center p-2">
        <canvas ref={canvasRef} className="max-w-full" />
      </div>
      <ReaderArrows
        onPrev={() => setPageNum((p) => Math.max(1, p - 1))}
        onNext={() => setPageNum((p) => Math.min(total, p + 1))}
      />
    </div>
  );
}

/* ---------------------------------- CBZ ----------------------------------- */

function CbzReader({
  fileUrl,
  initialPosition,
  onProgress,
  onPage,
}: {
  fileUrl: string;
  initialPosition: string | null;
  onProgress: (p: { position?: string; percent?: number }) => void;
  onPage: (p: { current: number; total: number }) => void;
}) {
  const [pages, setPages] = useState<string[]>([]);
  const [idx, setIdx] = useState(Number(initialPosition) || 0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    (async () => {
      const JSZip = (await import("jszip")).default;
      const buf = await fetch(fileUrl).then((r) => r.arrayBuffer());
      if (cancelled) return;
      const zip = await JSZip.loadAsync(buf);
      const entries = Object.values(zip.files)
        .filter((f: any) => !f.dir && /\.(jpe?g|png|webp|gif)$/i.test(f.name))
        .sort((a: any, b: any) =>
          a.name.localeCompare(b.name, undefined, { numeric: true })
        );
      for (const entry of entries) {
        const blob = await (entry as any).async("blob");
        if (cancelled) return;
        urls.push(URL.createObjectURL(blob));
      }
      if (cancelled) return;
      setPages(urls);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileUrl]);

  useEffect(() => {
    if (pages.length === 0) return;
    const safe = Math.max(0, Math.min(pages.length - 1, idx));
    onPage({ current: safe + 1, total: pages.length });
    onProgress({
      position: String(safe),
      percent: Math.round(((safe + 1) / pages.length) * 100),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, pages]);

  return (
    <div className="absolute inset-0 overflow-auto bg-black">
      {loading && <Spinner />}
      {pages[Math.max(0, Math.min(pages.length - 1, idx))] && (
        <div className="flex min-h-full items-center justify-center p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={pages[Math.max(0, Math.min(pages.length - 1, idx))]}
            alt=""
            className="max-h-full max-w-full object-contain"
          />
        </div>
      )}
      <ReaderArrows
        onPrev={() => setIdx((i) => Math.max(0, i - 1))}
        onNext={() => setIdx((i) => Math.min(pages.length - 1, i + 1))}
      />
    </div>
  );
}

/* ------------------------------ shared arrows ----------------------------- */

function ReaderArrows({
  onPrev,
  onNext,
}: {
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <button
        onClick={onPrev}
        className="absolute left-0 top-0 flex h-full w-[18%] items-center justify-start pl-2 text-white/0 transition hover:bg-gradient-to-r hover:from-black/40 hover:to-transparent hover:text-white/70"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-7 w-7" />
      </button>
      <button
        onClick={onNext}
        className="absolute right-0 top-0 flex h-full w-[18%] items-center justify-end pr-2 text-white/0 transition hover:bg-gradient-to-l hover:from-black/40 hover:to-transparent hover:text-white/70"
        aria-label="Next page"
      >
        <ChevronRight className="h-7 w-7" />
      </button>
    </>
  );
}
