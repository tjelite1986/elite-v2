"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

function initials(name: string | null): string {
  const s = (name || "?").replace(/[^a-zA-Z0-9]/g, "");
  return (s.slice(0, 2) || "?").toUpperCase();
}

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
    `/api/profiles/${encodeURIComponent(username || "")}/avatar` +
    (version ? `?v=${version}` : "");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-rose-500 to-purple-600 text-xs font-semibold text-white",
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
