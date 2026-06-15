"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthCard } from "@/components/ui/modern-stunning-sign-in";

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefilledCode = searchParams.get("code") || "";
  const prefilledEmail = searchParams.get("email") || "";

  const initialValues: Record<string, string> = {};
  if (prefilledCode) initialValues.code = prefilledCode;
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
        { name: "code", type: "text", placeholder: "Registration code" },
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
