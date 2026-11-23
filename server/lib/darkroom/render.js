// A small pool of render workers (lib/darkroom/render-worker.js). At most
// two renders run at once; the rest wait their turn. Workers are unref'd so
// an idle pool never keeps the process alive, and each job has a deadline.

import { Worker } from "node:worker_threads";

const MAX_WORKERS = Math.max(1, Math.min(4, Number(process.env.CONCORD_DARKROOM_WORKERS) || 2));
const JOB_TIMEOUT_MS = 180_000;
const pool = [];
const queue = [];
let seq = 0;

function spawn() {
  const w = new Worker(new URL("./render-worker.js", import.meta.url));
  const slot = { w, busy: null };
  w.unref();
  w.on("message", (msg) => {
    const job = slot.busy;
    if (!job || msg.id !== job.id) return;
    clearTimeout(job.timer);
    slot.busy = null;
    if (msg.ok) job.resolve({ ok: true, buf: Buffer.from(msg.buf), width: msg.width, height: msg.height });
    else job.resolve({ ok: false, error: msg.error || "render_failed" });
    pump();
  });
  const fail = (err) => {
    const job = slot.busy;
    slot.busy = null;
    const i = pool.indexOf(slot);
    if (i >= 0) pool.splice(i, 1);
    if (job) { clearTimeout(job.timer); job.resolve({ ok: false, error: String(err?.message || err || "render_worker_exited") }); }
    pump();
  };
  w.on("error", fail);
  w.on("exit", (code) => { if (code !== 0 || slot.busy) fail(new Error(`render worker exited (${code})`)); else { const i = pool.indexOf(slot); if (i >= 0) pool.splice(i, 1); } });
  pool.push(slot);
  return slot;
}

function pump() {
  while (queue.length) {
    let slot = pool.find((s) => !s.busy);
    if (!slot && pool.length < MAX_WORKERS) slot = spawn();
    if (!slot) return;
    const job = queue.shift();
    slot.busy = job;
    job.timer = setTimeout(() => {
      const s = pool.find((p) => p.busy === job);
      if (s) { s.busy = null; s.w.terminate().catch(() => {}); }
      job.resolve({ ok: false, error: "render_timed_out" });
    }, JOB_TIMEOUT_MS);
    job.timer.unref?.();
    const { resolve, timer, ...msg } = job;
    void resolve; void timer;
    slot.w.postMessage(msg);
  }
}

/**
 * Render a photo with an edit.
 * @param {{path: string, edit: object, format?: 'jpeg'|'webp'|'png', quality?: number,
 *          longEdge?: number, exif?: object|null, watermark?: string|null}} job
 * @returns {Promise<{ok: true, buf: Buffer, width: number, height: number}|{ok: false, error: string}>}
 */
export function renderPhoto(job) {
  return new Promise((resolve) => {
    queue.push({ ...job, id: ++seq, resolve });
    pump();
  });
}

/** For tests: stop every worker. */
export async function shutdownRenderPool() {
  await Promise.all(pool.splice(0).map((s) => s.w.terminate().catch(() => {})));
}
