// Push a JSON payload to every live WebSocket of the given users. The socket
// registry is populated by the custom server (server.mjs) on globalThis.
export function broadcastToUsers(userIds: number[], payload: unknown): void {
  const registry = (
    globalThis as unknown as {
      __wsClients?: Map<number, Set<{ send: (data: string) => void }>>;
    }
  ).__wsClients;
  if (!registry) return;
  const data = JSON.stringify(payload);
  for (const uid of userIds) {
    registry.get(uid)?.forEach((ws) => {
      try {
        ws.send(data);
      } catch {
        /* socket may be closing */
      }
    });
  }
}
