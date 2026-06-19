"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { SHORT_CATEGORIES, CATEGORY_LABELS } from "@/lib/shorts-categories";

// Category filter for the 18+ section. Reflects the active filter in the `cat`
// query param so the page (a server component) can scope the feed/grid to it.
// `All` clears the filter.
export default function ShortsCategoryChips({
  className,
}: {
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const active = params.get("cat") || "all";

  const go = (cat: string) => {
    const next = new URLSearchParams(params.toString());
    if (cat === "all") next.delete("cat");
    else next.set("cat", cat);
    // Reset any deep-link focus so the filtered view starts at the top.
    next.delete("focus");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const chips: { value: string; label: string }[] = [
    { value: "all", label: "All" },
    ...SHORT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
  ];

  return (
    <div className={cn("flex items-center gap-1.5 overflow-x-auto", className)}>
      {chips.map((c) => (
        <button
          key={c.value}
          onClick={() => go(c.value)}
          className={cn(
            "whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition",
            active === c.value
              ? "bg-rose-500 text-white"
              : "bg-white/10 text-white/70 hover:bg-white/15"
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
