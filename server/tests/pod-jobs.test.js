import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import { createPodJobsRouter, podJobsEnabled } from "../routes/pod-jobs.js";
import { createPodJobQueue } from "../lib/pod-jobs.js";
import HANDLERS from "../../scripts/pod-worker.mjs";

const TOKEN = "a".repeat(32);

function makeQueue(initialTime = 1000) {
  let t = initialTime;
  const q = createPodJobQueue({
    now: () => t,
    leaseMs: 50,
    maxQueued: 10,
    workerStaleMs: 1000,
  });
  q._time = (delta = 0) => { t += delta; };
  return q;
}

async function withServer(queue, token = TOKEN, fn) {
  const app = express();
  app.use(createPodJobsRouter({ queue, token }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  try {
    return await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function post(base, path, body, headers = {}) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text(); let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; } return { status: res.status, body: parsed };
}

async function get(base, path, headers = {}) {
  const res = await fetch(`${base}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe("pod job queue", () => {
  it("reports unavailable when no worker has been seen", async () => {
    const q = makeQueue();
    const r = await q.enqueue("echo", { x: 1 });
    assert.deepEqual(r, { ok: false, error: "pod_worker_unavailable" });
  });

  it("resolves a result after enqueue + claim + complete", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const p = q.enqueue("echo", { x: 1 });
    const jobs = q.claim("w1", ["echo"], 4);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "echo");
    const accepted = q.complete(jobs[0].id, "w1", { ok: true, result: { received: { x: 1 } } });
    assert.equal(accepted, true);
    const r = await p;
    assert.deepEqual(r, { ok: true, result: { received: { x: 1 } } });
  });

  it("filters claim by kind", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const pa = q.enqueue("a", { n: 1 });
    const pb = q.enqueue("b", { n: 2 });
    const jobs = q.claim("w1", ["a"], 4);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].kind, "a");
    q.complete(jobs[0].id, "w1", { ok: true, result: "a-done" });
    // Also grab the remaining b job so the pending promises do not time out in the test runner.
    const bJobs = q.claim("w1", ["b"], 4);
    q.complete(bJobs[0].id, "w1", { ok: true, result: "b-done" });
    assert.equal((await pa).ok, true);
    assert.equal((await pb).ok, true);
  });

  it("rejects complete by the wrong worker", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const p = q.enqueue("echo", {});
    const jobs = q.claim("w1", ["echo"], 4);
    const accepted = q.complete(jobs[0].id, "w2", { ok: true, result: {} });
    assert.equal(accepted, false);
    // Correct worker can still complete it.
    assert.equal(q.complete(jobs[0].id, "w1", { ok: true, result: "done" }), true);
    const r = await p;
    assert.deepEqual(r, { ok: true, result: "done" });
  });

  it("re-queues expired leases then fails after 3 attempts", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const p = q.enqueue("echo", {}, { timeoutMs: 100000 });

    for (let attempt = 1; attempt <= 3; attempt++) {
      const jobs = q.claim("w1", ["echo"], 4);
      assert.equal(jobs.length, 1);
      q._time(60); // past leaseMs=50
      q.sweep();
    }

    const r = await p;
    assert.deepEqual(r, { ok: false, error: "pod_job_failed_attempts" });
    assert.equal(q.stats().failed, 1);
  });

  it("times out a job that is never completed", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const p = q.enqueue("echo", {}, { timeoutMs: 5 });
    const r = await p;
    assert.deepEqual(r, { ok: false, error: "pod_job_timeout" });
    assert.equal(q.stats().timedOut, 1);
  });

  it("refuses enqueue when the queue is full", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(q.enqueue("echo", { i }, { timeoutMs: 100000 }));
    }
    const r = await q.enqueue("echo", { overflow: true });
    assert.deepEqual(r, { ok: false, error: "pod_queue_full" });
    // Settle the queued jobs so they do not outlive the test file.
    const jobs = q.claim("w1", ["echo"], 10);
    for (const job of jobs) {
      q.complete(job.id, "w1", { ok: true, result: "done" });
    }
    await Promise.all(promises);
  });

  it("rejects payloads larger than 256 KB", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const huge = { data: "x".repeat(256 * 1024) };
    const r = await q.enqueue("echo", huge);
    assert.deepEqual(r, { ok: false, error: "pod_payload_too_large" });
  });
});

describe("pod jobs router", () => {
  it("returns 401 for a bad token", async () => {
    const q = makeQueue();
    await withServer(q, TOKEN, async (base) => {
      const res = await post(base, "/claim", { workerId: "w1", kinds: ["echo"], max: 4 }, { Authorization: "Bearer " + "b".repeat(32) });
      assert.equal(res.status, 401);
      assert.equal(res.body?.error, "unauthorized");
    });
  });

  it("returns 404 when public proxy headers are present", async () => {
    const q = makeQueue();
    await withServer(q, TOKEN, async (base) => {
      for (const h of ["x-forwarded-for", "cf-ray"]) {
        const res = await post(base, "/claim", { workerId: "w1", kinds: ["echo"], max: 4 }, {
          Authorization: `Bearer ${TOKEN}`,
          [h]: "1.2.3.4",
        });
        assert.equal(res.status, 404, `expected 404 for ${h}`);
      }
    });
  });

  it("round-trips claim and complete with the right token", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    const p = q.enqueue("echo", { hello: true }, { timeoutMs: 100000 });
    await withServer(q, TOKEN, async (base) => {
      const claim = await post(base, "/claim", { workerId: "w1", kinds: ["echo"], max: 4 }, { Authorization: `Bearer ${TOKEN}` });
      assert.equal(claim.status, 200);
      assert.equal(claim.body.jobs.length, 1);
      const job = claim.body.jobs[0];
      const complete = await post(base, "/complete", {
        id: job.id,
        workerId: "w1",
        ok: true,
        result: { echoed: job.payload },
      }, { Authorization: `Bearer ${TOKEN}` });
      assert.equal(complete.status, 200);
      assert.equal(complete.body.accepted, true);
    });
    const r = await p;
    assert.equal(r.ok, true);
    assert.deepEqual(r.result, { echoed: { hello: true } });
  });

  it("returns stats via GET /stats", async () => {
    const q = makeQueue();
    q.heartbeat("w1");
    q.enqueue("echo", { x: 1 }, { timeoutMs: 100000 });
    await withServer(q, TOKEN, async (base) => {
      const res = await get(base, "/stats", { Authorization: `Bearer ${TOKEN}` });
      assert.equal(res.status, 200);
      assert.equal(res.body.queued, 1);
      assert.equal(res.body.workers.length, 1);
      assert.equal(res.body.workers[0].id, "w1");
    });
  });

  it("exposes podJobsEnabled rules", () => {
    const e = {};
    assert.equal(podJobsEnabled(e), false);
    e.CONCORD_POD_JOBS = "1";
    assert.equal(podJobsEnabled(e), false);
    e.CONCORD_POD_JOB_TOKEN = "short";
    assert.equal(podJobsEnabled(e), false);
    e.CONCORD_POD_JOB_TOKEN = "a".repeat(32);
    assert.equal(podJobsEnabled(e), true);
  });
});

describe("pod worker handlers", () => {
  it("echo returns the payload", () => {
    assert.deepEqual(HANDLERS.echo({ a: 1 }), { a: 1 });
  });

  it("sha256 matches the known vector for abc", () => {
    const r = HANDLERS.sha256({ text: "abc" });
    assert.equal(r.hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("sha256 caps rounds", () => {
    assert.doesNotThrow(() => HANDLERS.sha256({ text: "x", rounds: 999999 }));
  });
});
