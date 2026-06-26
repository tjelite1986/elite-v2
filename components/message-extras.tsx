"use client";

import { useState } from "react";
import { MoreHorizontal, Reply, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBackDismiss } from "@/lib/use-back-dismiss";

export const QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

export interface Reaction {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface ReplyInfo {
  id: number;
  sender_id: number;
  sender_name: string;
  body: string;
  deleted: boolean;
}

export function ReactionChips({
  reactions,
  onToggle,
  align,
}: {
  reactions: Reaction[];
  onToggle: (emoji: string) => void;
  align: "start" | "end";
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap gap-1",
        align === "end" ? "justify-end" : "justify-start"
      )}
    >
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle(r.emoji)}
          className={cn(
            "flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs ring-1 transition",
            r.mine
              ? "bg-blue-500/25 ring-blue-400/40"
              : "bg-white/10 ring-white/10 hover:bg-white/15"
          )}
        >
          <span>{r.emoji}</span>
          <span className="text-white/70">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

export function ReplyQuote({ reply }: { reply: ReplyInfo }) {
  return (
    <div className="mb-1 rounded-md border-l-2 border-white/40 bg-black/20 px-2 py-1 text-xs">
      <div className="font-medium opacity-80">{reply.sender_name}</div>
      <div className="truncate opacity-60">
        {reply.deleted ? "Deleted message" : reply.body}
      </div>
    </div>
  );
}

// Per-message "⋯" action menu: quick reactions + Reply, plus Edit/Delete on own.
export function MessageMenu({
  mine,
  align,
  onReact,
  onReply,
  onEdit,
  onDelete,
}: {
  mine: boolean;
  align: "left" | "right";
  onReact: (emoji: string) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  useBackDismiss(open, () => setOpen(false));
  const act = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative self-center">
      <button
        onClick={() => setOpen((v) => !v)}
        className="rounded-full p-1 text-white/40 opacity-100 transition hover:bg-white/10 hover:text-white sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Message actions"
      >
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={cn(
              "absolute bottom-full z-50 mb-1 w-44 rounded-xl border border-white/10 bg-[#1c1c1f] p-1 shadow-xl",
              align === "right" ? "right-0" : "left-0"
            )}
          >
            <div className="flex justify-between px-1 pb-1">
              {QUICK_EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => act(() => onReact(e))}
                  className="rounded p-1 text-base leading-none transition hover:bg-white/10"
                >
                  {e}
                </button>
              ))}
            </div>
            <MenuItem icon={<Reply size={14} />} label="Reply" onClick={() => act(onReply)} />
            {mine && (
              <MenuItem icon={<Pencil size={14} />} label="Edit" onClick={() => act(onEdit)} />
            )}
            {mine && (
              <MenuItem
                icon={<Trash2 size={14} />}
                label="Delete"
                danger
                onClick={() => act(onDelete)}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition hover:bg-white/10",
        danger ? "text-red-300" : "text-white/80"
      )}
    >
      {icon}
      {label}
    </button>
  );
}
