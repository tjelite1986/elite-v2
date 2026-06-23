"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/ui/modern-stunning-sign-in";

// Registration codes are UPPERCASE XXXX-XXXX (lib/codes.ts). As the user types,
// force uppercase, drop anything that isn't a code char, and auto-insert the
// dash after the 4th character (e.g. GTFD-JKLO).
function formatCode(value: string): string {
  const a = value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return a.length > 4 ? `${a.slice(0, 4)}-${a.slice(4)}` : a;
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCode = searchParams.get("code") || "";
  const prefilledEmail = searchParams.get("email") || "";

  const initialValues: Record<string, string> = {};
  if (prefilledCode) initialValues.code = formatCode(prefilledCode);
  if (prefilledEmail) initialValues.email = prefilledEmail;

  return (
    <AuthCard
      title="Create your account"
      submitLabel="Create account"
      initialValues={Object.keys(initialValues).length ? initialValues : undefined}
      fields={[
        { name: "email", type: "email", placeholder: "Email" },
        { name: "password", type: "password", placeholder: "Password (min 8 chars)" },
        { name: "confirmPassword", type: "password", placeholder: "Confirm password" },
        {
          name: "code",
          type: "text",
          placeholder: "Registration code (e.g. GTFD-JKLO)",
          format: formatCode,
          maxLength: 9,
        },
      ]}
      onSubmit={async (values) => {
        if (values.password !== values.confirmPassword) {
          return "Passwords do not match.";
        }
        const res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: values.email,
            password: values.password,
            code: values.code,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          return data.error || "Registration failed.";
        }
        router.push("/");
        router.refresh();
      }}
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="underline text-white/80 hover:text-white"
          >
            Sign in
          </Link>
        </>
      }
    />
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#121212]" />}>
      <RegisterForm />
    </Suspense>
  );
}
