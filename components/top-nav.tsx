"use client";

import { usePathname, useRouter } from "next/navigation";
import MacOSMenuBar from "@/components/ui/mac-os-menu-bar";
import AccountMenu from "@/components/ui/account-menu";
import NotificationBell from "@/components/ui/notification-bell";

interface TopNavProps {
  email: string;
  role: "user" | "admin";
}

export default function TopNav({ email, role }: TopNavProps) {
  const router = useRouter();
  const pathname = usePathname();

  const menus = [
    { label: "Dashboard", action: "dashboard" },
    { label: "Messages", action: "messages" },
    { label: "Gallery", action: "gallery" },
  ];

  const activeAction =
    pathname === "/"
      ? "dashboard"
      : pathname.startsWith("/messages")
        ? "messages"
        : pathname.startsWith("/gallery")
          ? "gallery"
          : "";

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  const handleAction = (action: string) => {
    if (action === "admin-codes") router.push("/admin");
    if (action === "dashboard") router.push("/");
    if (action === "messages") router.push("/messages");
    if (action === "gallery") router.push("/gallery");
  };

  return (
    <div className="fixed left-1/2 top-3 z-50 w-[95%] max-w-6xl -translate-x-1/2">
      <MacOSMenuBar
        appName="Elite"
        appAction="dashboard"
        showAppleLogo={false}
        activeAction={activeAction}
        menus={menus}
        onMenuAction={handleAction}
        rightSlot={
          <div className="flex items-center gap-1.5">
            <NotificationBell />
            <AccountMenu
              compact
              email={email}
              role={role}
              onLogout={logout}
              onAdmin={() => router.push("/admin")}
              onProfile={() => router.push("/profile")}
              onSettings={() => router.push("/settings")}
            />
          </div>
        }
      />
    </div>
  );
}
