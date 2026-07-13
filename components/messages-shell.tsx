"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Images, Menu, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useWs } from "@/components/ws-provider";
import MessengerClient from "@/components/messenger-client";
import ChannelsClient from "@/components/channels-client";
import {
  StoriesTab,
  NotificationsTab,
  MenuTab,
} from "@/components/messenger-tabs";

type MainTab = "chats" | "stories" | "notifications" | "menu";

const TABS: { key: MainTab; label: string; icon: typeof MessageCircle }[] = [
  { key: "chats", label: "Chats", icon: MessageCircle },
  { key: "stories", label: "Stories", icon: Images },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "menu", label: "Menu", icon: Menu },
];

// Messenger-style shell for /messages: a bottom tab bar switches between
// Chats (Direct/Channels), Stories, Notifications and Menu. The shell owns the
// viewport height below the top-nav and tracks unread badges for the bar.
export default function MessagesShell({
  meId,
  myUsername,
  myEmail,
  isAdmin,
}: {
  meId: number;
  myUsername: string;
  myEmail: string;
  isAdmin: boolean;
}) {
  const { subscribe } = useWs();
  const [tab, setTab] = useState<MainTab>("chats");
  const [chatTab, setChatTab] = useState<"dm" | "channels">("dm");
  const [dmUnread, setDmUnread] = useState(0);
  const [notifCount, setNotifCount] = useState(0);

  // Device Back returns to Chats from any other tab before leaving the page.
  useBackDismiss(tab !== "chats", () => setTab("chats"));

  // Lift floating action buttons (privacy controls) above the bottom tab bar
  // while the messenger shell is mounted.
  useEffect(() => {
    document.documentElement.style.setProperty("--fab-offset", "3.5rem");
    return () => {
      document.documentElement.style.removeProperty("--fab-offset");
    };
  }, []);

  const loadNotifCount = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (res.ok) setNotifCount((await res.json()).unreadCount ?? 0);
    } catch {
      /* noop */
    }
  }, []);

  const loadDmUnread = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/users");
      if (res.ok) {
        const users = (await res.json()).users as { unread: number }[];
        setDmUnread(users.reduce((sum, u) => sum + (u.unread || 0), 0));
      }
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    loadNotifCount();
    loadDmUnread();
  }, [loadNotifCount, loadDmUnread]);

  // Refresh badges on live events, debounced — a burst of messages should not
  // trigger a fetch per message.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  useEffect(() => {
    return subscribe((data) => {
      if (data.type !== "message" && data.type !== "notification") return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        loadNotifCount();
        loadDmUnread();
      }, 800);
    });
  }, [subscribe, loadNotifCount, loadDmUnread]);

  const badge = (t: MainTab): number =>
    t === "chats" ? dmUnread : t === "notifications" ? notifCount : 0;

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col text-white">
      <div className="min-h-0 flex-1">
        {tab === "chats" && (
          <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-2">
              <span className="text-2xl font-bold">Chats</span>
              <div className="flex items-center gap-1">
                {(["dm", "channels"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChatTab(t)}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-sm font-medium transition",
                      chatTab === t
                        ? "bg-white/15"
                        : "text-white/60 hover:bg-white/10"
                    )}
                  >
                    {t === "dm" ? "Direct" : "Channels"}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1">
              {chatTab === "dm" ? (
                <MessengerClient meId={meId} onUnreadChange={setDmUnread} />
              ) : (
                <ChannelsClient meId={meId} />
              )}
            </div>
          </div>
        )}
        {tab === "stories" && <StoriesTab myUsername={myUsername} />}
        {tab === "notifications" && (
          <NotificationsTab onCountChange={setNotifCount} />
        )}
        {tab === "menu" && (
          <MenuTab myUsername={myUsername} myEmail={myEmail} isAdmin={isAdmin} />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="flex shrink-0 border-t border-white/10 bg-black/40 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = badge(key);
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
                tab === key ? "text-blue-400" : "text-white/50 hover:text-white/80"
              )}
            >
              <span className="relative">
                <Icon size={22} strokeWidth={tab === key ? 2.4 : 2} />
                {count > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </span>
              {label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
