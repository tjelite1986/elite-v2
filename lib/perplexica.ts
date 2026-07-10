// Client for the self-hosted Perplexica (Vane) instance on the docker network.
// It answers a question with web search + LLM and returns cited sources. Which
// chat model to use is discovered from the instance's configured providers, so
// adding/changing API keys in the Perplexica UI needs no change here.

const PERPLEXICA_URL = process.env.PERPLEXICA_URL || "http://perplexica:3000";

interface ProviderModel {
  name: string;
  key: string;
}

interface Provider {
  id: string;
  name: string;
  chatModels: ProviderModel[];
  embeddingModels: ProviderModel[];
}

export interface AiSearchSource {
  title: string;
  url: string;
}

export interface AiSearchResult {
  message: string;
  sources: AiSearchSource[];
}

// [human|assistant, message] pairs, Perplexica's history format.
export type AiSearchHistory = [string, string][];

interface ModelSelection {
  chat: { providerId: string; key: string };
  embedding: { providerId: string; key: string };
}

// Pick a chat + embedding model from whatever is configured. Chat prefers
// Perplexity's sonar models (the point of the feature), then any provider with
// a chat model. Embedding prefers the built-in local Transformers MiniLM.
async function pickModels(): Promise<ModelSelection | null> {
  const res = await fetch(`${PERPLEXICA_URL}/api/providers`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Perplexica providers request failed: ${res.status}`);
  const { providers } = (await res.json()) as { providers: Provider[] };

  const chatCandidates = providers.flatMap((p) =>
    p.chatModels.map((m) => ({ providerId: p.id, providerName: p.name, ...m }))
  );
  if (chatCandidates.length === 0) return null;
  const chat =
    chatCandidates.find(
      (c) =>
        c.key.toLowerCase().includes("sonar") ||
        c.providerName.toLowerCase().includes("perplexity")
    ) ?? chatCandidates[0];

  const embeddingCandidates = providers.flatMap((p) =>
    p.embeddingModels.map((m) => ({ providerId: p.id, ...m }))
  );
  if (embeddingCandidates.length === 0) return null;
  const embedding =
    embeddingCandidates.find((c) => c.key.toLowerCase().includes("minilm")) ??
    embeddingCandidates[0];

  return {
    chat: { providerId: chat.providerId, key: chat.key },
    embedding: { providerId: embedding.providerId, key: embedding.key },
  };
}

// Thrown when Perplexica is reachable but has no chat model configured yet
// (API key not set up in its UI) — callers turn this into a friendly message.
export class AiSearchNotConfiguredError extends Error {
  constructor() {
    super("Perplexica has no chat model configured");
  }
}

export async function aiSearch(
  query: string,
  history: AiSearchHistory
): Promise<AiSearchResult> {
  const models = await pickModels();
  if (!models) throw new AiSearchNotConfiguredError();

  const res = await fetch(`${PERPLEXICA_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chatModel: models.chat,
      embeddingModel: models.embedding,
      optimizationMode: "balanced",
      sources: ["web"],
      query,
      history,
      stream: false,
    }),
    // Search + LLM round trip is slow; give it plenty before failing.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Perplexica search failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    message: string;
    sources?: { metadata?: { title?: string; url?: string } }[];
  };
  return {
    message: data.message,
    sources: (data.sources ?? [])
      .map((s) => ({
        title: s.metadata?.title || s.metadata?.url || "Untitled",
        url: s.metadata?.url || "",
      }))
      .filter((s) => s.url),
  };
}
