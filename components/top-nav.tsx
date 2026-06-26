"use client";

import { usePathname, useRouter } from "next/navigation";
import MacOSMenuBar from "@/components/ui/mac-os-menu-bar";
import AccountMenu from "@/components/ui/account-menu";
import NotificationBell from "@/components/ui/notification-bell";
import ActAsControls from "@/components/ui/act-as-controls";

interface TopNavProps {
  email: string;
  role: "user" | "admin";
  username: string;
  imp: { email: string } | null;
  isRealAdmin: boolean;
}

export default function TopNav({
  email,
  role,
  username,
  imp,
  isRealAdmin,
}: TopNavProps) {
  const router = useRouter();
  const pathname = usePathname();

  const menus = [
    { label: "Dashboard", action: "dashboard" },
    { label: "Messages", action: "messages" },
    { label: "People", action: "people" },
    { label: "Gallery", action: "gallery" },
    { label: "Photos", action: "posts" },
    { label: "Shorts", action: "shorts" },
    { label: "18+", action: "shorts18" },
    { label: "Books", action: "books" },
    { label: "Store", action: "app-store" },
  ];

  const activeAction =
    pathname === "/"
      ? "dashboard"
      : pathname.startsWith("/messages")
        ? "messages"
        : pathname.startsWith("/people")
          ? "people"
          : pathname.startsWith("/gallery")
            ? "gallery"
            : pathname.startsWith("/posts")
              ? "posts"
              : pathname.startsWith("/shorts18")
                ? "shorts18"
                : pathname.startsWith("/shorts")
                  ? "shorts"
                  : pathname.startsWith("/books")
                    ? "books"
                    : pathname.startsWith("/store")
                      ? "app-store"
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
    if (action === "people") router.push("/people");
    if (action === "gallery") router.push("/gallery");
    if (action === "posts") router.push("/posts");
    if (action === "shorts") router.push("/shorts");
    if (action === "shorts18") router.push("/shorts18");
    if (action === "books") router.push("/books");
    if (action === "app-store") router.push("/store");
  };

  return (
    <div
      data-immersive-hide
      className="fixed left-1/2 top-3 z-50 w-[95%] max-w-6xl -translate-x-1/2"
    >
      <MacOSMenuBar
        appName="Elite"
        appAction="dashboard"
        showAppleLogo={false}
        activeAction={activeAction}
        menus={menus}
        onMenuAction={handleAction}
        rightSlot={
          <div className="flex items-center gap-1.5">
            <ActAsControls
              imp={imp}
              actingAsEmail={email}
              isRealAdmin={isRealAdmin}
            />
            <NotificationBell />
            <AccountMenu
              compact
              email={email}
              role={role}
              onLogout={logout}
              onAdmin={() => router.push("/admin")}
              onProfile={() => router.push(`/people/${username}`)}
              onSettings={() => router.push("/settings")}
            />
          </div>
        }
      />
    </div>
  );
}
