import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

// Turn bare @handles into markdown links to the person's profile. Skips matches
// that follow a word character (so emails like a@b.com aren't touched).
function withMentions(text: string): string {
  return text.replace(
    /(^|[^\w])@([a-zA-Z0-9_.]{1,30})/g,
    (_m, pre, handle) => `${pre}[@${handle}](/people/${handle})`
  );
}

// Render user text as safe markdown (GFM, no raw HTML, no images). URLs are
// auto-linked by remark-gfm; @mentions link to profiles. Used for post captions
// and comments.
export default function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-snug",
        "[&_a]:text-blue-300 [&_a]:underline [&_a]:underline-offset-2",
        "[&_p]:my-0 [&_p+p]:mt-1.5 [&_strong]:font-semibold [&_em]:italic",
        "[&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_code]:rounded [&_code]:bg-white/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-white/20 [&_blockquote]:pl-3 [&_blockquote]:text-white/70",
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        disallowedElements={["img"]}
        unwrapDisallowed
        components={{
          a: ({ href, children }) => {
            const internal = typeof href === "string" && href.startsWith("/");
            return (
              <a
                href={href}
                {...(internal
                  ? {}
                  : { target: "_blank", rel: "noopener noreferrer nofollow" })}
              >
                {children}
              </a>
            );
          },
        }}
      >
        {withMentions(text)}
      </ReactMarkdown>
    </div>
  );
}
