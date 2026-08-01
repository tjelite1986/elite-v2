import Link from "next/link";

// A bio is plain text that reads like it has links in it: "@handle" for accounts
// and bare domains for sites, the way Instagram renders them. Both are matched in
// one pass so the pieces come out in order, and everything between them is kept
// verbatim — line breaks included, since a bio is written as lines.
// Order matters: an email is matched before the domain and the handle inside it
// would be, or "sanjay@gmail.com" turns into a link to a profile named gmail.com.
const SEGMENT =
  /([\w.+-]+@[\w-]+\.[a-z]{2,}|https?:\/\/[^\s<]+|(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s<]*)?|@[a-zA-Z0-9_.]{1,30})/gi;

// A trailing ".", "," or ")" is almost always sentence punctuation rather than
// part of the address, and an @handle cannot end in a dot either.
function trimTrailing(token: string): [string, string] {
  const match = token.match(/[).,!?:;]+$/);
  if (!match) return [token, ""];
  return [token.slice(0, -match[0].length), match[0]];
}

export interface BioTextProps {
  text: string;
  /**
   * Where each @handle in the text should point, by handle. A handle we host is
   * a link to that profile; anything else falls back to Instagram, because a bio
   * mentions Instagram accounts and most of them are not in this library — a
   * local link would just 404.
   */
  mentionHrefs?: Record<string, string>;
  className?: string;
}

export default function BioText({ text, mentionHrefs = {}, className }: BioTextProps) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  for (const match of text.matchAll(SEGMENT)) {
    const index = match.index ?? 0;
    const [token, tail] = trimTrailing(match[0]);
    if (!token) continue;

    if (index > last) parts.push(text.slice(last, index));
    last = index + match[0].length;

    // A handle glued to the end of a word is part of that word, not a mention.
    if (token.startsWith("@") && index > 0 && /\w/.test(text[index - 1])) {
      parts.push(match[0]);
      continue;
    }

    if (token.includes("@") && !token.startsWith("@")) {
      parts.push(
        <a key={key++} href={`mailto:${token}`} className="text-blue-300 hover:underline">
          {token}
        </a>
      );
    } else if (token.startsWith("@")) {
      const handle = token.slice(1).replace(/\.+$/, "");
      const href = mentionHrefs[handle.toLowerCase()];
      parts.push(
        href ? (
          <Link key={key++} href={href} className="text-blue-300 hover:underline">
            {token}
          </Link>
        ) : (
          <a
            key={key++}
            href={`https://www.instagram.com/${encodeURIComponent(handle)}/`}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-blue-300 hover:underline"
          >
            {token}
          </a>
        )
      );
    } else {
      const href = token.startsWith("http") ? token : `https://${token}`;
      parts.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-blue-300 hover:underline"
        >
          {token}
        </a>
      );
    }
    if (tail) parts.push(tail);
  }
  if (last < text.length) parts.push(text.slice(last));

  return <p className={className}>{parts}</p>;
}
