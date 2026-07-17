import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  aiSearch,
  AiSearchNotConfiguredError,
  type AiSearchHistory,
} from "@/lib/ai-search";

export const dynamic = "force-dynamic";

// In-memory throttle: each request is a billed Perplexity API call, so cap it
// at 20 requests per 5 minutes per user. Resets on process restart, which is
// fine for a single-box personal hub.
const MAX_REQUESTS = 20;
const WINDOW_MS = 5 * 60 * 1000;
const usage = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const rec = usage.get(userId);
  if (!rec || now > rec.resetAt) {
    usage.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > MAX_REQUESTS;
}

// Ask the Perplexity API a question (web search + LLM answer with cited
// sources). History enables follow-up questions in the same thread.
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (isRateLimited(session.sub)) {
    return NextResponse.json(
      { error: "Too many searches. Try again in a few minutes." },
      { status: 429 }
    );
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
            typeof t[1] === "string" &&
            t[1].length <= 4000
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
            "AI search is not configured - PERPLEXITY_API_KEY is missing.",
        },
        { status: 503 }
      );
    }
    console.error("ai-search failed:", e);
    return NextResponse.json({ error: "AI search failed" }, { status: 502 });
  }
}
