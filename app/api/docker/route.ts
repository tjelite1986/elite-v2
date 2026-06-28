import { NextResponse } from "next/server";
import fs from "node:fs";
import http from "node:http";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SOCK = "/var/run/docker.sock";

interface Container {
  Id: string;
  Names: string[];
  Image: string;
  State: string;
  Status: string;
  Created: number;
}

// Talk to the Docker Engine API over its unix socket.
function dockerGet<T>(path: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCK, path, method: "GET", timeout: 4000 }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 400) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.end();
  });
}

// Container status list via the Docker socket. Requires the host socket to be
// mounted read-only into this container (see docker-compose.yml volumes).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!fs.existsSync(SOCK)) {
    return NextResponse.json({
      error: "Docker socket not mounted",
      hint: "Add '/var/run/docker.sock:/var/run/docker.sock:ro' to compose volumes",
      containers: [],
      running: 0,
      total: 0,
    });
  }

  try {
    const list = await dockerGet<Container[]>("/containers/json?all=true");
    const containers = list.map((c) => ({
      id: c.Id.slice(0, 12),
      name: (c.Names[0] ?? c.Id).replace(/^\//, ""),
      image: c.Image,
      state: c.State,
      status: c.Status,
      createdAt: c.Created * 1000,
    }));
    const running = containers.filter((c) => c.state === "running").length;
    return NextResponse.json({ containers, running, total: containers.length });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Docker query failed",
      containers: [],
      running: 0,
      total: 0,
    });
  }
}
