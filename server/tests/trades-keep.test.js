// tests/trades-keep.test.js — REAL end-to-end proof for the Trades lens
// keep-and-draft workflow. Mirrors the established pattern:
// create a real customer via `customer-upsert`, create a real job via
// `job-create`, read it back via `job-list`, save it as a private DTU via
// `dtu.create`, read that DTU back via `dtu.get`, then draft it in Thread
// via `thread.thread-draft` citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("trades keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("trades-keep-proof"); });

  it("creates a real customer + job, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real customer via the trades domain macro.
    const custR = await lensRun("trades", "customer-upsert", {
      params: { name: "Proof Customer", phone: "555-0100", email: "proof@test.invalid", address: "1 Main St" },
    }, ctx);
    assert.equal(custR.ok, true, "customer-upsert should succeed");
    const customer = custR.result.customer;
    assert.ok(customer.id, "customer should have an id");
    assert.equal(customer.name, "Proof Customer");

    // 2. Create a real job via the trades domain macro.
    const jobR = await lensRun("trades", "job-create", {
      params: {
        customerId: customer.id,
        description: "Install proof panel and wire the keep menu.",
        priority: "high",
        estimatedHours: 4,
      },
    }, ctx);
    assert.equal(jobR.ok, true, "job-create should succeed");
    const job = jobR.result.job;
    assert.ok(job.id, "job should have an id");
    assert.ok(/JOB-/.test(job.number), "job should have a JOB- number");
    assert.equal(job.customerName, "Proof Customer");
    assert.equal(job.priority, "high");

    // 3. Read the real job back via job-list (the same macro the UI uses).
    const listR = await lensRun("trades", "job-list", {}, ctx);
    assert.equal(listR.ok, true, "job-list should succeed");
    const back = listR.result.jobs.find((j) => j.id === job.id);
    assert.ok(back, "job-list should include the created job");
    assert.equal(back.number, job.number);
    assert.equal(back.description, "Install proof panel and wire the keep menu.");
    assert.equal(back.estimatedHours, 4);

    // 4. Save the job as a private DTU.
    const sentence = `${job.number} · ${job.customerName}: ${job.priority} ${job.status}, est 4h.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["trades", "job", "work-order"],
        source: "trades-lens:job-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "trades_job_report",
          jobId: job.id,
          number: job.number,
          customerName: job.customerName,
          priority: job.priority,
          status: job.status,
          estimatedHours: job.estimatedHours,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "trades" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 5. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 6. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: `Trades job — ${job.number}`,
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 7. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to create a job with no customer", async () => {
    const r = await lensRun("trades", "job-create", { params: { customerId: "", description: "x" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/customer/i.test(r.result.error), "should reject missing customer");
  });
});