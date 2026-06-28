"use client";

import { useEffect, useState } from "react";
import { Server, Loader2 } from "lucide-react";

interface ServerData {
  hostname: string;
  uptime: number;
  cpu: { model: string; cores: number; loadPercent: number };
  memory: { used: number; total: number; percent: number };
  disk: { used: number; total: number; percent: number } | null;
}

function formatBytes(n: number): string {
  if (!n) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${u[i]}`;
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function StatBar({ label, percent, extra }: { label: string; percent: number; extra: string }) {
  const color = percent > 90 ? "bg-red-500" : percent > 70 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-white/50">
        <span>{label}</span>
        <span className="tabular-nums">
          {percent}% — {extra}
        </span>
      </div>
      <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}

// Host CPU/RAM/disk + uptime from /api/server-stats, polled every 10s.
export default function ServerWidget() {
  const [data, setData] = useState<ServerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/server-stats")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => !cancelled && setData(d));
    }
    load();
    const id = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
        <Server size={13} className="text-emerald-400" />
        <span>Server</span>
      </div>
      {!data ? (
        <Loader2 size={16} className="animate-spin text-white/40" />
      ) : (
        <div className="space-y-2">
          <StatBar label="CPU" percent={data.cpu.loadPercent} extra={`${data.cpu.cores} cores`} />
          <StatBar
            label="RAM"
            percent={data.memory.percent}
            extra={`${formatBytes(data.memory.used)} / ${formatBytes(data.memory.total)}`}
          />
          {data.disk && (
            <StatBar
              label="Disk"
              percent={data.disk.percent}
              extra={`${formatBytes(data.disk.used)} / ${formatBytes(data.disk.total)}`}
            />
          )}
          <p className="pt-1 text-[10px] text-white/40">
            {data.hostname} · up {formatUptime(data.uptime)}
          </p>
        </div>
      )}
    </div>
  );
}
