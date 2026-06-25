"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { UserCog, LogOut, Loader2 } from "lucide-react";

interface Account {
  id: number;
  email: string;
  username: string | null;
}

// Admin "act-as" controls: a small account switcher (shown to a real admin, or
// to an admin already impersonating so they can hop public@ <-> adults@) plus a
// fixed bottom banner while impersonating, with a "Return to admin" button.
export default function ActAsControls({
  imp,
  actingAsEmail,
  isRealAdmin,
}: {
  imp: { email: string } | null;
  actingAsEmail: string;
  isRealAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);

  const canSwitch = isRealAdmin || !!imp;

  // The banner is portalled to <body> so its `position: fixed` is relative to the
  // viewport. The top-nav wrapper has a CSS transform (-translate-x-1/2), which
  // would otherwise make `fixed` resolve against that small bar and overlap the
  // menu instead of sitting at the screen bottom.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open || accounts.length) return;
    fetch("/api/admin/act-as")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => {
        /* transient */
      });
  }, [open, accounts.length]);

  const actAs = async (email: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/act-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        setOpen(false);
        router.push("/");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const returnToAdmin = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/auth/return-to-admin", { method: "POST" });
      if (r.ok) {
        router.push("/");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {canSwitch && (
        <div className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            title="Switch account (act as)"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <UserCog size={16} />
          </button>
          {open && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setOpen(false)}
              />
              <div className="absolute right-0 top-9 z-50 w-56 overflow-hidden rounded-xl border border-white/10 bg-[#1c1c22] py-1 text-sm shadow-xl">
                <p className="px-3 py-1.5 text-[11px] uppercase tracking-wide text-white/40">
                  Act as
                </p>
                {accounts.length === 0 && (
                  <p className="px-3 py-1.5 text-white/40">No accounts</p>
                )}
                {accounts.map((a) => {
                  const isCurrent = a.email === actingAsEmail;
                  return (
                    <button
                      key={a.id}
                      disabled={busy || isCurrent}
                      onClick={() => actAs(a.email)}
                      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-white/80 transition hover:bg-white/10 disabled:opacity-40"
                    >
                      <span className="truncate">{a.email}</span>
                      {isCurrent && (
                        <span className="ml-2 text-[10px] text-emerald-300">
                          current
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {imp &&
        mounted &&
        createPortal(
          <div className="fixed inset-x-0 bottom-0 z-[100] flex items-center justify-center gap-3 border-t border-amber-400/30 bg-amber-500/90 px-4 py-2 text-xs text-black backdrop-blur">
            <span>
              Acting as <span className="font-semibold">{actingAsEmail}</span>
            </span>
            <button
              onClick={returnToAdmin}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full bg-black/85 px-3 py-1 font-semibold text-amber-100 transition hover:bg-black disabled:opacity-50"
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <LogOut size={13} />
              )}
              Return to admin
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
