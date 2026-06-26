import { createServer } from "node:http";
import path from "node:path";
import next from "next";
import { WebSocketServer } from "ws";
import { jwtVerify } from "jose";
import Database from "better-sqlite3";
import { startScheduler } from "./lib/jobs-runtime.mjs";

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || "0.0.0.0";

const SESSION_COOKIE = "elite_session";
const secret = new TextEncoder().encode(process.env.JWT_SECRET || "");

// Separate connection (same process, WAL) used only to stamp last_seen when a
// user goes offline. The app's main connection lives in the Next route handlers.
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
let presenceDb = null;
try {
  presenceDb = new Database(path.join(DATA_DIR, "elitev2.db"));
  presenceDb.pragma("journal_mode = WAL");
  // Ensure the column exists even if the app hasn't migrated yet.
  try {
    presenceDb.exec("ALTER TABLE users ADD COLUMN last_seen TEXT");
  } catch {
    /* column or table already exists */
  }
} catch {
  /* DB not ready yet; markLastSeen is a no-op until it is */
}

function markLastSeen(userId) {
  if (!presenceDb) return;
  try {
    presenceDb
      .prepare("UPDATE users SET last_seen = datetime('now') WHERE id = ?")
      .run(userId);
  } catch {
    /* column may not exist yet */
  }
}

// Registry of userId -> Set<WebSocket>. Shared with Next route handlers (same
// process) via globalThis, so POST /api/messages can push to live sockets.
const clients = new Map();
globalThis.__wsClients = clients;

const onlineUserIds = () => [...clients.keys()];

function sendTo(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch {
    /* socket closing */
  }
}

// Relay a payload to every socket of a single user.
function relayTo(userId, obj) {
  const set = clients.get(userId);
  if (!set) return;
  const data = JSON.stringify(obj);
  set.forEach((ws) => {
    try {
      ws.send(data);
    } catch {
      /* socket closing */
    }
  });
}

// Broadcast a payload to every connected socket (presence updates).
function broadcastAll(obj) {
  const data = JSON.stringify(obj);
  for (const set of clients.values()) {
    set.forEach((ws) => {
      try {
        ws.send(data);
      } catch {
        /* socket closing */
      }
    });
  }
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const server = createServer((req, res) => handle(req, res));

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);
    if (pathname !== "/api/ws") {
      socket.destroy();
      return;
    }

    const cookies = parseCookies(req.headers.cookie || "");
    const token = cookies[SESSION_COOKIE];
    if (!token) {
      socket.destroy();
      return;
    }

    const { payload } = await jwtVerify(token, secret);
    const userId = Number(payload.sub);
    if (!userId) {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      const wasOffline = !clients.get(userId)?.size;
      if (!clients.has(userId)) clients.set(userId, new Set());
      clients.get(userId).add(ws);

      // Tell the new socket who is currently online, and announce this user.
      sendTo(ws, { type: "presence_list", online: onlineUserIds() });
      if (wasOffline) broadcastAll({ type: "presence", userId, online: true });

      // Relay typing indicators to the target user.
      ws.on("message", (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (
            (data.type === "typing" || data.type === "stop_typing") &&
            data.to
          ) {
            relayTo(Number(data.to), { type: data.type, from: userId });
          }
        } catch {
          /* ignore malformed frames */
        }
      });

      ws.on("close", () => {
        const set = clients.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            clients.delete(userId);
            markLastSeen(userId);
            broadcastAll({ type: "presence", userId, online: false });
          }
        }
      });
      ws.on("error", () => {});
    });
  } catch {
    socket.destroy();
  }
});

server.listen(port, hostname, () => {
  console.log(`> Ready on http://${hostname}:${port} (custom server + ws)`);
  // Start the background-job scheduler once the server is accepting requests
  // (the http-triggered jobs loop back to it).
  startScheduler();
});
