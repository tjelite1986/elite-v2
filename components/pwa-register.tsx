"use client";

import { useEffect } from "react";

// Registers the service worker (image caching + web push) and keeps installed
// PWAs fresh: Android resumes a suspended app instance instead of reloading,
// so without a check the app can keep running week-old code after a deploy.
// On launch we remember the build id; whenever the app becomes visible again
// we re-fetch it and hard-reload if the server has been redeployed.
// Rendered once in the root layout. No UI.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failures are non-fatal */
      });
    // Defer until after load so it never competes with first paint.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  useEffect(() => {
    let knownBuild: string | null = null;
    let lastCheck = 0;

    const check = async () => {
      const now = Date.now();
      if (now - lastCheck < 60_000) return;
      lastCheck = now;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const build = (await res.json()).build as string | undefined;
        if (!build) return;
        if (knownBuild === null) knownBuild = build;
        else if (build !== knownBuild) window.location.reload();
      } catch {
        /* offline or transient — try again on the next resume */
      }
    };

    check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
