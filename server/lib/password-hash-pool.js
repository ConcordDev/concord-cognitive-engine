// server/lib/password-hash-pool.js
//
// bcrypt off the main thread. bcryptjs's async API does yield (≤100ms slices
// via setImmediate), but every login/signup still costs ~300ms of MAIN-thread
// CPU at 12 rounds — a signup burst (~20/s) saturates the request loop by
// itself and the overload gate starts 503ing everyone. Running the same
// bcryptjs in a worker keeps hashes byte-identical ($2a/$2b, existing
// passwords verify unchanged) while the request loop pays ~0.
//
// Falls back to in-thread bcryptjs if a worker can't start or dies, so auth
// never breaks because of the pool. Workers are unref'd and created lazily
// (first login), and terminatePasswordWorkers() is wired into server.js's
// test teardown.

import { Worker } from "node:worker_threads";
import os from "node:os";

const POOL_SIZE = Math.max(1, Math.min(2, Number(process.env.CONCORD_BCRYPT_WORKERS) || Math.floor((os.cpus()?.length || 2) / 4) || 1));
const TIMEOUT_MS = 15_000;

const WORKER_SRC = `
const { parentPort } = require("node:worker_threads");
const bcrypt = require(process.env.__CONCORD_BCRYPTJS_PATH);
parentPort.on("message", async ({ id, op, a, b }) => {
  try {
    const result = op === "hash" ? await bcrypt.hash(a, b) : await bcrypt.compare(a, b);
    parentPort.postMessage({ id, result });
  } catch (e) {
    parentPort.postMessage({ id, error: String(e && e.message || e) });
  }
});
`;

let _bcryptPath = null;
let _fallback = null;
const _workers = [];
let _rr = 0;
let _seq = 0;
const _pending = new Map();

async function fallbackLib() {
  if (!_fallback) _fallback = (await import("bcryptjs")).default;
  return _fallback;
}

async function resolveBcryptPath() {
  if (_bcryptPath) return _bcryptPath;
  const { createRequire } = await import("node:module");
  _bcryptPath = createRequire(import.meta.url).resolve("bcryptjs");
  return _bcryptPath;
}

async function getWorker() {
  if (_workers.length < POOL_SIZE) {
    const w = new Worker(WORKER_SRC, { eval: true, env: { ...process.env, __CONCORD_BCRYPTJS_PATH: await resolveBcryptPath() } });
    w.unref();
    w.on("message", ({ id, result, error }) => {
      const p = _pending.get(id);
      if (!p) return;
      _pending.delete(id);
      clearTimeout(p.timer);
      if (error) p.reject(new Error(error)); else p.resolve(result);
    });
    const drop = () => {
      const i = _workers.indexOf(w);
      if (i >= 0) _workers.splice(i, 1);
      for (const [id, p] of _pending) if (p.worker === w) { _pending.delete(id); clearTimeout(p.timer); p.retry(); }
    };
    w.on("error", drop);
    w.on("exit", drop);
    _workers.push(w);
    return w;
  }
  return _workers[_rr++ % _workers.length];
}

async function run(op, a, b) {
  let worker;
  try { worker = await getWorker(); } catch { worker = null; }
  const inThread = async () => {
    const lib = await fallbackLib();
    return op === "hash" ? lib.hash(a, b) : lib.compare(a, b);
  };
  if (!worker) return inThread();
  return new Promise((resolve, reject) => {
    const id = ++_seq;
    const timer = setTimeout(() => {
      if (_pending.delete(id)) inThread().then(resolve, reject);
    }, TIMEOUT_MS);
    timer.unref?.();
    _pending.set(id, { resolve, reject, timer, worker, retry: () => inThread().then(resolve, reject) });
    worker.postMessage({ id, op, a, b });
  });
}

export function hashPasswordOffThread(password, rounds) {
  return run("hash", String(password), Number(rounds));
}

export function verifyPasswordOffThread(password, hash) {
  return run("compare", String(password), String(hash));
}

export async function terminatePasswordWorkers() {
  const ws = _workers.splice(0);
  await Promise.allSettled(ws.map((w) => w.terminate()));
}
