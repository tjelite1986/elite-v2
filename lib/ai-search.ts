// AI search backend for /ask: calls the Perplexity API directly. Sonar models
// do their own web search and return the cited sources, so no self-hosted
// search stack is needed in between. (A Perplexica/Vane proxy was tried first
// and removed — its agentic pipeline requires tool calling, which the sonar
// API rejects.)

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_MODEL = process.env.PERPLEXITY_MODEL || "sonar";

// Without steering, search-grounded models answer like an encyclopedia digest,
// which reads flat for open-ended questions. Overridable per instance.
const SYSTEM_PROMPT =
  process.env.PERPLEXITY_SYSTEM_PROMPT ||
  "You are the house AI of a private social platform, talking with a friend. " +
    "Always answer in the same language as the question. Be engaging and " +
    "personal: have a take, use concrete examples and a bit of humor where it " +
    "fits. For factual questions, stay accurate and lean on your search " +
    "results. For big open questions (life, meaning, taste), give a genuinely " +
    "interesting answer with different perspectives and your own conclusion " +
    "instead of a neutral encyclopedia summary. Never pad, never disclaim.";

export interface AiSearchSource {
  title: string;
  url: string;
}

export interface AiSearchResult {
  message: string;
  sources: AiSearchSource[];
}

// [human|assistant, message] pairs kept client-side for follow-up questions.
export type AiSearchHistory = [string, string][];

// Thrown when no API key is configured — callers turn this into a friendly
// message instead of a generic failure.
export class AiSearchNotConfiguredError extends Error {
  constructor() {
    super("PERPLEXITY_API_KEY is not set");
  }
}

export async function aiSearch(
  query: string,
  history: AiSearchHistory
): Promise<AiSearchResult> {
  if (!PERPLEXITY_API_KEY) throw new AiSearchNotConfiguredError();

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
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
