import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

const LADDA = process.env.LADDA_URL || "http://ladda:3000";

// Proxy to the ladda grabber: batch-download a profile's clips into the channel's
// import folder, streaming Server-Sent Events progress through. Admin only.
export async function GET(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "admin") {
    return new Response("Forbidden", { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({
    url: sp.get("url") || "",
    channel: sp.get("channel") === "18plus" ? "18plus" : "main",
  });
  if (sp.get("ids")) qs.set("ids", sp.get("ids") as string);
  if (sp.get("creator")) qs.set("creator", sp.get("creator") as string);
  if (sp.get("web") === "1") qs.set("web", "1");

  let upstream: Response;
  try {
    upstream = await fetch(`${LADDA}/api/download-all?${qs.toString()}`);
  } catch {
    return new Response("data: " + JSON.stringify({ type: "error", error: "Grabber unreachable" }) + "\n\n", {
      headers: { "Content-Type": "text/event-stream" },
    });
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
