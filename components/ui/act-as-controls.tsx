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

// Admin "act-as" impersonation UI, split in two pieces since the top nav was
// removed: ActAsBanner is always mounted in the authed layout (the fixed
// banner with "Return to admin" while impersonating), and ActAsMenuSection is
// the account switcher rendered inside the global menu sheet.

export function ActAsBanner({
  imp,
  actingAsEmail,
}: {
  imp: { email: string } | null;
  actingAsEmail: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Portalled to <body> so `position: fixed` resolves against the viewport
  // regardless of transformed ancestors.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

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

  if (!imp || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-x-0 z-[100] flex items-center justify-center gap-3 border-t border-amber-400/30 bg-amber-500/90 px-4 py-2 text-xs text-black backdrop-blur"
      style={{ bottom: "var(--fab-offset, 0px)" }}
    >
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
  );
}

export function ActAsMenuSection({
  actingAsEmail,
  onSwitched,
}: {
  actingAsEmail: string;
  onSwitched: () => void;
}) {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/act-as")
      .then((r) => (r.ok ? r.json() : { accounts: [] }))
      .then((d) => setAccounts(d.accounts || []))
      .catch(() => {
        /* transient */
      });
  }, []);

  const actAs = async (email: string) => {
    setBusy(true);
    try {
      const r = await fetch("/api/admin/act-as", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (r.ok) {
        onSwitched();
        router.push("/");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="flex items-center gap-2 px-4 pb-1 pt-2 text-[11px] uppercase tracking-wide text-white/40">
        <UserCog size={13} />
        Act as
      </p>
      {accounts.length === 0 && (
        <p className="px-4 py-1.5 text-sm text-white/40">No accounts</p>
      )}
      {accounts.map((a) => {
        const isCurrent = a.email === actingAsEmail;
        return (
          <button
            key={a.id}
            disabled={busy || isCurrent}
            onClick={() => actAs(a.email)}
            className="flex w-full items-center justify-between px-4 py-2 text-left text-sm text-white/80 transition hover:bg-white/5 disabled:opacity-40"
          >
            <span data-pii className="truncate">
              {a.email}
            </span>
            {isCurrent && (
              <span className="ml-2 text-[10px] text-emerald-300">current</span>
            )}
          </button>
        );
      })}
    </>
  );
}
