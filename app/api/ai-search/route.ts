import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  aiSearch,
  AiSearchNotConfiguredError,
  type AiSearchHistory,
} from "@/lib/ai-search";

export const dynamic = "force-dynamic";

// Ask the self-hosted Perplexica instance a question (web search + LLM answer
// with cited sources). History enables follow-up questions in the same thread.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { query?: unknown; history?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 4000) {
    return NextResponse.json({ error: "Missing or too long query" }, { status: 400 });
  }

  // History is [role, message] pairs; validate shape and cap size so a client
  // can't relay an unbounded payload to the backend.
  const history: AiSearchHistory = Array.isArray(body.history)
    ? (body.history as unknown[])
        .filter(
          (t): t is [string, string] =>
            Array.isArray(t) &&
            t.length === 2 &&
            (t[0] === "human" || t[0] === "assistant") &&
            typeof t[1] === "string"
        )
        .slice(-20)
    : [];

  try {
    const result = await aiSearch(query, history);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof AiSearchNotConfiguredError) {
      return NextResponse.json(
        {
          error:
            "AI search is not configured yet - add an API key in Perplexica's settings.",
        },
        { status: 503 }
      );
    }
    console.error("ai-search failed:", e);
    return NextResponse.json({ error: "AI search failed" }, { status: 502 });
  }
}
