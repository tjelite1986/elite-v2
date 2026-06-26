import { Fragment } from "react";
import Link from "next/link";

// Matches http(s):// URLs, bare www. URLs, or @mentions. Trailing punctuation is
// trimmed from URLs so a link at the end of a sentence keeps the period out.
const TOKEN_RE =
  /(https?:\/\/[^\s<]+[^\s<.,:;!?"')\]}]|www\.[^\s<]+[^\s<.,:;!?"')\]}])|@([a-zA-Z0-9_.]{1,30})/gi;

// The first URL in a string, normalized to an absolute http(s) URL, or null.
export function firstUrl(text: string): string | null {
  const m = text.match(
    /(https?:\/\/[^\s<]+[^\s<.,:;!?"')\]}]|www\.[^\s<]+[^\s<.,:;!?"')\]}])/i
  );
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}

// Render plain message text with clickable links and @mention profile links.
export default function LinkifyText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  TOKEN_RE.lastIndex = 0;

  while ((match = TOKEN_RE.exec(text)) !== null) {
    const url = match[1];
    const handle = match[2];

    // For mentions, require a boundary before '@' (start or whitespace) so we
    // don't linkify the local part of an email like a@b.com.
    if (handle && match.index > 0 && !/\s/.test(text[match.index - 1])) {
      continue;
    }

    if (match.index > last) {
      nodes.push(<Fragment key={key++}>{text.slice(last, match.index)}</Fragment>);
    }

    if (url) {
      const href = url.startsWith("http") ? url : `https://${url}`;
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all text-blue-300 underline underline-offset-2 hover:text-blue-200"
          onClick={(e) => e.stopPropagation()}
        >
          {url}
        </a>
      );
    } else {
      nodes.push(
        <Link
          key={key++}
          href={`/people/${handle}`}
          className="font-medium text-blue-300 hover:text-blue-200"
          onClick={(e) => e.stopPropagation()}
        >
          @{handle}
        </Link>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  }

  return <>{nodes}</>;
}
