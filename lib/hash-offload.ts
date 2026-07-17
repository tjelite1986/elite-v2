// Off-loads image fingerprint/signature computation (sharp decode + hash math)
// to a single persistent worker thread so bulk imports never stall the one
// Next.js event loop. Falls back to computing inline if the worker dies or
// cannot start (e.g. the worker file is missing in a dev setup).

import { Worker } from "node:worker_threads";
import path from "node:path";
import fs from "node:fs";
import {
  imageFingerprint as inlineFingerprint,
  structuralSignature as inlineSignature,
} from "@/scripts/lib/image-dupe.mjs";

export type Fingerprint = { hash: bigint; gray: number } | null;

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const WORKER_FILE = path.join(process.cwd(), "scripts", "lib", "hash-worker.mjs");
const CALL_TIMEOUT_MS = 30_000;

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function failAll(err: Error) {
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker = null; // respawn lazily on the next call
}

function ensureWorker(): Worker {
  if (worker) return worker;
  if (!fs.existsSync(WORKER_FILE)) throw new Error(`worker file missing: ${WORKER_FILE}`);
  // Heap cap: a decode gone wrong kills the worker (the pool respawns it and
  // callers fall back inline), not the server.
  const w = new Worker(WORKER_FILE, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
  w.on("message", (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (pending.size === 0) w.unref();
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error || "hash worker error"));
  });
  w.on("error", (err) => failAll(err instanceof Error ? err : new Error(String(err))));
  w.on("exit", (code) => failAll(new Error(`hash worker exited (${code})`)));
  w.unref(); // idle worker must never keep the server process alive
  worker = w;
  return w;
}

function call(op: "fingerprint" | "signature", file: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error("hash worker timeout"));
    }, CALL_TIMEOUT_MS);
    timer.unref();
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    try {
      const w = ensureWorker();
      w.ref(); // keep the loop alive while a call is in flight
      w.postMessage({ id, op, file });
    } catch (err) {
      pending.delete(id);
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

export async function fingerprintOffThread(file: string): Promise<Fingerprint> {
  try {
    return (await call("fingerprint", file)) as Fingerprint;
  } catch {
    return inlineFingerprint(file);
  }
}

export async function signatureOffThread(file: string): Promise<Uint8Array | null> {
  try {
    return (await call("signature", file)) as Uint8Array | null;
  } catch {
    return inlineSignature(file);
  }
}
