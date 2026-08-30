"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/ui/modern-stunning-sign-in";


// Where to go after signing in.
//
// `next` is attacker-controllable — it is a query parameter — so it is checked
// rather than followed. A path on this host is always fine. An absolute URL is
// allowed only when it is a sibling on the same parent domain: those hosts
// (the shorts app, the store) already receive this session cookie, which is
// scoped to that domain, so sending someone there hands over nothing they were
// not already going to get. Anything else — another site, a protocol-relative
// "//evil.example" that a naive startsWith("/") would accept, a javascript:
// URL — falls back to the dashboard.
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  // A path, but only a real one. "//evil.example" is protocol-relative, and so
  // is "/\\evil.example" — a browser normalises the backslash to a slash, so a
  // check that only rejects "//" lets the same redirect through wearing a
  // different first character.
  if (raw.startsWith("/") && raw[1] !== "/" && raw[1] !== "\\") return raw;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "/";
    const here = window.location.hostname.split(".");
    const parent = here.slice(-2).join(".");
    const host = url.hostname;
    if (host === window.location.hostname) return url.toString();
    if (parent.includes(".") && (host === parent || host.endsWith(`.${parent}`))) {
      return url.toString();
    }
  } catch {
    /* not a URL at all */
  }
  return "/";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <AuthCard
      title="Sign in to Elite"
      submitLabel="Sign in"
      fields={[
        { name: "email", type: "email", placeholder: "Email" },
        { name: "password", type: "password", placeholder: "Password" },
      ]}
      onSubmit={async (values) => {
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data.error || "Sign in failed.";
        }
        const next = safeNext(searchParams.get("next"));
        // A sibling host is a different origin, not a route this router can
        // resolve — hand it to the browser instead.
        if (next.startsWith("/")) {
          router.push(next);
          router.refresh();
        } else {
          window.location.href = next;
        }
      }}
      footer={
        <>
          <div>
            Don&apos;t have an account?{" "}
            <Link
              href="/register"
              className="underline text-white/80 hover:text-white"
            >
              Register with a code
            </Link>
          </div>
          <div className="mt-1">
            No code?{" "}
            <Link
              href="/request-invite"
              className="underline text-white/80 hover:text-white"
            >
              Request an invite
            </Link>
          </div>
        </>
      }
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#121212]" />}>
      <LoginForm />
    </Suspense>
  );
}
