"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Suggestion {
  username: string;
  display_name: string | null;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  className?: string;
  wrapperClassName?: string;
  multiline?: boolean;
  rows?: number;
  disabled?: boolean;
  autoFocus?: boolean;
}

// Find the @mention token immediately before the caret (if any).
function activeMention(
  text: string,
  caret: number
): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|\s)@([\w.]{0,30})$/);
  if (!m) return null;
  return { query: m[1], start: caret - m[1].length - 1 };
}

export default function MentionInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  className,
  wrapperClassName,
  multiline,
  rows = 3,
  disabled,
  autoFocus,
}: MentionInputProps) {
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(0);

  const open = query !== null && suggestions.length > 0;

  // Re-evaluate the active mention token from the current caret position.
  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const am = activeMention(value, el.selectionStart ?? value.length);
    setQuery(am ? am.query : null);
  }, [value]);

  useEffect(() => {
    if (query === null) {
      setSuggestions([]);
      return;
    }
    let active = true;
    const t = setTimeout(() => {
      fetch(`/api/mention-suggestions?q=${encodeURIComponent(query)}`)
        .then((r) => (r.ok ? r.json() : { suggestions: [] }))
        .then((d) => {
          if (active) {
            setSuggestions(d.suggestions || []);
            setActive(0);
          }
        })
        .catch(() => active && setSuggestions([]));
    }, 120);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  const insert = (username: string) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? value.length;
    const am = activeMention(value, caret);
    if (!am) return;
    const next =
      value.slice(0, am.start) + "@" + username + " " + value.slice(caret);
    onChange(next);
    setQuery(null);
    const pos = am.start + username.length + 2;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(suggestions.length - 1, a + 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(0, a - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(suggestions[active].username);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setQuery(null);
        return;
      }
    }
    // Submit: Enter on single-line; Cmd/Ctrl+Enter on multiline.
    if (e.key === "Enter" && onSubmit) {
      if (!multiline && !e.shiftKey) {
        e.preventDefault();
        onSubmit();
      } else if (multiline && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSubmit();
      }
    }
  };

  const shared = {
    ref,
    value,
    placeholder,
    disabled,
    autoFocus,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onChange(e.target.value);
      // sync runs against the *new* value after state flush; do it on the event.
      const el = e.target;
      const am = activeMention(el.value, el.selectionStart ?? el.value.length);
      setQuery(am ? am.query : null);
    },
    onKeyUp: sync,
    onClick: sync,
    onBlur: () => setTimeout(() => setQuery(null), 150),
    onKeyDown,
    className,
  };

  return (
    <div className={cn("relative", wrapperClassName)}>
      {multiline ? (
        <textarea {...shared} rows={rows} />
      ) : (
        <input {...shared} type="text" />
      )}
      {open && (
        <ul
          className={cn(
            "absolute left-0 z-50 max-h-56 w-64 max-w-[80vw] overflow-y-auto rounded-xl border border-white/15 bg-[#1c1c1f] py-1 shadow-xl",
            multiline ? "top-full mt-1" : "bottom-full mb-1"
          )}
        >
          {suggestions.map((s, i) => (
            <li key={s.username}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  insert(s.username);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                  i === active ? "bg-white/10" : "hover:bg-white/5"
                )}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-semibold">
                  {s.username.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    @{s.username}
                  </span>
                  {s.display_name && (
                    <span className="block truncate text-xs text-white/40">
                      {s.display_name}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
