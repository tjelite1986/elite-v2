// Shared grammar for the shorts caption field. A caption carries up to three
// parts — "title\n\n#tag1 #tag2\n\nSource: <url>" — which is the format the
// grabbit import sidecars use; the player and grid render/edit them as
// separate rows. Unicode word chars keep åäö tags working. The source is
// stripped before hashtag matching so URL fragments never leak into tags.
export const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu;
export const SOURCE_RE = /(?:^|\s)Source:\s*(https?:\/\/\S+)/i;

export function splitCaption(caption: string | null): {
  title: string;
  tags: string[];
  source: string | null;
} {
  const source = caption?.match(SOURCE_RE)?.[1] ?? null;
  const stripped = (caption ?? "").replace(SOURCE_RE, " ");
  const tags = stripped.match(HASHTAG_RE) ?? [];
  const title = stripped
    .replace(HASHTAG_RE, "")
    .replace(/\s+/g, " ")
    .trim();
  return { title, tags: Array.from(new Set(tags)), source };
}

export function buildCaption(parts: {
  title: string;
  tags: string[];
  source: string | null;
}): string {
  return [
    parts.title.trim(),
    parts.tags.join(" "),
    parts.source ? `Source: ${parts.source}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
