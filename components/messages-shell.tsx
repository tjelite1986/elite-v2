"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import MessengerClient from "@/components/messenger-client";
import ChannelsClient from "@/components/channels-client";

// Wraps the messages page in a Direct / Channels tab switcher. Each tab is a
// self-contained client; the shell owns the viewport height below the top-nav.
export default function MessagesShell({ meId }: { meId: number }) {
  const [tab, setTab] = useState<"dm" | "channels">("dm");

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col text-white">
      <div className="flex shrink-0 items-center gap-1 border-b border-white/10 px-3 py-2">
        {(["dm", "channels"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition",
              tab === t ? "bg-white/15" : "text-white/60 hover:bg-white/10"
            )}
          >
            {t === "dm" ? "Direct" : "Channels"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "dm" ? (
          <MessengerClient meId={meId} />
        ) : (
          <ChannelsClient meId={meId} />
        )}
      </div>
    </div>
  );
}
