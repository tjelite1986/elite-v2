"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/ui/modern-stunning-sign-in";

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
        const next = searchParams.get("next") || "/";
        router.push(next);
        router.refresh();
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
