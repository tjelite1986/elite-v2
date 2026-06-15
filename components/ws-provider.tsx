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

    const connect = () => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`);
      wsRef.current = ws;

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
        if (!closed) reconnect = setTimeout(connect, 2000);
      };
      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          /* noop */
        }
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(reconnect);
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
