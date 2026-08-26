"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Bell,
  Images,
  Menu,
  MessageCircle,
  MessagesSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import { useWs } from "@/components/ws-provider";
import StoryRail from "@/components/story-rail";
import MessengerClient from "@/components/messenger-client";
import ChannelsClient from "@/components/channels-client";
import {
  StoriesTab,
  NotificationsTab,
  MenuTab,
  RequestsView,
} from "@/components/messenger-tabs";

// "requests" is a drill-in view under Menu, not a bar tab of its own.
type MainTab = "chats" | "stories" | "notifications" | "menu" | "requests";

type BarTab = Exclude<MainTab, "requests">;

// Channels is not a MainTab of its own: it is the chats view with its inner
// tab flipped. It earns a bar slot anyway because reaching it through
// Chats → Channels made it feel like a sub-feature of DMs rather than the
// other half of the messenger.
type BarKey = BarTab | "channels";

const TABS: { key: BarKey; label: string; icon: typeof MessageCircle }[] = [
  { key: "chats", label: "Chats", icon: MessageCircle },
  { key: "channels", label: "Channels", icon: MessagesSquare },
  { key: "stories", label: "Stories", icon: Images },
  { key: "notifications", label: "Notifications", icon: Bell },
  { key: "menu", label: "Menu", icon: Menu },
];

// Messenger-style shell for /messages: a bottom tab bar switches between
// Chats (Direct/Channels), Stories, Notifications and Menu. The shell owns the
// full viewport height and tracks unread badges for the bar. ?tab= deep-links
// into a specific bar tab (used by the global nav menu's Notifications row).
export default function MessagesShell({
  meId,
  myUsername,
  myDisplayName,
  myEmail,
  isAdmin = false,
  showAppstore = true,
}: {
  meId: number;
  myUsername: string;
  myDisplayName?: string | null;
  myEmail: string;
  isAdmin?: boolean;
  // Passed straight through to the menu; see nav-menu-content.tsx.
  showAppstore?: boolean;
}) {
  const { subscribe } = useWs();
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<MainTab>(
    initialTab === "channels"
      ? "chats"
      : TABS.some((t) => t.key === initialTab)
        ? (initialTab as BarTab)
        : "chats"
  );

  // Also react to ?tab= changing while mounted (e.g. tapping the menu's
  // Notifications row while already on /messages).
  useEffect(() => {
    if (initialTab === "channels") {
      setTab("chats");
      setChatTab("channels");
      return;
    }
    if (TABS.some((t) => t.key === initialTab)) setTab(initialTab as BarTab);
  }, [initialTab]);
  const [chatTab, setChatTab] = useState<"dm" | "channels">(
    initialTab === "channels" ? "channels" : "dm"
  );
  const [dmUnread, setDmUnread] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [requestsCount, setRequestsCount] = useState(0);

  // Device Back unwinds one level: requests → menu, any other tab → chats.
  useBackDismiss(tab === "requests", () => setTab("menu"));
  useBackDismiss(tab !== "chats" && tab !== "requests", () => setTab("chats"));

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

  const loadRequestsCount = useCallback(async () => {
    try {
      const res = await fetch("/api/messages/requests");
      if (res.ok) setRequestsCount((await res.json()).count ?? 0);
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    loadNotifCount();
    loadDmUnread();
    loadRequestsCount();
  }, [loadNotifCount, loadDmUnread, loadRequestsCount]);

  // Refresh badges on live events, debounced — a burst of messages should not
  // trigger a fetch per message.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  useEffect(() => {
    return subscribe((data) => {
      if (data.type !== "message" && data.type !== "notification" && data.type !== "reconnected") return;
      clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        loadNotifCount();
        loadDmUnread();
        loadRequestsCount();
      }, 800);
    });
  }, [subscribe, loadNotifCount, loadDmUnread, loadRequestsCount]);

  const badge = (t: BarKey): number =>
    t === "chats"
      ? dmUnread
      : t === "notifications"
      ? notifCount
      : t === "menu"
      ? requestsCount
      : 0;

  return (
    <div className="flex h-dvh flex-col text-white">
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              {chatTab === "dm" ? (
                <>
                  {/* Stories sit above the conversations, the way they do in a
                      real messenger — the Stories tab stays the full view. */}
                  <StoryRail myUsername={myUsername} />
                  <div className="mx-4 mb-1 border-t border-white/10" />
                  <MessengerClient meId={meId} onUnreadChange={setDmUnread} />
                </>
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
          <MenuTab
            myUsername={myUsername}
            myDisplayName={myDisplayName}
            myEmail={myEmail}
            isAdmin={isAdmin}
            showAppstore={showAppstore}
            requestsCount={requestsCount}
            onOpenRequests={() => setTab("requests")}
          />
        )}
        {tab === "requests" && (
          <RequestsView
            onBack={() => setTab("menu")}
            onChanged={() => {
              loadRequestsCount();
              loadDmUnread();
              loadNotifCount();
            }}
          />
        )}
      </div>

      {/* Bottom tab bar */}
      <nav className="flex shrink-0 border-t border-white/10 bg-black/40 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ key, label, icon: Icon }) => {
          const count = badge(key);
          // Chats and Channels share one view, so they light up on the inner
          // tab rather than on `tab` alone.
          const active =
            key === "channels"
              ? tab === "chats" && chatTab === "channels"
              : key === "chats"
                ? tab === "chats" && chatTab === "dm"
                : tab === key || (key === "menu" && tab === "requests");
          return (
            <button
              key={key}
              onClick={() => {
                if (key === "channels") {
                  setTab("chats");
                  setChatTab("channels");
                  return;
                }
                if (key === "chats") {
                  setTab("chats");
                  setChatTab("dm");
                  return;
                }
                setTab(key);
              }}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition",
                active ? "text-blue-400" : "text-white/50 hover:text-white/80"
              )}
            >
              <span className="relative">
                <Icon size={22} strokeWidth={active ? 2.4 : 2} />
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
