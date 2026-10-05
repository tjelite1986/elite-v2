import fs from "node:fs";
import type { Readable } from "node:stream";

// A Node stream as a web ReadableStream that survives the client hanging up.
//
// `Readable.toWeb(...)` does not: when a browser abandons a response (a clip
// scrolled out of view, a seek that starts a new Range request, a cancelled
// download) the response's controller is closed while the Node stream keeps
// producing, and the next chunk lands on a closed controller. That throws
// ERR_INVALID_STATE ("Invalid state: Controller is already closed") from a
// place no route handler can catch, so it surfaces as an uncaughtException
// and leaves the file descriptor open until the read finishes.
//
// So the stream is pumped by hand. An enqueue that throws means the reader is
// gone and the source is destroyed; cancel() and the request's abort signal do
// the same on the orderly paths; and backpressure is honoured by pausing until
// pull() asks for more, so a large file is never read faster than it is sent.
export function toWebStream(
  source: Readable,
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  const stop = () => source.destroy();
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      source.on("data", (chunk: Buffer | string) => {
        try {
          controller.enqueue(
            typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk)
          );
        } catch {
          // Nobody is reading any more; stop producing.
          source.destroy();
          return;
        }
        if ((controller.desiredSize ?? 1) <= 0) source.pause();
      });
      source.on("end", () => {
        try {
          controller.close();
        } catch {
          /* already closed by an abort */
        }
      });
      source.on("error", (err) => {
        try {
          controller.error(err);
        } catch {
          /* the reader is already gone; the error has nowhere to go */
        }
      });
      source.on("close", () => signal?.removeEventListener("abort", stop));
    },
    pull() {
      source.resume();
    },
    cancel() {
      source.destroy();
    },
  });
}

// A file on disk (optionally a byte range of it) as an abort-safe web stream.
export function fileStream(
  filePath: string,
  options: { start?: number; end?: number } = {},
  signal?: AbortSignal
): ReadableStream<Uint8Array> {
  return toWebStream(fs.createReadStream(filePath, options), signal);
}
