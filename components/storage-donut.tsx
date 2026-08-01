import { HardDrive } from "lucide-react";

export interface StorageSegment {
  label: string;
  bytes: number;
  colour: string;
}

function format(b: number): string {
  if (!b) return "0 MB";
  const gb = b / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(b / 1e6))} MB`;
}

/**
 * Storage split by where it actually goes, as a ring. Server-rendered from the
 * same byte sums the stat tiles use, so the total here can never disagree with
 * the total there.
 */
export default function StorageDonut({ segments }: { segments: StorageSegment[] }) {
  const used = segments.filter((s) => s.bytes > 0);
  const total = used.reduce((n, s) => n + s.bytes, 0);

  const size = 132;
  const stroke = 14;
  const r = size / 2 - stroke / 2;
  const circumference = 2 * Math.PI * r;

  // Each arc starts where the previous one ended.
  let offset = 0;
  const arcs = used.map((s) => {
    const length = total ? (s.bytes / total) * circumference : 0;
    const arc = { ...s, length, offset };
    offset += length;
    return arc;
  });

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
        <HardDrive size={13} className="text-sky-400" />
        <span>Storage</span>
      </div>

      {total === 0 ? (
        <p className="text-xs text-white/40">Nothing stored yet.</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="relative shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={stroke}
              />
              {arcs.map((a) => (
                <circle
                  key={a.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={a.colour}
                  strokeWidth={stroke}
                  strokeDasharray={`${a.length} ${circumference}`}
                  strokeDashoffset={-a.offset}
                />
              ))}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-semibold leading-none tabular-nums">
                {format(total)}
              </span>
              <span className="mt-0.5 text-[10px] text-white/40">in use</span>
            </div>
          </div>

          <ul className="min-w-0 flex-1 space-y-1.5">
            {arcs.map((a) => (
              <li key={a.label} className="flex items-center gap-2 text-xs">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: a.colour }}
                />
                <span className="min-w-0 flex-1 truncate text-white/70">{a.label}</span>
                <span className="shrink-0 tabular-nums text-white/50">{format(a.bytes)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
