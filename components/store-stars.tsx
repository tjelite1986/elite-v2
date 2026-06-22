import { Star } from "lucide-react";

// Read-only star rating display.
export default function StoreStars({
  value,
  count,
  size = 14,
}: {
  value: number;
  count?: number;
  size?: number;
}) {
  const full = Math.round(value);
  return (
    <span className="inline-flex items-center gap-1 text-amber-400">
      <span className="flex">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star
            key={i}
            width={size}
            height={size}
            className={i <= full ? "fill-amber-400" : "fill-transparent text-white/25"}
          />
        ))}
      </span>
      {typeof count === "number" && (
        <span className="text-xs text-white/50">
          {value ? value.toFixed(1) : "–"}
          {count > 0 ? ` (${count})` : ""}
        </span>
      )}
    </span>
  );
}
