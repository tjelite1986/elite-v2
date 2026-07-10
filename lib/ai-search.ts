// AI search backend for /ask. Primary path calls the Perplexity API directly:
// sonar models do their own web search and return citations, and going through
// Perplexica breaks on them (its agentic pipeline needs tool calling, which
// the sonar API doesn't support — requests die as unhandled rejections).
// Without a PERPLEXITY_API_KEY the self-hosted Perplexica instance is used
// instead, which works when it's configured with a tool-calling-capable model.

import {
  aiSearch as perplexicaSearch,
  AiSearchNotConfiguredError,
  type AiSearchHistory,
  type AiSearchResult,
} from "./perplexica";

export { AiSearchNotConfiguredError };
export type { AiSearchHistory, AiSearchResult };

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "sonar";

async function perplexityDirect(
  query: string,
  history: AiSearchHistory
): Promise<AiSearchResult> {
  const messages = [
    ...history.map(([role, content]) => ({
      role: role === "human" ? "user" : "assistant",
      content,
    })),
    { role: "user", content: query },
  ];

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: PERPLEXITY_MODEL, messages }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Perplexity API failed: ${res.status} ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
    search_results?: { title?: string; url?: string }[];
  };
  return {
    message: data.choices[0]?.message?.content ?? "",
    sources: (data.search_results ?? [])
      .map((s) => ({ title: s.title || s.url || "Untitled", url: s.url || "" }))
      .filter((s) => s.url),
  };
}

export async function aiSearch(
  query: string,
  history: AiSearchHistory
): Promise<AiSearchResult> {
  if (PERPLEXITY_API_KEY) return perplexityDirect(query, history);
  return perplexicaSearch(query, history);
}
