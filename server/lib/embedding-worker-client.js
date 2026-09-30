// server/lib/embedding-worker-client.js
//
// Parent side of workers/embedding-worker.js (a child process — see that file
// for why not a worker thread). One child, requests matched by id, a
// per-request timeout, and failure of every pending request if the child
// dies.
//
// Lifetime: the child (and its IPC channel) is referenced only while startup
// or a request is outstanding, and unreferenced when idle, so it never keeps
// the server — or a test run — alive on its own, yet a caller awaiting it is
// never stranded by the event loop winding down first. The child is killed
// when this process exits.

import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEFAULT_WORKER = new URL("../workers/embedding-worker.js", import.meta.url);

/**
 * Start the child and load the model in it.
 * @returns {Promise<{ embed(text: string): Promise<Float32Array>, terminate(): Promise<void>, pending(): number }>}
 *   Rejects if the child can't start or the model fails to load.
 */
export function startEmbeddingWorker({
  model = "Xenova/all-MiniLM-L6-v2",
  threads = 2,
  initTimeoutMs = 180_000,
  requestTimeoutMs = 60_000,
  workerUrl = DEFAULT_WORKER,
} = {}) {
  const child = fork(fileURLToPath(workerUrl), [], {
    serialization: "advanced", // Float32Array crosses IPC intact
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const killOnExit = () => { try { child.kill(); } catch { /* already gone */ } };
  process.once("exit", killOnExit);

  const pending = new Map(); // id -> { resolve, reject, timer }
  let nextId = 1;
  let starting = true;
  let dead = null;

  const hold = () => { child.ref(); child.channel?.ref?.(); };
  const release = () => {
    if (starting || pending.size > 0) return;
    child.unref(); child.channel?.unref?.();
  };
  hold();

  const failAll = (err) => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(err); }
    pending.clear();
  };
  const markDead = (err) => {
    if (dead) return;
    dead = err;
    starting = false;
    process.removeListener("exit", killOnExit);
    failAll(err);
  };

  return new Promise((resolveReady, rejectReady) => {
    const initTimer = setTimeout(() => {
      rejectReady(new Error("embedding_worker_init_timeout"));
      killOnExit();
    }, initTimeoutMs);

    child.on("message", (msg) => {
      if (msg?.type === "ready") {
        clearTimeout(initTimer);
        starting = false;
        release();
        resolveReady(client);
      } else if (msg?.type === "init_error") {
        clearTimeout(initTimer);
        rejectReady(new Error(msg.error || "embedding_worker_init_failed"));
        killOnExit();
      } else if (msg?.type === "result" || msg?.type === "error") {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.type === "result") p.resolve(msg.embedding);
        else p.reject(new Error(msg.error || "embedding_failed"));
        release();
      }
    });
    child.on("error", (err) => {
      clearTimeout(initTimer);
      markDead(err);
      rejectReady(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(initTimer);
      const err = dead || new Error(`embedding_worker_exited_${code ?? signal}`);
      markDead(err);
      rejectReady(err);
    });

    const client = {
      embed(text) {
        if (dead) return Promise.reject(dead);
        return new Promise((resolve, reject) => {
          const id = nextId++;
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(new Error("embedding_timeout"));
            release();
          }, requestTimeoutMs);
          pending.set(id, { resolve, reject, timer });
          hold();
          child.send({ type: "embed", id, text: String(text) });
        });
      },
      pending: () => pending.size,
      terminate() {
        if (dead && child.exitCode !== null) return Promise.resolve();
        markDead(new Error("embedding_worker_terminated"));
        return new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            resolve();
            return;
          }
          child.once("exit", () => resolve());
          killOnExit();
        });
      },
    };

    child.send({ type: "init", model, threads });
  });
}
