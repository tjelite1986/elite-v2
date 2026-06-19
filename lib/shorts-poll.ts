import { spawn } from "node:child_process";
import path from "node:path";

// Fire the poller for a single profile in the background. Detached + unref so it
// keeps running (downloads can take a while) after the HTTP response returns.
// The poller's lockfile serializes it against the scheduled timer run.
export function triggerPoll(profileId: number): void {
  try {
    const script = path.join(process.cwd(), "scripts", "poll-shorts.mjs");
    const child = spawn(process.execPath, [script, String(profileId)], {
      detached: true,
      stdio: "ignore",
      cwd: process.cwd(),
    });
    child.unref();
  } catch (err) {
    console.error("[shorts] failed to trigger poll:", err);
  }
}
