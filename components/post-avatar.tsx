"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

function initials(name: string | null): string {
  const s = (name || "?").replace(/[^a-zA-Z0-9]/g, "");
  return (s.slice(0, 2) || "?").toUpperCase();
}

// A static query so the avatar URL differs from the pre-ETag-fix one that
// browsers cached under a 24h max-age — they'd otherwise keep serving the stale
// picture for up to a day. Bump if a similar mass cache-bust is ever needed.
const CACHE_BUST = "2";

// Round avatar for a user/creator handle. Loads /api/profiles/<username>/avatar
// and falls back to initials when there's no avatar (404) or no username.
export default function PostAvatar({
  username,
  size = 36,
  className,
  version,
}: {
  username: string | null;
  size?: number;
  className?: string;
  // Bump to bust the avatar's 24h cache after it's changed (the URL is keyed by
  // username, so without this a new picture keeps showing the cached old one).
  version?: number;
}) {
  const [failed, setFailed] = useState(false);
  const showImg = username && !failed;
  const src =
    `/api/profiles/${encodeURIComponent(username || "")}/avatar?c=${CACHE_BUST}` +
    (version ? `&v=${version}` : "");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-rose-500/70 to-purple-600/70 text-xs font-semibold text-white",
        className
      )}
      style={{ width: size, height: size }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        initials(username)
      )}
    </span>
  );
}
