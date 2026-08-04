"use client";

import { useBackDismiss } from "@/lib/use-back-dismiss";
import NavMenuContent, { MenuRow } from "@/components/nav-menu-content";
import { ActAsMenuSection } from "@/components/ui/act-as-controls";
import type { BottomNavItem } from "@/components/bottom-nav-config";

// Right-side drawer opened by the global bottom nav's Menu button (design
// from the Layout Studio sidebar sketch). Slides in over the current page;
// backdrop click and device Back both dismiss it.
export default function NavMenuSheet({
  open,
  onClose,
  username,
  email,
  displayName,
  canActAs,
  isAdmin = false,
  extras = [],
}: {
  open: boolean;
  onClose: () => void;
  username: string;
  email: string;
  displayName?: string | null;
  canActAs: boolean;
  isAdmin?: boolean;
  // Section-contextual overflow destinations (the old top pill bars' tabs
  // that don't fit the bottom bar), shown as a block above the app links.
  extras?: BottomNavItem[];
}) {
  useBackDismiss(open, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50" onClick={onClose}>
      <div
        className="absolute inset-y-0 right-0 flex w-[86vw] max-w-sm flex-col overflow-y-auto rounded-l-2xl border-l border-white/10 bg-neutral-900 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-[env(safe-area-inset-top)] text-white duration-200 animate-in fade-in slide-in-from-right-8"
        onClick={(e) => e.stopPropagation()}
      >
        <NavMenuContent
          myUsername={username}
          myEmail={email}
          myDisplayName={displayName}
          isAdmin={isAdmin}
          beforeSections={
            canActAs || extras.length > 0 ? (
              <>
                {canActAs && (
                  <ActAsMenuSection actingAsEmail={email} onSwitched={onClose} />
                )}
                {extras.map(({ label, href, icon: Icon }) => (
                  <MenuRow
                    key={href}
                    href={href}
                    icon={<Icon size={18} />}
                    label={label}
                  />
                ))}
              </>
            ) : undefined
          }
        />
      </div>
    </div>
  );
}
