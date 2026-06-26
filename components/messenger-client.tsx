"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  PanelLeft,
  Library,
  X,
  ChevronLeft,
  ChevronRight,
  Play,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";
import LinkifyText, { firstUrl } from "@/components/linkify-text";
import LinkPreview from "@/components/link-preview";
import MentionInput from "@/components/mention-input";
import {
  MessageMenu,
  ReactionChips,
  ReplyQuote,
  type Reaction,
  type ReplyInfo,
} from "@/components/message-extras";
import { useWs } from "@/components/ws-provider";

interface ConversationUser {
  id: number;
  email: string;
  last_seen: string | null;
  last_body: string | null;
  last_attachment: string | null;
  last_at: string | null;
  unread: number;
}

interface Message {
  id: number;
  sender_id: number;
  recipient_id: number;
  body: string;
  attachment_type: string | null;
  attachment_data: string | null;
  created_at: string;
  read_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  reply: ReplyInfo | null;
  reactions: Reaction[];
}

interface Attachment {
  ids: number[];
  album_name?: string;
}

interface ShortAttachment {
  id: number;
  channel: string;
  caption: string | null;
  has_poster: boolean;
}

function parseAttachment(m: Message): Attachment | null {
  if (!m.attachment_type || !m.attachment_data) return null;
  try {
    const d = JSON.parse(m.attachment_data);
    if (Array.isArray(d.ids) && d.ids.length > 0) return d;
  } catch {
    /* ignore */
  }
  return null;
}

function parseShortAttachment(m: Message): ShortAttachment | null {
  if (m.attachment_type !== "short" || !m.attachment_data) return null;
  try {
    const d = JSON.parse(m.attachment_data);
    if (typeof d.id === "number") return d as ShortAttachment;
  } catch {
    /* ignore */
  }
  return null;
}

interface MessengerClientProps {
  meId: number;
}

function getInitials(email: string): string {
  const local = email.split("@")[0] || email;
  const letters = local.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || local.slice(0, 2)).toUpperCase();
}

function formatTime(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function msOf(value: string): number {
  return new Date(value.replace(" ", "T") + "Z").getTime();
}

// Centered, faint timestamp shown above the first message of a group that
// starts after a long pause — like Messenger. Time only for today, date + time
// otherwise.
function formatStamp(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return time;
  return `${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}, ${time}`;
}

function formatLastSeen(value: string | null): string {
  if (!value) return "Offline";
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "Offline";
  const now = new Date();
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  if (d.toDateString() === now.toDateString()) return `Last seen ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString())
    return `Last seen yesterday ${time}`;
  return `Last seen ${d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })}`;
}

function Avatar({ email, online }: { email: string; online?: boolean }) {
  return (
    <div className="relative shrink-0">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-semibold">
        {getInitials(email)}
      </div>
      {online && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#121212] bg-green-500" />
      )}
    </div>
  );
}

export default function MessengerClient({ meId }: MessengerClientProps) {
  const { onlineIds, send, subscribe } = useWs();
  const [users, setUsers] = useState<ConversationUser[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [typingFrom, setTypingFrom] = useState<number | null>(null);
  const [viewer, setViewer] = useState<{ ids: number[]; index: number } | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);

  // Device Back closes the media viewer first, then the open conversation
  // (back to the list), instead of leaving /messages for the dashboard.
  useBackDismiss(selectedId !== null, () => setSelectedId(null));
  useBackDismiss(viewer !== null, () => setViewer(null));

  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  const typingSentRef = useRef(0);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const typingClearRef = useRef<ReturnType<typeof setTimeout>>();

  const loadUsers = useCallback(async () => {
    const res = await fetch("/api/messages/users");
    if (res.ok) setUsers((await res.json()).users);
  }, []);

  const loadConversation = useCallback(async (otherId: number) => {
    const res = await fetch(`/api/messages/${otherId}`);
    if (res.ok) {
      const data = await res.json();
      if (selectedIdRef.current === otherId) setMessages(data.messages);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // React to events from the shared WebSocket (presence is handled centrally
  // in the provider; here we handle messages and typing).
  useEffect(() => {
    return subscribe((data) => {
      if (data.type === "message") {
        const m = data.message as Message;
        const sel = selectedIdRef.current;
        if (sel !== null && (m.sender_id === sel || m.recipient_id === sel)) {
          loadConversation(sel);
          if (m.sender_id === sel) setTypingFrom(null);
        }
        loadUsers();
      } else if (data.type === "presence" && !data.online) {
        loadUsers(); // refresh last_seen when someone goes offline
      } else if (data.type === "typing") {
        if (data.from === selectedIdRef.current) {
          setTypingFrom(data.from as number);
          clearTimeout(typingClearRef.current);
          typingClearRef.current = setTimeout(() => setTypingFrom(null), 4000);
        }
      } else if (data.type === "stop_typing") {
        if (data.from === selectedIdRef.current) setTypingFrom(null);
      }
    });
  }, [subscribe, loadConversation, loadUsers]);

  useEffect(() => {
    setTypingFrom(null);
    if (selectedId) {
      loadConversation(selectedId);
      loadUsers();
    } else {
      setMessages([]);
    }
  }, [selectedId, loadConversation, loadUsers]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingFrom]);

  // Keyboard nav for the shared-media viewer.
  useEffect(() => {
    if (!viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      else if (e.key === "ArrowLeft")
        setViewer((v) => (v && v.index > 0 ? { ...v, index: v.index - 1 } : v));
      else if (e.key === "ArrowRight")
        setViewer((v) =>
          v && v.index < v.ids.length - 1 ? { ...v, index: v.index + 1 } : v
        );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewer]);

  const sendTyping = (type: "typing" | "stop_typing") => {
    if (!selectedId) return;
    send({ type, to: selectedId });
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (!selectedId) return;
    const now = Date.now();
    if (value && now - typingSentRef.current > 2000) {
      sendTyping("typing");
      typingSentRef.current = now;
    }
    clearTimeout(stopTimerRef.current);
    stopTimerRef.current = setTimeout(() => {
      sendTyping("stop_typing");
      typingSentRef.current = 0;
    }, 2500);
  };

  const send_ = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = input.trim();
    if (!body || !selectedId) return;
    setSending(true);
    clearTimeout(stopTimerRef.current);
    sendTyping("stop_typing");
    typingSentRef.current = 0;
    try {
      if (editing) {
        const res = await fetch("/api/messages/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "dm", messageId: editing.id, body }),
        });
        if (res.ok) {
          setInput("");
          setEditing(null);
          await loadConversation(selectedId);
        }
        return;
      }
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientId: selectedId,
          body,
          replyTo: replyTo?.id ?? null,
        }),
      });
      if (res.ok) {
        setInput("");
        setReplyTo(null);
        await loadConversation(selectedId);
        loadUsers();
      }
    } finally {
      setSending(false);
    }
  };

  const react = async (messageId: number, emoji: string) => {
    await fetch("/api/messages/react", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "dm", messageId, emoji }),
    }).catch(() => {});
    if (selectedId) loadConversation(selectedId);
  };
  const removeMessage = async (messageId: number) => {
    if (!confirm("Delete this message?")) return;
    await fetch("/api/messages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "dm", messageId }),
    }).catch(() => {});
    if (selectedId) loadConversation(selectedId);
  };
  const startEdit = (m: Message) => {
    setReplyTo(null);
    setEditing(m);
    setInput(m.body);
  };

  const selectedUser = users.find((u) => u.id === selectedId);
  const selectedOnline = selectedId !== null && onlineIds.has(selectedId);

  return (
    <div className="flex h-full text-white">
      {/* Conversation list */}
      <aside
        className={cn(
          "flex-col border-r border-white/10 overflow-y-auto",
          selectedId ? "hidden" : "flex w-full",
          collapsed ? "md:hidden" : "md:flex md:w-60"
        )}
      >
        <div className="px-4 py-4 text-lg font-semibold">Messages</div>
        {users.length === 0 && (
          <div className="px-4 py-6 text-sm text-white/40">
            No other users yet.
          </div>
        )}
        {users.map((u) => (
          <button
            key={u.id}
            onClick={() => setSelectedId(u.id)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5",
              selectedId === u.id && "bg-white/10"
            )}
          >
            <Avatar email={u.email} online={onlineIds.has(u.id)} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span data-pii className="truncate text-sm font-medium">
                  {u.email.split("@")[0]}
                </span>
                {u.unread > 0 && (
                  <span className="ml-1 rounded-full bg-blue-500 px-2 py-0.5 text-xs font-semibold">
                    {u.unread}
                  </span>
                )}
              </div>
              <div className="truncate text-xs text-white/50">
                {u.last_body ||
                  (u.last_attachment === "album"
                    ? "Shared an album"
                    : u.last_attachment === "photos"
                    ? "Shared photos"
                    : "No messages yet")}
              </div>
            </div>
          </button>
        ))}
      </aside>

      {/* Conversation pane */}
      <section
        className={cn(
          "min-w-0 flex-1 flex-col",
          selectedId ? "flex" : "hidden md:flex"
        )}
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          {selectedId && (
            <button
              onClick={() => setSelectedId(null)}
              className="md:hidden rounded-md p-1 hover:bg-white/10"
              aria-label="Back to conversations"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="hidden md:inline-flex rounded-md p-1 hover:bg-white/10"
            aria-label="Toggle conversation list"
          >
            <PanelLeft className="h-5 w-5" />
          </button>

          {selectedUser ? (
            <div className="flex items-center gap-3">
              <Avatar email={selectedUser.email} online={selectedOnline} />
              <div className="min-w-0">
                <div data-pii className="truncate font-medium">{selectedUser.email}</div>
                <div className="text-xs">
                  {typingFrom === selectedId ? (
                    <span className="text-green-400">typing…</span>
                  ) : selectedOnline ? (
                    <span className="text-green-400">Online</span>
                  ) : (
                    <span className="text-white/40">
                      {formatLastSeen(selectedUser.last_seen)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <span className="text-white/50">Messages</span>
          )}
        </header>

        <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-6">
          {/* Anchor messages to the bottom and grow upward (Messenger-style). */}
          <div className="flex min-h-full flex-col justify-end">
          {!selectedUser && (
            <div className="flex h-full items-center justify-center text-white/40">
              Select a conversation to start chatting.
            </div>
          )}
          {selectedUser && messages.length === 0 && typingFrom !== selectedId && (
            <div className="mt-8 text-center text-sm text-white/40">
              No messages yet. Say hello.
            </div>
          )}
          {selectedUser &&
            messages.map((m, i) => {
              const mine = m.sender_id === meId;
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const GAP = 5 * 60 * 1000; // group messages sent within 5 min
              const firstOfGroup =
                !prev ||
                prev.sender_id !== m.sender_id ||
                msOf(m.created_at) - msOf(prev.created_at) > GAP;
              const lastOfGroup =
                !next ||
                next.sender_id !== m.sender_id ||
                msOf(next.created_at) - msOf(m.created_at) > GAP;
              // Faint centered timestamp when a new group starts after >1h.
              const showStamp =
                firstOfGroup &&
                (!prev ||
                  msOf(m.created_at) - msOf(prev.created_at) > 60 * 60 * 1000);
              const att = parseAttachment(m);
              const shortAtt = parseShortAttachment(m);
              return (
                <div key={m.id}>
                  {showStamp && (
                    <div className="py-2 text-center text-[11px] text-white/30">
                      {formatStamp(m.created_at)}
                    </div>
                  )}
                  <div
                    className={cn(
                      "group flex items-end gap-1.5",
                      mine ? "justify-end" : "justify-start",
                      firstOfGroup && !showStamp ? "mt-3" : "mt-0.5"
                    )}
                  >
                    {!mine &&
                      (lastOfGroup ? (
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[11px] font-semibold">
                          {getInitials(selectedUser.email)}
                        </span>
                      ) : (
                        <span className="h-7 w-7 shrink-0" />
                      ))}
                    {mine && !m.deleted_at && (
                      <MessageMenu
                        mine
                        align="right"
                        onReact={(e) => react(m.id, e)}
                        onReply={() => {
                          setEditing(null);
                          setReplyTo(m);
                        }}
                        onEdit={() => startEdit(m)}
                        onDelete={() => removeMessage(m.id)}
                      />
                    )}
                    <div
                      className={cn(
                        "flex max-w-[80%] flex-col sm:max-w-[65%]",
                        mine ? "items-end" : "items-start"
                      )}
                    >
                    <div
                      title={formatTime(m.created_at)}
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm",
                        mine
                          ? cn(
                              "bg-blue-600 text-white",
                              !firstOfGroup && "rounded-tr-md",
                              !lastOfGroup && "rounded-br-md"
                            )
                          : cn(
                              "bg-white/10 text-white",
                              !firstOfGroup && "rounded-tl-md",
                              !lastOfGroup && "rounded-bl-md"
                            )
                      )}
                    >
                    {m.reply && <ReplyQuote reply={m.reply} />}
                    {m.deleted_at ? (
                      <div className="italic text-white/40">Message deleted</div>
                    ) : (
                      <>
                    {m.body && (
                      <div className="whitespace-pre-wrap break-words">
                        <LinkifyText text={m.body} />
                      </div>
                    )}
                    {m.body && firstUrl(m.body) && (
                      <LinkPreview url={firstUrl(m.body)!} />
                    )}

                    {att && m.attachment_type === "album" && (
                      <button
                        onClick={() => setViewer({ ids: att.ids, index: 0 })}
                        className="mt-1 flex items-center gap-3 rounded-xl bg-black/20 p-2 text-left transition hover:bg-black/30"
                      >
                        <span className="size-14 shrink-0 overflow-hidden rounded-lg bg-white/10">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`/api/gallery/${att.ids[0]}/media?variant=thumb`}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Library size={14} /> {att.album_name || "Album"}
                          </span>
                          <span className="text-xs opacity-70">
                            {att.ids.length} photo{att.ids.length === 1 ? "" : "s"}
                          </span>
                        </span>
                      </button>
                    )}

                    {att && m.attachment_type === "photos" && (
                      <div
                        className={cn(
                          "mt-1 grid gap-1",
                          att.ids.length === 1 ? "grid-cols-1" : "grid-cols-3"
                        )}
                      >
                        {att.ids.slice(0, 9).map((id, i) => (
                          <button
                            key={id}
                            onClick={() => setViewer({ ids: att.ids, index: i })}
                            className={cn(
                              "relative overflow-hidden rounded-lg bg-white/10",
                              att.ids.length === 1 ? "h-44 w-44 max-w-full" : "aspect-square"
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/gallery/${id}/media?variant=thumb`}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                            {i === 8 && att.ids.length > 9 && (
                              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-sm font-semibold">
                                +{att.ids.length - 9}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    {shortAtt && (
                      <a
                        href={`/shorts${shortAtt.channel === "18plus" ? "/18" : ""}?focus=${shortAtt.id}`}
                        className="mt-1 flex items-center gap-3 rounded-xl bg-black/20 p-2 text-left transition hover:bg-black/30"
                      >
                        <span className="relative size-14 shrink-0 overflow-hidden rounded-lg bg-white/10">
                          {shortAtt.has_poster && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={`/api/shorts/${shortAtt.id}/poster`}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          )}
                          <span className="absolute inset-0 flex items-center justify-center">
                            <Play size={18} className="drop-shadow" />
                          </span>
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5 font-medium">
                            <Play size={14} /> Short
                          </span>
                          <span className="block max-w-[180px] truncate text-xs opacity-70">
                            {shortAtt.caption || "Watch clip"}
                          </span>
                        </span>
                      </a>
                    )}

                    {m.edited_at && (
                      <span className="mt-0.5 block text-[10px] text-white/40">
                        (edited)
                      </span>
                    )}
                      </>
                    )}
                    </div>
                    {!m.deleted_at && (
                      <ReactionChips
                        reactions={m.reactions}
                        onToggle={(e) => react(m.id, e)}
                        align={mine ? "end" : "start"}
                      />
                    )}
                    </div>
                    {!mine && !m.deleted_at && (
                      <MessageMenu
                        mine={false}
                        align="left"
                        onReact={(e) => react(m.id, e)}
                        onReply={() => {
                          setEditing(null);
                          setReplyTo(m);
                        }}
                        onEdit={() => {}}
                        onDelete={() => {}}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          {selectedUser && typingFrom === selectedId && (
            <div className="mt-3 flex items-end justify-start gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[11px] font-semibold">
                {getInitials(selectedUser.email)}
              </span>
              <div className="flex items-center gap-1 rounded-2xl bg-white/10 px-4 py-3">
                <span className="h-2 w-2 animate-bounce rounded-full bg-white/60 [animation-delay:-0.3s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-white/60 [animation-delay:-0.15s]" />
                <span className="h-2 w-2 animate-bounce rounded-full bg-white/60" />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
          </div>
        </div>

        {selectedUser && (replyTo || editing) && (
          <div className="flex items-center gap-2 border-t border-white/10 bg-white/5 px-4 py-2 text-xs sm:px-6">
            <span className="font-medium text-white/60">
              {editing ? "Editing message" : "Replying"}
            </span>
            <span className="min-w-0 flex-1 truncate text-white/40">
              {(editing ?? replyTo)?.body}
            </span>
            <button
              onClick={() => {
                setReplyTo(null);
                if (editing) {
                  setEditing(null);
                  setInput("");
                }
              }}
              className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white"
              aria-label="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        )}
        {selectedUser && (
          <form
            onSubmit={send_}
            className="flex items-center gap-3 border-t border-white/10 px-4 py-4 sm:px-6"
          >
            <MentionInput
              value={input}
              onChange={handleInputChange}
              onSubmit={() => send_()}
              placeholder={editing ? "Edit message…" : "Type a message..."}
              wrapperClassName="flex-1"
              className="w-full rounded-full bg-white/10 px-5 py-3 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded-full bg-blue-600 px-6 py-3 text-sm font-medium hover:bg-blue-500 transition disabled:opacity-50"
            >
              Send
            </button>
          </form>
        )}
      </section>

      {/* Shared-media viewer */}
      {viewer && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/95">
          <button
            onClick={() => setViewer(null)}
            className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            aria-label="Close"
          >
            <X size={20} />
          </button>
          {viewer.index > 0 && (
            <button
              onClick={() =>
                setViewer((v) => (v ? { ...v, index: v.index - 1 } : v))
              }
              className="absolute left-3 flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Previous"
            >
              <ChevronLeft size={24} />
            </button>
          )}
          {viewer.index < viewer.ids.length - 1 && (
            <button
              onClick={() =>
                setViewer((v) => (v ? { ...v, index: v.index + 1 } : v))
              }
              className="absolute right-3 flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label="Next"
            >
              <ChevronRight size={24} />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/gallery/${viewer.ids[viewer.index]}/media?variant=preview`}
            alt=""
            className="max-h-[90vh] max-w-[90vw] object-contain"
          />
          {viewer.ids.length > 1 && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
              {viewer.index + 1} / {viewer.ids.length}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
