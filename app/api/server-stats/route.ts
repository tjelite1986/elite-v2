import { NextResponse } from "next/server";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

// Disk usage for a mount point via `df`. Returns null if df is unavailable.
async function diskUsage(path = "/"): Promise<{ total: number; used: number; free: number } | null> {
  try {
    const { stdout } = await execFileAsync("df", ["-B1", path], { timeout: 5000 });
    const lines = stdout.trim().split("\n");
    const parts = lines[lines.length - 1].split(/\s+/);
    return {
      total: Number(parts[1]) || 0,
      used: Number(parts[2]) || 0,
      free: Number(parts[3]) || 0,
    };
  } catch {
    return null;
  }
}

// Host stats from Node's os module + `df`. CPU "load percent" is the 1-minute
// load average divided by core count, not instantaneous CPU usage.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mem = { total: os.totalmem(), free: os.freemem() };
  const cpus = os.cpus();
  const load = os.loadavg();
  const uptime = os.uptime();
  const disk = await diskUsage("/");

  const cpu = {
    model: cpus[0]?.model?.trim() ?? "unknown",
    cores: cpus.length,
    loadPercent: Math.min(100, Math.round((load[0] / cpus.length) * 100)),
  };

  return NextResponse.json({
    hostname: os.hostname(),
    platform: os.platform(),
    uptime,
    cpu,
    load: load.map((v) => Math.round(v * 100) / 100),
    memory: {
      total: mem.total,
      used: mem.total - mem.free,
      free: mem.free,
      percent: Math.round(((mem.total - mem.free) / mem.total) * 100),
    },
    disk: disk ? { ...disk, percent: Math.round((disk.used / disk.total) * 100) } : null,
  });
}
