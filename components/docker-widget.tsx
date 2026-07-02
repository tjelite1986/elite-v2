"use client";

import { useEffect, useState } from "react";
import { Container, Loader2, CircleDot, AlertTriangle } from "lucide-react";

interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

interface DockerData {
  containers: DockerContainer[];
  running: number;
  total: number;
  error?: string;
  hint?: string;
}

// Docker container status from /api/docker (host socket), polled every 15s.
export default function DockerWidget() {
  const [data, setData] = useState<DockerData | null>(null);

  useEffect(() => {
    let cancelled = false;
    function load() {
      fetch("/api/docker")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setData(d);
        })
        .catch(() => {
          /* transient failure — keep the last data */
        });
    }
    load();
    const id = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="rounded-2xl bg-white/5 p-4">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wider text-white/50">
        <Container size={13} className="text-blue-400" />
        <span>Docker</span>
      </div>
      {!data ? (
        <Loader2 size={16} className="animate-spin text-white/40" />
      ) : data.error ? (
        <div>
          <p className="flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle size={11} /> {data.error}
          </p>
          {data.hint && <p className="mt-1 text-[10px] text-white/40">{data.hint}</p>}
        </div>
      ) : (
        <div>
          <p className="text-xl font-semibold tabular-nums">
            {data.running} <span className="text-sm text-white/50">/ {data.total} running</span>
          </p>
          <ul className="mt-2 max-h-32 space-y-0.5 overflow-y-auto">
            {data.containers.slice(0, 12).map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[11px]">
                <CircleDot
                  size={8}
                  className={c.state === "running" ? "text-emerald-400" : "text-white/30"}
                />
                <span className="truncate text-white/80">{c.name}</span>
                <span className="ml-auto truncate text-white/40">{c.state}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
