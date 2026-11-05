// Build tests for the Transfer lens build (S-TR-2): incremental dedup.
// Same registry harness shape as transfer-domain-parity.test.js. Full-mode
// behaviour is pinned by the parity suite and must not move; these tests
// pin the incremental contract: a re-run over unchanged data writes 0 and
// receipts it, duplicates are counted as skipped, and the destination's
// distinct row count rides the run record.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTransferActions from "../domains/transfer.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}, artifact) {
  const fn = ACTIONS.get(`transfer.${name}`);
  if (!fn) throw new Error(`transfer.${name} not registered`);
  return fn(ctx, artifact || { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerTransferActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const CSV_SAMPLE = "id,name\n1,Alice\n2,Bob";

function makePipeline(ctx, extra = {}) {
  const src = call("connector-upsert", ctx, { name: "src", role: "source", kind: "csv", payload: CSV_SAMPLE }).result.connector;
  const dst = call("connector-upsert", ctx, { name: "dst", role: "destination", kind: "json", payload: "[]" }).result.connector;
  const pipe = call("pipeline-upsert", ctx, {
    name: "p",
    sourceConnectorId: src.id,
    destConnectorId: dst.id,
    mappings: [{ source: "id", target: "id" }, { source: "name", target: "name" }],
    ...extra,
  }).result.pipeline;
  return { src, dst, pipe };
}

describe("transfer build — incremental dedup (S-TR-2)", () => {
  it("a keyless incremental re-run over unchanged data writes 0 and receipts it", () => {
    const { dst, pipe } = makePipeline(ctxA);
    const r1 = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "incremental" });
    assert.equal(r1.result.run.mode, "incremental");
    assert.equal(r1.result.run.rowsWritten, 2);
    assert.equal(r1.result.run.rowsSkippedDuplicates, 0);
    assert.equal(r1.result.run.destinationRows, 2);

    const r2 = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "incremental" });
    assert.equal(r2.result.run.rowsWritten, 0);
    assert.equal(r2.result.run.rowsSkippedDuplicates, 2);
    assert.equal(r2.result.run.destinationRows, 2);
    assert.equal(r2.result.run.status, "success");
    const back = call("connector-read", ctxA, { id: dst.id });
    assert.equal(back.result.rowCount, 2);
  });

  it("an incremental run after a FULL run does not duplicate the destination (cursor gap backstop)", () => {
    const { dst, pipe } = makePipeline(ctxA);
    const full = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "full" });
    assert.equal(full.result.run.rowsWritten, 2);
    const inc = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "incremental" });
    assert.equal(inc.result.run.rowsWritten, 0);
    assert.equal(inc.result.run.rowsSkippedDuplicates, 2);
    const back = call("connector-read", ctxA, { id: dst.id });
    assert.equal(back.result.rowCount, 2);
  });

  it("new rows still move on the next incremental run; changed rows append (append-only, stated)", () => {
    const { src, dst, pipe } = makePipeline(ctxA);
    call("run-sync", ctxA, { pipelineId: pipe.id, mode: "incremental" });
    call("connector-upsert", ctxA, { id: src.id, name: "src", role: "source", kind: "csv", payload: "id,name\n1,Alice\n2,Bob\n3,Carol" });
    const r = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "incremental" });
    assert.equal(r.result.run.rowsWritten, 1);
    assert.equal(r.result.run.rowsSkippedDuplicates, 2);
    assert.equal(r.result.run.destinationRows, 3);
    const back = call("connector-read", ctxA, { id: dst.id });
    assert.equal(back.result.rowCount, 3);
  });

  it("full mode keeps its append semantics (the parity-pinned behaviour)", () => {
    const { dst, pipe } = makePipeline(ctxA);
    call("run-sync", ctxA, { pipelineId: pipe.id, mode: "full" });
    const r2 = call("run-sync", ctxA, { pipelineId: pipe.id, mode: "full" });
    assert.equal(r2.result.run.rowsWritten, 2);
    assert.equal(r2.result.run.rowsSkippedDuplicates, 0);
    assert.equal(r2.result.run.destinationRows, 4);
    const back = call("connector-read", ctxA, { id: dst.id });
    assert.equal(back.result.rowCount, 4);
  });

  it("the CDC cursor path still narrows candidates when a key is configured", () => {
    const src = call("connector-upsert", ctxA, {
      name: "src", role: "source", kind: "inline",
      rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    }).result.connector;
    const dst = call("connector-upsert", ctxA, { name: "dst", role: "destination", kind: "json", payload: "[]" }).result.connector;
    const pipe = call("pipeline-upsert", ctxA, {
      name: "inc",
      sourceConnectorId: src.id,
      destConnectorId: dst.id,
      mappings: [{ source: "id", target: "id" }, { source: "name", target: "name" }],
      schedule: { mode: "incremental", cdcKey: "id" },
    }).result.pipeline;
    const r1 = call("run-sync", ctxA, { pipelineId: pipe.id });
    assert.equal(r1.result.run.rowsProcessed, 2);
    assert.equal(r1.result.run.rowsWritten, 2);
    call("connector-upsert", ctxA, {
      id: src.id, name: "src", role: "source", kind: "inline",
      rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }],
    });
    const r2 = call("run-sync", ctxA, { pipelineId: pipe.id });
    assert.equal(r2.result.run.rowsProcessed, 1);
    assert.equal(r2.result.run.rowsWritten, 1);
    assert.equal(r2.result.run.destinationRows, 3);
  });
});
