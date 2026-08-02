// Third-party data (ThePornDB records, .nfo sidecars dropped in a release
// folder) ends up in href attributes. A "javascript:" URL there runs script on
// click, so every such value is checked against an allowlist of schemes before
// it is rendered — and again before it is stored, so a bad value never even
// reaches the database.
const SAFE_SCHEMES = new Set(["http:", "https:"]);

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return SAFE_SCHEMES.has(url.protocol) ? url.toString() : null;
  } catch {
    // Not absolute, so it carries no scheme of its own and cannot be a
    // javascript: URI — but a relative link to a third party is meaningless
    // here anyway.
    return null;
  }
}
