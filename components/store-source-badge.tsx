import { safeHttpUrl } from "@/lib/url";

const LABELS: Record<string, string> = {
  local: "Archive",
  github: "GitHub",
  fdroid: "F-Droid",
  playstore: "Play Store",
};

const COLORS: Record<string, string> = {
  local: "bg-white/10 text-white/70",
  github: "bg-neutral-200/15 text-neutral-100",
  fdroid: "bg-emerald-500/15 text-emerald-300",
  playstore: "bg-sky-500/15 text-sky-300",
};

export default function StoreSourceBadge({
  source,
  href,
}: {
  source: string;
  href?: string | null;
}) {
  const label = LABELS[source] || source;
  const cls = `inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
    COLORS[source] || "bg-white/10 text-white/70"
  }`;
  const safeHref = safeHttpUrl(href);
  if (safeHref) {
    return (
      <a href={safeHref} target="_blank" rel="noreferrer" className={cls}>
        {label} ↗
      </a>
    );
  }
  return <span className={cls}>{label}</span>;
}
