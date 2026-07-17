// worker_threads entry: runs the image-dupe pixel work (sharp decode + hash
// math) off the main server thread. Spawned by lib/hash-offload.ts, which
// resolves this file from process.cwd() — it ships un-bundled inside the image
// because the whole scripts/ tree is copied (same reason the job scripts work).

import { parentPort } from "node:worker_threads";
import { imageFingerprint, structuralSignature } from "./image-dupe.mjs";

parentPort.on("message", async (msg) => {
  const { id, op, file } = msg;
  try {
    let result = null;
    if (op === "fingerprint") result = await imageFingerprint(file);
    else if (op === "signature") result = await structuralSignature(file);
    else throw new Error(`unknown op: ${op}`);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
});
