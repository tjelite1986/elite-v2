"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "elite.installDismissed";

// PWA install banner. Chrome only volunteers its own install prompt after
// opaque engagement heuristics, which leaves the install path buried in the
// three-dot menu on a fresh visit; capturing beforeinstallprompt lets us offer
// it immediately. Hidden while running standalone, after install, or once
// dismissed (persisted).
export default function InstallBanner() {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {}
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as { standalone?: boolean }).standalone);
    if (dismissed || standalone) return;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!evt) return null;

  const install = async () => {
    evt.prompt();
    await evt.userChoice.catch(() => {});
    setEvt(null);
  };

  const dismiss = () => {
    setEvt(null);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
  };

  return (
    <div
      className="fixed inset-x-4 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-white/10 bg-neutral-900/95 p-3 shadow-lg backdrop-blur"
      style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom) + 0.75rem)" }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/icon-192.png" alt="" className="h-10 w-10 rounded-xl" />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-white">Install Elite</div>
        <div className="text-xs text-white/60">
          Get the app on your home screen
        </div>
      </div>
      <button
        type="button"
        onClick={install}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        className="p-1 text-white/50"
        aria-label="Dismiss"
      >
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}
