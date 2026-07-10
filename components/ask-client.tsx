"use client";

import { useRef, useState } from "react";
import { ArrowUp, Globe, Loader2, Sparkles } from "lucide-react";
import Markdown from "@/components/markdown";
import { cn } from "@/lib/utils";

interface Source {
  title: string;
  url: string;
}

interface Turn {
  question: string;
  answer?: string;
  sources?: Source[];
  error?: string;
}

const SUGGESTIONS = [
  "What happened in tech news today?",
  "Explain how SQLite WAL mode works",
  "Best sci-fi movies of the last year",
];

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Perplexity-style AI search: ask a question, get a web-grounded answer with
// numbered source citations from the self-hosted Perplexica backend. Turns are
// kept client-side and sent as history so follow-ups have context.
export default function AskClient() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ask = async (raw: string) => {
    const question = raw.trim();
    if (!question || busy) return;
    setInput("");
    setBusy(true);
    setTurns((t) => [...t, { question }]);
    // Answered turns become [human, assistant] pairs for follow-up context.
    const history = turns
      .filter((t) => t.answer)
      .flatMap((t) => [
        ["human", t.question],
        ["assistant", t.answer!],
      ]);
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: question, history }),
      });
      const data = await res.json().catch(() => ({}));
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1
            ? res.ok
              ? { ...turn, answer: data.message, sources: data.sources }
              : { ...turn, error: data.error || "AI search failed" }
            : turn
        )
      );
    } catch {
      setTurns((t) =>
        t.map((turn, i) =>
          i === t.length - 1 ? { ...turn, error: "AI search failed" } : turn
        )
      );
    } finally {
      setBusy(false);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    ask(input);
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-32 pt-20 text-white md:pt-24">
      {turns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/15">
            <Sparkles className="h-7 w-7 text-blue-300" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Ask anything</h1>
            <p className="mt-1 text-sm text-white/50">
              Web-grounded answers with sources, powered by the house AI.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => ask(s)}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/25 hover:text-white"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {turns.map((turn, i) => (
            <section key={i}>
              <h2 className="text-lg font-semibold leading-snug">{turn.question}</h2>
              {turn.error ? (
                <p className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                  {turn.error}
                </p>
              ) : !turn.answer ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-white/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Searching the web...
                </div>
              ) : (
                <>
                  {turn.sources && turn.sources.length > 0 && (
                    <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                      {turn.sources.map((s, n) => (
                        <a
                          key={n}
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-44 shrink-0 flex-col gap-1 rounded-lg border border-white/10 bg-white/5 p-2.5 transition hover:border-white/25 hover:bg-white/10"
                        >
                          <span className="line-clamp-2 text-xs leading-snug text-white/80">
                            {s.title}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-white/40">
                            <Globe className="h-3 w-3 shrink-0" />
                            <span className="truncate">
                              {n + 1} · {hostOf(s.url)}
                            </span>
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                  <Markdown text={turn.answer} className="mt-4 text-[15px] leading-relaxed" />
                </>
              )}
            </section>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <form
        onSubmit={submit}
        data-immersive-hide
        className="fixed bottom-6 left-1/2 w-[95%] max-w-3xl -translate-x-1/2 px-4"
      >
        <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-zinc-900/90 p-2 pl-4 shadow-xl backdrop-blur">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={turns.length ? "Ask a follow-up..." : "Ask anything..."}
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/35"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition",
              busy || !input.trim()
                ? "bg-white/10 text-white/30"
                : "bg-blue-500 text-white hover:bg-blue-400"
            )}
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </main>
  );
}
