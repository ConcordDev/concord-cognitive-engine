// server/lib/embedding-worker-client.js
//
// Main-thread side of workers/embedding-worker.js: one worker, requests
// matched by id, a per-request timeout, and failure of every pending request
// if the worker dies. The worker is unref'd so it never keeps the process
// (or a test run) alive on its own; terminate() stops it explicitly.

import { Worker } from "node:worker_threads";

const DEFAULT_WORKER = new URL("../workers/embedding-worker.js", import.meta.url);

/**
 * Start the worker and load the model in it.
 * @returns {Promise<{ embed(text: string): Promise<Float32Array>, terminate(): Promise<void>, pending(): number }>}
 *   Rejects if the worker can't start or the model fails to load.
 */
export function startEmbeddingWorker({
  model = "Xenova/all-MiniLM-L6-v2",
  threads = 2,
  initTimeoutMs = 180_000,
  requestTimeoutMs = 60_000,
  workerUrl = DEFAULT_WORKER,
} = {}) {
  const worker = new Worker(workerUrl);
  worker.unref();

  const pending = new Map(); // id -> { resolve, reject, timer }
  let nextId = 1;
  let dead = null;

  const failAll = (err) => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(err); }
    pending.clear();
  };

  return new Promise((resolveReady, rejectReady) => {
    const initTimer = setTimeout(() => {
      rejectReady(new Error("embedding_worker_init_timeout"));
      worker.terminate().catch(() => {});
    }, initTimeoutMs);
    initTimer.unref?.();

    worker.on("message", (msg) => {
      if (msg?.type === "ready") {
        clearTimeout(initTimer);
        resolveReady(client);
      } else if (msg?.type === "init_error") {
        clearTimeout(initTimer);
        rejectReady(new Error(msg.error || "embedding_worker_init_failed"));
        worker.terminate().catch(() => {});
      } else if (msg?.type === "result" || msg?.type === "error") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.type === "result") p.resolve(msg.embedding);
        else p.reject(new Error(msg.error || "embedding_failed"));
      }
    });
    worker.on("error", (err) => {
      dead = err;
      clearTimeout(initTimer);
      rejectReady(err);
      failAll(err);
    });
    worker.on("exit", (code) => {
      if (!dead) dead = new Error(`embedding_worker_exited_${code}`);
      clearTimeout(initTimer);
      rejectReady(dead);
      failAll(dead);
    });

    const client = {
      embed(text) {
        if (dead) return Promise.reject(dead);
        return new Promise((resolve, reject) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("embedding_timeout"));
          }, requestTimeoutMs);
          timer.unref?.();
          pending.set(id, { resolve, reject, timer });
          worker.postMessage({ type: "embed", id, text: String(text) });
        });
      },
      pending: () => pending.size,
      async terminate() {
        dead = dead || new Error("embedding_worker_terminated");
        failAll(dead);
        await worker.terminate();
      },
    };

    worker.postMessage({ type: "init", model, threads });
  });
}
