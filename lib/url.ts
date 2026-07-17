// Return the URL only if it is a safe http(s) link, else null. Guards against
// javascript:/data: URIs reaching an href (XSS) from ingested/scraped data.
// `prependScheme` accepts bare domains (user-typed profile links) by trying
// https:// in front of a scheme-less value before validating.
export function safeHttpUrl(
  u: string | null | undefined,
  opts: { prependScheme?: boolean } = {}
): string | null {
  if (!u) return null;
  let url = u.trim();
  if (!url) return null;
  if (opts.prependScheme && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const p = new URL(url);
    return p.protocol === "https:" || p.protocol === "http:" ? p.toString() : null;
  } catch {
    return null;
  }
}
