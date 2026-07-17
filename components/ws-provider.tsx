"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

type WsEvent = { type: string; [key: string]: unknown };
type Listener = (event: WsEvent) => void;

interface WsContextValue {
  /** Set of user ids currently connected anywhere in the app. */
  onlineIds: Set<number>;
  /** Send a JSON payload over the socket (no-op if not open). */
  send: (obj: unknown) => void;
  /** Subscribe to raw incoming events; returns an unsubscribe fn. */
  subscribe: (fn: Listener) => () => void;
}

const WsContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error("useWs must be used within WebSocketProvider");
  return ctx;
}

/**
 * App-wide WebSocket connection. Mounted in the (authed) layout so presence is
 * active on every page (not just the messenger). Tracks online users centrally
 * and fans out all events to subscribers (e.g. the messenger).
 */
export default function WebSocketProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [onlineIds, setOnlineIds] = useState<Set<number>>(new Set());
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<Listener>>(new Set());

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }, []);

  const subscribe = useCallback((fn: Listener) => {
    listenersRef.current.add(fn);
    return () => {
      listenersRef.current.delete(fn);
    };
  }, []);

  useEffect(() => {
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout>;
    let attempts = 0;
    let hadConnection = false;

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        attempts = 0;
        // Anything sent while we were away is lost (the server does not queue),
        // so tell subscribers to refetch their world after a reconnect.
        if (hadConnection) {
          listenersRef.current.forEach((fn) => fn({ type: "reconnected" }));
        }
        hadConnection = true;
      };

      ws.onmessage = (ev) => {
        let data: WsEvent;
        try {
          data = JSON.parse(ev.data);
        } catch {
          return;
        }

        // Presence is tracked centrally.
        if (data.type === "presence_list") {
          setOnlineIds(new Set<number>(data.online as number[]));
        } else if (data.type === "presence") {
          setOnlineIds((prev) => {
            const next = new Set(prev);
            if (data.online) next.add(data.userId as number);
            else next.delete(data.userId as number);
            return next;
          });
        }

        // Fan out every event to subscribers (messages, typing, presence...).
        listenersRef.current.forEach((fn) => fn(data));
      };

      ws.onclose = () => {
        // Exponential backoff with jitter (1s → 30s cap) — a down server is
        // not hammered, a blip recovers fast.
        if (!closed) {
          const delay =
            Math.min(30_000, 1000 * 2 ** Math.min(attempts, 5)) *
            (0.5 + Math.random() * 0.5);
          attempts++;
          reconnect = setTimeout(connect, delay);
        }
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    };

    // Mobile browsers kill background sockets; when the tab comes back (or the
    // network returns) reconnect immediately instead of waiting out a backoff.
    const retryNow = () => {
      if (closed) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        clearTimeout(reconnect);
        attempts = 0;
        connect();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retryNow();
    };
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", onVisible);

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnect);
      window.removeEventListener("online", retryNow);
      document.removeEventListener("visibilitychange", onVisible);
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
    };
  }, []);

  return (
    <WsContext.Provider value={{ onlineIds, send, subscribe }}>
      {children}
    </WsContext.Provider>
  );
}
