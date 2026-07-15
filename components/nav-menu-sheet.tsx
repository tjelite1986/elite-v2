"use client";

import { useBackDismiss } from "@/lib/use-back-dismiss";
import NavMenuContent from "@/components/nav-menu-content";

// Bottom sheet opened by the global bottom nav's Menu button. Slides up over
// the current page; backdrop click and device Back both dismiss it.
export default function NavMenuSheet({
  open,
  onClose,
  username,
  email,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  email: string;
  isAdmin: boolean;
}) {
  useBackDismiss(open, onClose);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] overflow-y-auto rounded-t-2xl bg-neutral-900 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] text-white duration-200 animate-in fade-in slide-in-from-bottom-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-white/20" />
        <NavMenuContent
          myUsername={username}
          myEmail={email}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
