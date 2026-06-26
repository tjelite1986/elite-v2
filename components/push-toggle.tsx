"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, Loader2 } from "lucide-react";

// Convert a base64url VAPID key to the Uint8Array the Push API expects.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

type State = "loading" | "unsupported" | "off" | "on" | "denied" | "busy";

export default function PushToggle() {
  const [state, setState] = useState<State>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setState("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setState("denied");
      return;
    }
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setState(sub ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);

  const enable = async () => {
    setError(null);
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const { key } = await fetch("/api/push/vapid").then((r) => r.json());
      if (!key) {
        setError("Push is not configured on the server.");
        setState("off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub }),
      });
      if (!res.ok) throw new Error("save failed");
      setState("on");
    } catch {
      setError("Could not enable notifications.");
      setState("off");
    }
  };

  const disable = async () => {
    setError(null);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setState("off");
    } catch {
      setState("on");
    }
  };

  return (
    <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium">Push notifications</h2>
          <p className="mt-1 max-w-md text-sm text-white/50">
            Get notified about new messages, likes, comments and follows even
            when Elite is closed. Install Elite to your home screen for the best
            experience.
          </p>
          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
          {state === "denied" && (
            <p className="mt-2 text-sm text-amber-400">
              Notifications are blocked in your browser settings for this site.
            </p>
          )}
          {state === "unsupported" && (
            <p className="mt-2 text-sm text-white/40">
              This browser doesn&apos;t support push notifications.
            </p>
          )}
        </div>
        {(state === "on" || state === "off" || state === "busy") && (
          <button
            onClick={state === "on" ? disable : enable}
            disabled={state === "busy"}
            className="inline-flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-5 py-3 text-sm font-medium transition hover:bg-white/25 disabled:opacity-50"
          >
            {state === "busy" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : state === "on" ? (
              <BellOff className="h-4 w-4" />
            ) : (
              <Bell className="h-4 w-4" />
            )}
            {state === "on" ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
    </div>
  );
}
