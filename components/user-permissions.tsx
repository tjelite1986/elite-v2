"use client";

import { useCallback, useEffect, useState } from "react";

interface PermDef {
  key: string;
  label: string;
}
interface UserRow {
  id: number;
  email: string;
  username: string | null;
  role: string;
  permissions: string[];
}

// Admin panel: grant/revoke per-user settings-page permissions. Admins implicitly
// hold every permission, so their row is shown as fixed "All".
export default function UserPermissions() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [available, setAvailable] = useState<PermDef[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/users");
    if (!r.ok) return;
    const d = await r.json();
    setUsers(d.users ?? []);
    setAvailable(d.available ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(u: UserRow, key: string) {
    const next = u.permissions.includes(key)
      ? u.permissions.filter((k) => k !== key)
      : [...u.permissions, key];
    setBusyId(u.id);
    setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, permissions: next } : x)));
    try {
      const r = await fetch(`/api/admin/users/${u.id}/permissions`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ permissions: next }),
      });
      if (!r.ok) await load(); // revert optimistic update on failure
    } catch {
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-semibold text-white">Permissions</h2>
      <p className="mb-4 text-sm text-white/50">
        Grant a user access to a section&apos;s settings page. Admins have every
        permission automatically.
      </p>
      <div className="space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {u.username || u.email}
                </p>
                <p className="truncate text-xs text-white/40">{u.email}</p>
              </div>
              {u.role === "admin" ? (
                <span className="rounded-full bg-rose-500/20 px-3 py-1 text-xs font-medium text-rose-200">
                  All (admin)
                </span>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {available.map((p) => {
                    const on = u.permissions.includes(p.key);
                    return (
                      <button
                        key={p.key}
                        type="button"
                        disabled={busyId === u.id}
                        onClick={() => toggle(u, p.key)}
                        aria-pressed={on}
                        className={
                          "rounded-full px-3 py-1 text-xs font-medium transition active:scale-95 disabled:opacity-50 " +
                          (on
                            ? "bg-emerald-500/25 text-emerald-200 ring-1 ring-emerald-400/40"
                            : "bg-white/5 text-white/50 ring-1 ring-white/10 hover:bg-white/10")
                        }
                      >
                        {p.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ))}
        {users.length === 0 && (
          <div className="rounded-2xl border border-white/10 px-4 py-6 text-center text-white/40">
            No users.
          </div>
        )}
      </div>
    </section>
  );
}
