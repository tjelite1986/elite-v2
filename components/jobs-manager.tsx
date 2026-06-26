"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Clock } from "lucide-react";

interface Job {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  interval_seconds: number;
  last_run_at: string | null;
  last_status: "ok" | "error" | "running" | null;
  last_duration_ms: number | null;
  last_output: string | null;
  next_run_at: string | null;
  running: boolean;
}

// SQLite returns UTC datetimes like "2026-06-26 12:00:00" (no zone). Parse as UTC.
function parseSqlDate(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

function relative(s: string | null): string {
  const d = parseSqlDate(s);
  if (!d) return "never";
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let label: string;
  if (abs < 60000) label = "just now";
  else if (mins < 60) label = `${mins} min`;
  else if (hours < 24) label = `${hours} h`;
  else label = `${days} d`;
  if (abs < 60000) return label;
  return diff < 0 ? `${label} ago` : `in ${label}`;
}

// Pick a friendly unit for an interval given in seconds.
function toDisplay(seconds: number): { value: number; unit: "minutes" | "hours" } {
  if (seconds >= 3600 && seconds % 3600 === 0) {
    return { value: seconds / 3600, unit: "hours" };
  }
  return { value: Math.max(1, Math.round(seconds / 60)), unit: "minutes" };
}

function StatusBadge({ job }: { job: Job }) {
  if (job.running) {
    return (
      <span className="inline-flex items-center gap-1 text-blue-300">
        <Loader2 size={12} className="animate-spin" /> running
      </span>
    );
  }
  if (job.last_status === "ok") return <span className="text-green-400">ok</span>;
  if (job.last_status === "error") return <span className="text-red-400">error</span>;
  return <span className="text-white/40">never run</span>;
}

export default function JobsManager() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openOutput, setOpenOutput] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs);
      }
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 5000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [load]);

  const patch = async (id: string, body: { enabled?: boolean; intervalSeconds?: number }) => {
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id
          ? {
              ...j,
              enabled: body.enabled ?? j.enabled,
              interval_seconds: body.intervalSeconds ?? j.interval_seconds,
            }
          : j
      )
    );
    await fetch("/api/admin/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    load();
  };

  const runNow = async (id: string) => {
    setBusyId(id);
    try {
      await fetch(`/api/admin/jobs/${id}/run`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const changeInterval = (job: Job, value: number, unit: "minutes" | "hours") => {
    if (!Number.isFinite(value) || value <= 0) return;
    const seconds = unit === "hours" ? value * 3600 : value * 60;
    patch(job.id, { intervalSeconds: seconds });
  };

  return (
    <section className="mb-10">
      <h2 className="mb-1 text-lg font-medium">Background jobs</h2>
      <p className="mb-4 text-sm text-white/50">
        Enable a job to run it automatically on a schedule, or run it once now.
        Replaces the host systemd timers — the scheduler runs inside the app
        server.
      </p>

      {!loaded ? (
        <p className="text-sm text-white/40">Loading…</p>
      ) : jobs.length === 0 ? (
        <p className="text-sm text-white/40">No jobs registered.</p>
      ) : (
        <div className="space-y-2">
          {jobs.map((job) => {
            const disp = toDisplay(job.interval_seconds);
            return (
              <div
                key={job.id}
                className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{job.name}</p>
                    {job.description && (
                      <p className="mt-0.5 text-sm text-white/50">{job.description}</p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
                      <span>
                        Status: <StatusBadge job={job} />
                      </span>
                      <span>Last run: {relative(job.last_run_at)}</span>
                      {job.enabled && job.next_run_at && !job.running && (
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} /> next {relative(job.next_run_at)}
                        </span>
                      )}
                      {job.last_output && (
                        <button
                          onClick={() =>
                            setOpenOutput(openOutput === job.id ? null : job.id)
                          }
                          className="text-white/50 underline-offset-2 hover:text-white hover:underline"
                        >
                          {openOutput === job.id ? "hide output" : "view output"}
                        </button>
                      )}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    {/* Interval */}
                    <div className="flex items-center gap-1 text-xs text-white/60">
                      <span>every</span>
                      <input
                        type="number"
                        min={1}
                        defaultValue={disp.value}
                        key={`${job.id}-${job.interval_seconds}`}
                        onBlur={(e) =>
                          changeInterval(job, Number(e.target.value), disp.unit)
                        }
                        className="w-14 rounded-md border border-white/10 bg-white/10 px-2 py-1 text-center text-white outline-none focus:border-white/30"
                      />
                      <select
                        value={disp.unit}
                        onChange={(e) =>
                          changeInterval(
                            job,
                            disp.value,
                            e.target.value as "minutes" | "hours"
                          )
                        }
                        className="rounded-md border border-white/10 bg-white/10 px-1.5 py-1 text-white outline-none focus:border-white/30"
                      >
                        <option value="minutes">min</option>
                        <option value="hours">h</option>
                      </select>
                    </div>

                    {/* Enable toggle */}
                    <button
                      role="switch"
                      aria-checked={job.enabled}
                      onClick={() => patch(job.id, { enabled: !job.enabled })}
                      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                        job.enabled ? "bg-green-500/70" : "bg-white/15"
                      }`}
                      title={job.enabled ? "Scheduled — click to disable" : "Disabled — click to enable"}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
                          job.enabled ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>

                    {/* Run now */}
                    <button
                      onClick={() => runNow(job.id)}
                      disabled={busyId === job.id || job.running}
                      className="flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium transition active:scale-95 hover:bg-white/15 disabled:opacity-50"
                    >
                      {busyId === job.id || job.running ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                      Run now
                    </button>
                  </div>
                </div>

                {openOutput === job.id && job.last_output && (
                  <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-xs text-white/70">
                    {job.last_output}
                    {job.last_duration_ms != null && (
                      <span className="mt-1 block text-white/40">
                        ({(job.last_duration_ms / 1000).toFixed(1)}s)
                      </span>
                    )}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
