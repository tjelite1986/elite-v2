"use client";

import * as React from "react";
import Link from "next/link";

export default function RequestInvitePage() {
  const [email, setEmail] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/invite-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Could not send your request.");
        return;
      }
      setDone(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-[#121212] relative overflow-hidden w-full"
      style={{
        background:
          "radial-gradient(circle at 50% -10%, #20202a 0%, #121212 60%)",
      }}
    >
      <div className="relative z-10 w-full max-w-sm rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] backdrop-blur-sm shadow-2xl p-8 flex flex-col items-center">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-6 shadow-lg text-white text-xl font-bold">
          E
        </div>

        {done ? (
          <>
            <h2 className="text-2xl font-semibold text-white mb-3 text-center">
              Request sent
            </h2>
            <p className="text-sm text-gray-300 text-center mb-6">
              Thanks. If your request is approved, you&apos;ll receive an email
              with a registration code.
            </p>
            <Link
              href="/login"
              className="w-full text-center bg-white/10 text-white font-medium px-5 py-3 rounded-full shadow hover:bg-white/20 transition text-sm"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold text-white mb-2 text-center">
              Request an invite
            </h2>
            <p className="text-sm text-gray-400 text-center mb-6">
              Elite is invite-only. Ask the admin for access.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col w-full gap-3">
              <input
                type="email"
                required
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
              <textarea
                placeholder="Message (optional) — tell the admin who you are"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={3}
                className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 resize-none"
              />
              {error && <div className="text-sm text-red-400">{error}</div>}
              <hr className="opacity-10 my-1" />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-white/10 text-white font-medium px-5 py-3 rounded-full shadow hover:bg-white/20 transition text-sm disabled:opacity-50"
              >
                {loading ? "Sending..." : "Send request"}
              </button>
            </form>
            <div className="w-full text-center mt-4">
              <span className="text-xs text-gray-400">
                Already have an account?{" "}
                <Link href="/login" className="underline text-white/80 hover:text-white">
                  Sign in
                </Link>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
