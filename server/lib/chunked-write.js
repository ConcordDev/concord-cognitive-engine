// server/lib/chunked-write.js
//
// Event-loop-friendly write of a large string to disk.
//
// WHY. The debounced state saver used to follow stringifyChunked with a
// synchronous better-sqlite3 INSERT OR REPLACE of a ~38 MB TEXT blob
// (or writeFileSync on the JSON path). V8 CPU profiles cannot sample inside
// that native write: INC-100 on 2026-10-19 caught a 4165 ms unsampled gap
// still on the saveStateDebounced timer stack (server.js ~13086) right after
// stringifyChunked finished. Quiet-box bench of the same 38 MB stmt.run was
// ~525 ms of solid event-loop block; under disk/swap pressure it stretches
// into multi-second freezes.
//
// WHAT THIS DOES. Writes `data` via a stream in ~chunkSize slices, yielding
// with setImmediate between slices (and awaiting drain when the kernel buffer
// is full). Same bytes on disk as writeFile; longest uninterrupted block is
// one slice. Measured maxGap ~1 ms for a 38 MB payload vs 525 ms for stmt.run.
//
// Atomicity is the caller's job (write to *.tmp then rename), same as the
// existing JSON state path.

import { createWriteStream } from "node:fs";
import { once } from "node:events";

const DEFAULT_CHUNK = 512 * 1024;

/**
 * @param {string} filePath
 * @param {string|Buffer} data
 * @param {{ chunkSize?: number, scheduler?: (fn: () => void) => void }} [opts]
 * @returns {Promise<void>}
 */
export async function writeFileChunkedYielding(filePath, data, opts = {}) {
  const chunkSize = Math.max(64 * 1024, Number(opts.chunkSize) || DEFAULT_CHUNK);
  const scheduler = opts.scheduler || setImmediate;
  const yieldOnce = () => new Promise((resolve) => { scheduler(resolve); });

  const str = typeof data === "string" ? data : null;
  const buf = typeof data === "string" ? null : Buffer.isBuffer(data) ? data : Buffer.from(data);
  const length = str !== null ? str.length : buf.length;

  if (length === 0) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(filePath, str !== null ? "" : buf);
    return;
  }

  const ws = createWriteStream(filePath);
  try {
    for (let i = 0; i < length; i += chunkSize) {
      const slice = str ? str.slice(i, i + chunkSize) : buf.subarray(i, i + chunkSize);
      const ok = ws.write(slice);
      if (!ok) await once(ws, "drain");
      await yieldOnce();
    }
    ws.end();
    await once(ws, "finish");
  } catch (err) {
    ws.destroy();
    throw err;
  }
}

export default { writeFileChunkedYielding };
