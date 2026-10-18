// scripts/pod-worker.mjs
// Standalone Node worker that pulls CPU jobs from the Mac backend over an
// SSH reverse tunnel and posts results back. No npm dependencies.
//
// Env:
//   CONCORD_JOB_API           default http://127.0.0.1:5051/api/internal/pod-jobs
//   CONCORD_POD_JOB_TOKEN     required, never logged
//   POD_WORKER_ID             default os.hostname()
//   POD_WORKER_KINDS          default "echo,sha256"
//   POD_WORKER_CONCURRENCY    default 4

import crypto from "node:crypto";
import os from "node:os";
import { pathToFileURL } from "node:url";

export const HANDLERS = {
  echo(payload) {
    return payload;
  },

  sha256({ text, rounds = 1 }) {
    if (typeof text !== "string") {
      throw new TypeError("sha256 requires a string 'text'");
    }
    let n = Number.isFinite(rounds) ? Math.max(1, Math.min(Number(rounds), 100000)) : 1;
    let digest = text;
    for (let i = 0; i < n; i++) {
      digest = crypto.createHash("sha256").update(digest).digest("hex");
    }
    return { hex: digest };
  },
};

export default HANDLERS;

const API_URL = process.env.CONCORD_JOB_API || "http://127.0.0.1:5051/api/internal/pod-jobs";
const TOKEN = process.env.CONCORD_POD_JOB_TOKEN;
const WORKER_ID = process.env.POD_WORKER_ID || os.hostname();
const KINDS = String(process.env.POD_WORKER_KINDS || "echo,sha256")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);
const CONCURRENCY = Math.max(1, Math.min(Number(process.env.POD_WORKER_CONCURRENCY) || 4, 16));

async function api(method, body) {
  const res = await fetch(API_URL + (method === "claim" ? "/claim" : method === "complete" ? "/complete" : "/heartbeat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function runOneJob(job) {
  const start = Date.now();
  const handler = HANDLERS[job.kind];
  let ok = true;
  let result;
  let error;
  try {
    result = await handler(job.payload);
  } catch (err) {
    ok = false;
    error = String(err?.message || err);
  }
  const ms = Date.now() - start;
  try {
    await api("complete", { id: job.id, workerId: WORKER_ID, ok, result, error });
  } catch (err) {
    // If completion fails, still log the local outcome; the server will requeue.
    error = error || String(err?.message || err);
    ok = false;
  }
  console.log(JSON.stringify({ id: job.id, kind: job.kind, ms, ok }));
}

async function doHeartbeat() {
  try {
    await api("heartbeat", { workerId: WORKER_ID, info: { kinds: KINDS, concurrency: CONCURRENCY } });
  } catch (err) {
    // Heartbeat failures are logged only at debug level; they are expected during backoff.
    if (process.env.NODE_ENV !== "test") {
      console.error(JSON.stringify({ event: "heartbeat_failed", error: String(err?.message || err) }));
    }
  }
}

async function main() {
  if (!TOKEN) {
    console.error(JSON.stringify({ event: "missing_token", message: "Set CONCORD_POD_JOB_TOKEN" }));
    process.exit(1);
  }

  let running = true;
  let backoffMs = 1000;
  const maxBackoffMs = 30000;

  const heartbeatTimer = setInterval(() => {
    doHeartbeat().catch(() => {});
  }, 15000);

  process.on("SIGTERM", () => {
    running = false;
    clearInterval(heartbeatTimer);
  });

  await doHeartbeat();

  while (running) {
    try {
      const data = await api("claim", { workerId: WORKER_ID, kinds: KINDS, max: CONCURRENCY });
      const jobs = Array.isArray(data?.jobs) ? data.jobs : [];

      if (jobs.length === 0) {
        await sleep(1000);
      } else {
        // Run up to CONCURRENCY jobs concurrently, then claim again.
        for (let i = 0; i < jobs.length; i += CONCURRENCY) {
          const slice = jobs.slice(i, i + CONCURRENCY);
          await Promise.all(slice.map((job) => runOneJob(job)));
        }
      }

      // Successful round resets backoff.
      backoffMs = 1000;
    } catch (err) {
      console.error(JSON.stringify({ event: "poll_failed", error: String(err?.message || err), backoffMs }));
      await sleep(backoffMs);
      backoffMs = Math.min(maxBackoffMs, backoffMs * 2);
    }
  }

  // Allow in-flight jobs to finish before exit.
  await sleep(500);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(JSON.stringify({ event: "fatal", error: String(err?.message || err) }));
    process.exit(1);
  });
}
