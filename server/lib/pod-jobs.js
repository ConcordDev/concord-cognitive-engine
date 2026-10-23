// server/lib/pod-jobs.js
// Pull-based pod job queue: pure, in-memory, injectable clock.
// Dark-launched — completely OFF unless CONCORD_POD_JOBS=1 and a token is set.

import crypto from "node:crypto";

const PAYLOAD_LIMIT = 256 * 1024;

export function createPodJobQueue({
  now = Date.now,
  leaseMs = 60000,
  maxQueued = 500,
  workerStaleMs = 60000,
} = {}) {
  let lastWorkerSeenAt = 0;
  const workers = new Map(); // workerId -> { lastSeenMs, info }
  const jobs = new Map();    // id -> job
  const pending = new Map(); // id -> { resolve, timeoutId }
  let completed = 0;
  let failed = 0;
  let timedOut = 0;

  function hasWorker() {
    return now() - lastWorkerSeenAt < workerStaleMs;
  }

  function markWorkerSeen(workerId, info = {}) {
    const t = now();
    lastWorkerSeenAt = t;
    const existing = workers.get(workerId);
    workers.set(workerId, {
      lastSeenMs: t,
      info: { ...(existing?.info || {}), ...info },
    });
  }

  function settle(id, result) {
    const p = pending.get(id);
    if (p) {
      clearTimeout(p.timeoutId);
      pending.delete(id);
      p.resolve(result);
    }
  }

  function enqueue(kind, payload, { timeoutMs = 30000 } = {}) {
    return new Promise((resolve) => {
      try {
        if (!hasWorker()) {
          resolve({ ok: false, error: "pod_worker_unavailable" });
          return;
        }

        if (jobs.size >= maxQueued) {
          resolve({ ok: false, error: "pod_queue_full" });
          return;
        }

        if (JSON.stringify(payload).length > PAYLOAD_LIMIT) {
          resolve({ ok: false, error: "pod_payload_too_large" });
          return;
        }

        const id = crypto.randomUUID();
        const enqueuedAt = now();
        const job = {
          id,
          kind,
          payload,
          state: "queued",
          attempts: 0,
          enqueuedAt,
          leasedAt: null,
          leaseUntil: null,
          workerId: null,
        };
        jobs.set(id, job);

        const timeoutId = setTimeout(() => {
          timedOut++;
          settle(id, { ok: false, error: "pod_job_timeout" });
          jobs.delete(id);
        }, timeoutMs);
        timeoutId.unref?.();

        pending.set(id, { resolve, timeoutId });
      } catch (err) {
        // enqueue never rejects; any unexpected error returns an internal failure.
        resolve({ ok: false, error: "pod_enqueue_failed", reason: String(err?.message || err) });
      }
    });
  }

  function claim(workerId, kinds = [], max = 4) {
    markWorkerSeen(workerId);

    const matched = [];
    for (const job of jobs.values()) {
      if (job.state !== "queued") continue;
      if (!kinds.includes(job.kind)) continue;
      matched.push(job);
    }

    matched.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
    const picked = matched.slice(0, Math.max(0, Math.min(Number(max) || 4, 32)));
    const t = now();

    return picked.map((job) => {
      job.state = "leased";
      job.leasedAt = t;
      job.leaseUntil = t + leaseMs;
      job.workerId = workerId;
      return {
        id: job.id,
        kind: job.kind,
        payload: job.payload,
        leaseUntil: job.leaseUntil,
      };
    });
  }

  function complete(id, workerId, { ok, result, error }) {
    const job = jobs.get(id);
    if (!job) return false;
    if (job.state !== "leased" || job.workerId !== workerId) return false;

    jobs.delete(id);
    if (ok) {
      completed++;
      settle(id, { ok: true, result });
    } else {
      failed++;
      settle(id, { ok: false, error });
    }
    return true;
  }

  function heartbeat(workerId, info = {}) {
    markWorkerSeen(workerId, info);
  }

  function sweep() {
    const t = now();
    const expired = [];
    for (const job of jobs.values()) {
      if (job.state === "leased" && job.leaseUntil != null && t > job.leaseUntil) {
        expired.push(job);
      }
    }

    for (const job of expired) {
      job.attempts++;
      if (job.attempts >= 3) {
        jobs.delete(job.id);
        failed++;
        settle(job.id, { ok: false, error: "pod_job_failed_attempts" });
      } else {
        job.state = "queued";
        job.leasedAt = null;
        job.leaseUntil = null;
        job.workerId = null;
      }
    }
  }

  function stats() {
    let queued = 0;
    let leased = 0;
    for (const job of jobs.values()) {
      if (job.state === "queued") queued++;
      else if (job.state === "leased") leased++;
    }

    const workerList = [];
    for (const [id, w] of workers.entries()) {
      workerList.push({ id, lastSeenMs: w.lastSeenMs, info: w.info });
    }
    workerList.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    return {
      queued,
      leased,
      completed,
      failed,
      timedOut,
      workers: workerList,
    };
  }

  return {
    enqueue,
    claim,
    complete,
    heartbeat,
    sweep,
    stats,
  };
}

export const podJobs = createPodJobQueue();
