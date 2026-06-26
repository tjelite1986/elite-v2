"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Hash, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWs } from "@/components/ws-provider";
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
import { X } from "lucide-react";

interface Channel {
  id: number;
  name: string;
  description: string | null;
  member_count: number;
  is_member: number;
  unread: number;
  last_body: string | null;
  last_at: string | null;
}

interface ChannelMsg {
  id: number;
  channel_id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  reply: ReplyInfo | null;
  reactions: Reaction[];
}

function initials(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || name.slice(0, 2)).toUpperCase();
}

function formatTime(value: string): string {
  const d = new Date(value.replace(" ", "T") + "Z");
  if (isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default function ChannelsClient({ meId }: { meId: number }) {
  const { subscribe } = useWs();
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChannelMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [replyTo, setReplyTo] = useState<ChannelMsg | null>(null);
  const [editing, setEditing] = useState<ChannelMsg | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const selectedIdRef = useRef<number | null>(null);
  selectedIdRef.current = selectedId;

  useBackDismiss(selectedId !== null, () => setSelectedId(null));

  const loadChannels = useCallback(async () => {
    const res = await fetch("/api/channels");
    if (res.ok) setChannels((await res.json()).channels);
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    const res = await fetch(`/api/channels/${id}`);
    if (res.ok) {
      const data = await res.json();
      if (selectedIdRef.current === id) setMessages(data.messages);
    }
  }, []);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    if (selectedId) {
      loadMessages(selectedId);
      loadChannels();
    } else {
      setMessages([]);
    }
  }, [selectedId, loadMessages, loadChannels]);

  useEffect(() => {
    return subscribe((data) => {
      if (data.type === "channel_message") {
        if (data.channelId === selectedIdRef.current) {
          loadMessages(data.channelId as number);
        }
        loadChannels();
      }
    });
  }, [subscribe, loadMessages, loadChannels]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const body = input.trim();
    if (!body || !selectedId) return;
    setSending(true);
    try {
      if (editing) {
        const res = await fetch("/api/messages/edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "channel", messageId: editing.id, body }),
        });
        if (res.ok) {
          setInput("");
          setEditing(null);
          await loadMessages(selectedId);
        }
        return;
      }
      const res = await fetch(`/api/channels/${selectedId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, replyTo: replyTo?.id ?? null }),
      });
      if (res.ok) {
        setInput("");
        setReplyTo(null);
        await loadMessages(selectedId);
        loadChannels();
      }
    } finally {
      setSending(false);
    }
  };

  const react = async (messageId: number, emoji: string) => {
    await fetch("/api/messages/react", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "channel", messageId, emoji }),
    }).catch(() => {});
    if (selectedId) loadMessages(selectedId);
  };
  const remove = async (messageId: number) => {
    if (!confirm("Delete this message?")) return;
    await fetch("/api/messages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "channel", messageId }),
    }).catch(() => {});
    if (selectedId) loadMessages(selectedId);
  };
  const startEdit = (m: ChannelMsg) => {
    setReplyTo(null);
    setEditing(m);
    setInput(m.body);
  };

  const createChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    const res = await fetch("/api/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      const { channel } = await res.json();
      setNewName("");
      setCreating(false);
      await loadChannels();
      setSelectedId(channel.id);
    }
  };

  const selected = channels.find((c) => c.id === selectedId);

  return (
    <div className="flex h-full text-white">
      {/* Channel list */}
      <aside
        className={cn(
          "flex-col border-r border-white/10 overflow-y-auto",
          selectedId ? "hidden md:flex md:w-64" : "flex w-full md:w-64"
        )}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-lg font-semibold">Channels</span>
          <button
            onClick={() => setCreating((c) => !c)}
            className="rounded-md p-1 hover:bg-white/10"
            aria-label="New channel"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>

        {creating && (
          <form onSubmit={createChannel} className="px-4 pb-3">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Channel name"
              className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-white/20"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                className="rounded-full bg-blue-600 px-3 py-1.5 text-xs font-medium hover:bg-blue-500"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-full bg-white/10 px-3 py-1.5 text-xs hover:bg-white/20"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {channels.length === 0 && !creating && (
          <div className="px-4 py-6 text-sm text-white/40">
            No channels yet. Create one.
          </div>
        )}
        {channels.map((c) => (
          <button
            key={c.id}
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/5",
              selectedId === c.id && "bg-white/10"
            )}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Hash className="h-4 w-4 text-white/60" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium">{c.name}</span>
                {c.is_member > 0 && c.unread > 0 && (
                  <span className="ml-1 rounded-full bg-blue-500 px-2 py-0.5 text-xs font-semibold">
                    {c.unread}
                  </span>
                )}
              </span>
              <span className="block truncate text-xs text-white/50">
                {c.last_body || `${c.member_count} member${c.member_count === 1 ? "" : "s"}`}
              </span>
            </span>
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
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
              <button
                onClick={() => setSelectedId(null)}
                className="md:hidden rounded-md p-1 hover:bg-white/10"
                aria-label="Back to channels"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <Hash className="h-5 w-5 text-white/60" />
              <div className="min-w-0">
                <div className="truncate font-medium">{selected.name}</div>
                <div className="text-xs text-white/40">
                  {selected.member_count} member
                  {selected.member_count === 1 ? "" : "s"}
                </div>
              </div>
            </header>

            <div className="flex flex-1 flex-col overflow-y-auto px-4 py-3 sm:px-6">
              <div className="flex min-h-full flex-col justify-end">
                {messages.length === 0 && (
                  <div className="mt-8 text-center text-sm text-white/40">
                    No messages yet. Say hello.
                  </div>
                )}
                {messages.map((m, i) => {
                  const mine = m.sender_id === meId;
                  const prev = messages[i - 1];
                  const firstOfGroup = !prev || prev.sender_id !== m.sender_id;
                  const deleted = Boolean(m.deleted_at);
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        "group flex items-end gap-1.5",
                        mine ? "justify-end" : "justify-start",
                        firstOfGroup ? "mt-3" : "mt-0.5"
                      )}
                    >
                      {!mine && (
                        <span
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[11px] font-semibold",
                            firstOfGroup ? "visible" : "invisible"
                          )}
                        >
                          {initials(m.sender_name)}
                        </span>
                      )}
                      {mine && !deleted && (
                        <MessageMenu
                          mine
                          align="right"
                          onReact={(e) => react(m.id, e)}
                          onReply={() => {
                            setEditing(null);
                            setReplyTo(m);
                          }}
                          onEdit={() => startEdit(m)}
                          onDelete={() => remove(m.id)}
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
                            mine ? "bg-blue-600 text-white" : "bg-white/10 text-white"
                          )}
                        >
                          {!mine && firstOfGroup && (
                            <div className="mb-0.5 text-xs font-medium text-white/50">
                              {m.sender_name}
                            </div>
                          )}
                          {m.reply && <ReplyQuote reply={m.reply} />}
                          {deleted ? (
                            <div className="italic text-white/40">
                              Message deleted
                            </div>
                          ) : (
                            <>
                              <div className="whitespace-pre-wrap break-words">
                                <LinkifyText text={m.body} />
                                {m.edited_at && (
                                  <span className="ml-1 text-[10px] text-white/40">
                                    (edited)
                                  </span>
                                )}
                              </div>
                              {firstUrl(m.body) && (
                                <LinkPreview url={firstUrl(m.body)!} />
                              )}
                            </>
                          )}
                        </div>
                        {!deleted && (
                          <ReactionChips
                            reactions={m.reactions}
                            onToggle={(e) => react(m.id, e)}
                            align={mine ? "end" : "start"}
                          />
                        )}
                      </div>
                      {!mine && !deleted && (
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
                  );
                })}
                <div ref={bottomRef} />
              </div>
            </div>

            {(replyTo || editing) && (
              <div className="flex items-center gap-2 border-t border-white/10 bg-white/5 px-4 py-2 text-xs sm:px-6">
                <span className="font-medium text-white/60">
                  {editing ? "Editing message" : `Replying to ${replyTo?.sender_name}`}
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
            <form
              onSubmit={send}
              className="flex items-center gap-3 border-t border-white/10 px-4 py-4 sm:px-6"
            >
              <MentionInput
                value={input}
                onChange={setInput}
                onSubmit={() => send()}
                placeholder={
                  editing ? "Edit message…" : `Message #${selected.name}`
                }
                wrapperClassName="flex-1"
                className="w-full rounded-full bg-white/10 px-5 py-3 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="rounded-full bg-blue-600 px-6 py-3 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-white/40">
            Select a channel to start chatting.
          </div>
        )}
      </section>
    </div>
  );
}
