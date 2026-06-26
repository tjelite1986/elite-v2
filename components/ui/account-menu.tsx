"use client";

import { Menu } from "@ark-ui/react/menu";
import { Portal } from "@ark-ui/react/portal";
import {
  ChevronDown,
  User,
  Settings,
  ShieldCheck,
  HelpCircle,
  LogOut,
} from "lucide-react";

interface AccountMenuProps {
  email: string;
  role: "user" | "admin";
  onLogout: () => void;
  onAdmin?: () => void;
  onProfile?: () => void;
  onSettings?: () => void;
  /** Compact trigger that fits inside the macOS menu bar (32px tall). */
  compact?: boolean;
}

function getInitials(email: string): string {
  const local = email.split("@")[0] || email;
  const letters = local.replace(/[^a-zA-Z]/g, "");
  return (letters.slice(0, 2) || local.slice(0, 2)).toUpperCase();
}

const itemClass =
  "flex items-center gap-3 px-3 py-2 text-sm text-gray-200 rounded-md hover:bg-white/10 focus:bg-white/10 cursor-pointer outline-none";

export default function AccountMenu({
  email,
  role,
  onLogout,
  onAdmin,
  onProfile,
  onSettings,
  compact = false,
}: AccountMenuProps) {
  const handleSelect = ({ value }: { value: string }) => {
    if (value === "logout") onLogout();
    else if (value === "admin") onAdmin?.();
    else if (value === "profile") onProfile?.();
    else if (value === "settings") onSettings?.();
  };

  return (
    <Menu.Root onSelect={handleSelect}>
      {compact ? (
        <Menu.Trigger className="inline-flex items-center gap-2 text-white text-sm cursor-pointer hover:opacity-80 transition-opacity duration-150 select-none focus:outline-none ml-1">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-[10px] font-semibold">
            {getInitials(email)}
          </div>
          <span data-pii className="hidden sm:inline max-w-[8rem] truncate">{email.split("@")[0]}</span>
          <ChevronDown className="w-3.5 h-3.5 opacity-70" />
        </Menu.Trigger>
      ) : (
        <Menu.Trigger className="inline-flex items-center gap-3 px-3 py-2 bg-white/10 border border-white/15 text-white text-sm font-medium rounded-full backdrop-blur hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/30 transition">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold">
            {getInitials(email)}
          </div>
          <span data-pii className="max-w-[10rem] truncate">{email.split("@")[0]}</span>
          <ChevronDown className="w-4 h-4 opacity-70" />
        </Menu.Trigger>
      )}
      <Portal>
        <Menu.Positioner>
          <Menu.Content className="z-[70] bg-[rgba(28,28,30,0.92)] border border-white/12 rounded-xl shadow-2xl backdrop-blur-md p-1 min-w-56 focus-visible:outline-none">
            <div className="px-3 py-2 border-b border-white/10">
              <div data-pii className="text-sm font-medium text-gray-100 truncate">
                {email}
              </div>
              <div className="text-xs text-gray-400">
                {role === "admin" ? "Administrator" : "Member"}
              </div>
            </div>

            <Menu.Item value="profile" className={itemClass}>
              <User className="w-4 h-4" />
              Profile
            </Menu.Item>
            <Menu.Item value="settings" className={itemClass}>
              <Settings className="w-4 h-4" />
              Settings
            </Menu.Item>

            {role === "admin" && (
              <Menu.Item value="admin" className={itemClass}>
                <ShieldCheck className="w-4 h-4" />
                Admin
              </Menu.Item>
            )}

            <Menu.Separator className="my-1 h-px bg-white/10 border-0" />

            <Menu.Item value="help" className={itemClass}>
              <HelpCircle className="w-4 h-4" />
              Help &amp; Support
            </Menu.Item>

            <Menu.Separator className="my-1 h-px bg-white/10 border-0" />

            <Menu.Item
              value="logout"
              className="flex items-center gap-3 px-3 py-2 text-sm text-red-400 rounded-md hover:bg-red-500/15 focus:bg-red-500/15 cursor-pointer outline-none"
            >
              <LogOut className="w-4 h-4" />
              Log out
            </Menu.Item>
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  );
}
