"use client";

import * as React from "react";

export interface AuthCardField {
  name: string;
  type: string;
  placeholder: string;
}

interface AuthCardProps {
  title: string;
  submitLabel: string;
  fields: AuthCardField[];
  onSubmit: (values: Record<string, string>) => Promise<string | void>;
  footer?: React.ReactNode;
  initialValues?: Record<string, string>;
}

/**
 * Glassmorphic auth card adapted from the HextaUI "modern-stunning-sign-in"
 * component. Generalised into a controlled form so it can back both the
 * sign-in and registration pages.
 */
export const AuthCard: React.FC<AuthCardProps> = ({
  title,
  submitLabel,
  fields,
  onSubmit,
  footer,
  initialValues,
}) => {
  const [values, setValues] = React.useState<Record<string, string>>(
    initialValues ?? {}
  );
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await onSubmit(values);
      if (result) setError(result);
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
      <form
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm rounded-3xl bg-gradient-to-r from-[#ffffff10] to-[#121212] backdrop-blur-sm shadow-2xl p-8 flex flex-col items-center"
      >
        {/* Logo */}
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-white/20 mb-6 shadow-lg text-white text-xl font-bold">
          E
        </div>
        {/* Title */}
        <h2 className="text-2xl font-semibold text-white mb-6 text-center">
          {title}
        </h2>
        {/* Fields */}
        <div className="flex flex-col w-full gap-4">
          <div className="w-full flex flex-col gap-3">
            {fields.map((field) => (
              <input
                key={field.name}
                placeholder={field.placeholder}
                type={field.type}
                value={values[field.name] ?? ""}
                className="w-full px-5 py-3 rounded-xl bg-white/10 text-white placeholder-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-gray-400"
                onChange={(e) => handleChange(field.name, e.target.value)}
              />
            ))}
            {error && (
              <div className="text-sm text-red-400 text-left">{error}</div>
            )}
          </div>
          <hr className="opacity-10" />
          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-white/10 text-white font-medium px-5 py-3 rounded-full shadow hover:bg-white/20 transition mb-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? "Please wait..." : submitLabel}
            </button>
            {footer && (
              <div className="w-full text-center mt-2">
                <span className="text-xs text-gray-400">{footer}</span>
              </div>
            )}
          </div>
        </div>
      </form>
    </div>
  );
};
