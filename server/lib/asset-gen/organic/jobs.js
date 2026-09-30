// server/lib/asset-gen/organic/jobs.js
//
// Job wrapper around generateOrganicAsset so a macro can start a ~1-minute
// generation and return immediately. Jobs run ONE AT A TIME: the Hugging
// Face GPU quota is per account, so parallel jobs would only race each other
// into quota_exhausted, and the LOD pass is CPU work on the shared server.
//
// In-memory by design (bounded, newest kept): the durable record of a
// finished generation is the evo_assets row + ORGANIC_MANIFEST.json, not
// the job. A server restart drops queued jobs; it never drops results.

import crypto from "crypto";
import { generateOrganicAsset } from "./generate-organic.js";

const MAX_JOBS = 200;
const jobs = new Map();
const queue = [];
let running = null;

function trim() {
  while (jobs.size > MAX_JOBS) {
    const oldest = [...jobs.values()].find((j) => j.status === "done" || j.status === "failed");
    if (!oldest) break;
    jobs.delete(oldest.jobId);
  }
}

async function pump(db) {
  if (running || queue.length === 0) return;
  running = queue.shift();
  running.status = "running";
  running.startedAt = new Date().toISOString();
  try {
    const result = await generateOrganicAsset({
      id: running.id, seed: running.seed, db, plan: running.plan,
      onStage: (stage) => { running.stage = stage; },
    });
    running.result = result;
    running.status = result.ok ? "done" : "failed";
    // Quota is per account: everything still queued would fail the same way.
    if (result.reason === "quota_exhausted") {
      for (const j of queue.splice(0)) Object.assign(j, { status: "failed", result: { ok: false, id: j.id, reason: "quota_exhausted", skipped: true } });
    }
  } catch (err) {
    running.status = "failed";
    running.result = { ok: false, id: running.id, reason: "internal_error", error: String(err?.message || err) };
  } finally {
    running.finishedAt = new Date().toISOString();
    running = null;
    trim();
    setImmediate(() => { pump(db).catch(() => {}); });
  }
}

export function startOrganicJob({ id, seed = 0, db, plan = null }) {
  // Ad-hoc requests (a `plan` from planForPrompt) carry a synthetic id minted
  // fresh per call — there's no stable key to dedupe free text on, so this
  // check is bible-id-only (plan === null).
  if (!plan) {
    const existing = [...jobs.values()].find((j) => j.id === id && j.seed === seed && (j.status === "queued" || j.status === "running"));
    if (existing) return { ok: true, jobId: existing.jobId, status: existing.status, deduped: true };
  }
  const job = { jobId: crypto.randomUUID(), id, seed, status: "queued", stage: null, queuedAt: new Date().toISOString(), plan };
  jobs.set(job.jobId, job);
  queue.push(job);
  pump(db).catch(() => {});
  return { ok: true, jobId: job.jobId, status: job.status, position: queue.indexOf(job) + (running ? 1 : 0) };
}

export function getOrganicJob(jobId) {
  const j = jobs.get(jobId);
  return j ? { ok: true, ...j } : { ok: false, reason: "unknown_job" };
}

export function listOrganicJobs() {
  return [...jobs.values()].map(({ jobId, id, status, stage, queuedAt, finishedAt, result }) =>
    ({ jobId, id, status, stage, queuedAt, finishedAt, reason: result?.reason, ok: result?.ok }));
}
