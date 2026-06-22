// Return the URL only if it is a safe http(s) link, else null. Guards against
// javascript:/data: URIs reaching an href (XSS) from ingested/scraped data.
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const p = new URL(u.trim());
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
}
