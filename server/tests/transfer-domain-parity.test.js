// Tier-2 contract tests for the transfer lens — ETL parity macros
// (connectors, transformation pipeline, scheduled/incremental sync,
// mapping editor, validation rules, dry-run, run log, schema drift).
// Pins per-user scoping, input validation, and the never-throw invariant.

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
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

const CSV_SAMPLE = "id,name,email,age\n1,Alice,a@x.com,30\n2,Bob,b@x.com,bad\n3,,c@x.com,42";

function makeSource(ctx, payload = CSV_SAMPLE, kind = "csv") {
  return call("connector-upsert", ctx, { name: "src", role: "source", kind, payload }).result.connector;
}
function makeDest(ctx, kind = "json") {
  return call("connector-upsert", ctx, { name: "dst", role: "destination", kind, payload: kind === "json" ? "[]" : "" }).result.connector;
}

// ── Connectors ──────────────────────────────────────────────────────────

describe("transfer — connectors", () => {
  it("rejects connector with no name", () => {
    const r = call("connector-upsert", ctxA, { role: "source", kind: "csv" });
    assert.equal(r.ok, false);
  });

  it("creates a CSV connector and infers schema + row count", () => {
    const r = call("connector-upsert", ctxA, { name: "people", role: "source", kind: "csv", payload: CSV_SAMPLE });
    assert.equal(r.ok, true);
    assert.equal(r.result.connector.rowCount, 3);
    const names = r.result.connector.schema.map((f) => f.name).sort();
    assert.deepEqual(names, ["age", "email", "id", "name"]);
  });

  it("reads rows back out of a connector", () => {
    const c = makeSource(ctxA);
    const r = call("connector-read", ctxA, { id: c.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 3);
    assert.equal(r.result.rows[0].name, "Alice");
  });

  it("lists connectors scoped per-user", () => {
    makeSource(ctxA);
    makeDest(ctxA);
    makeSource(ctxB);
    const a = call("connector-list", ctxA);
    assert.equal(a.result.connectors.length, 2);
    assert.equal(a.result.sources, 1);
    assert.equal(a.result.destinations, 1);
    assert.equal(call("connector-list", ctxB).result.connectors.length, 1);
  });

  it("deletes a connector", () => {
    const c = makeSource(ctxA);
    assert.equal(call("connector-delete", ctxA, { id: c.id }).ok, true);
    assert.equal(call("connector-delete", ctxA, { id: c.id }).ok, false);
  });

  it("parses a JSON connector", () => {
    const c = call("connector-upsert", ctxA, { name: "j", role: "source", kind: "json", payload: '[{"x":1},{"x":2}]' });
    assert.equal(c.result.connector.rowCount, 2);
  });
});

// ── Pipelines + mapping editor ──────────────────────────────────────────

describe("transfer — pipelines + mapping editor", () => {
  it("rejects pipeline with no source connector", () => {
    assert.equal(call("pipeline-upsert", ctxA, { name: "p" }).ok, false);
  });

  it("creates a pipeline and lists it", () => {
    const src = makeSource(ctxA);
    const r = call("pipeline-upsert", ctxA, { name: "sync1", sourceConnectorId: src.id });
    assert.equal(r.ok, true);
    const list = call("pipeline-list", ctxA);
    assert.equal(list.result.pipelines.length, 1);
    assert.equal(list.result.pipelines[0].runCount, 0);
  });

  it("auto-suggests field mappings between source and target schemas", () => {
    const src = makeSource(ctxA);
    const pipe = call("pipeline-upsert", ctxA, { name: "p", sourceConnectorId: src.id }).result.pipeline;
    const r = call("mapping-suggest", ctxA, {
      pipelineId: pipe.id,
      targetSchema: [{ name: "name", type: "string" }, { name: "age", type: "number" }],
    });
    assert.equal(r.ok, true);
    const m = r.result.mappings.find((x) => x.target === "age");
    assert.ok(m, "age should be mapped");
    assert.equal(m.source, "age");
    // age is inferred string-ish from CSV → cast transform appears
    assert.ok(m.transforms.some((t) => t.type === "cast"));
  });

  it("deletes a pipeline", () => {
    const src = makeSource(ctxA);
    const pipe = call("pipeline-upsert", ctxA, { name: "p", sourceConnectorId: src.id }).result.pipeline;
    assert.equal(call("pipeline-delete", ctxA, { id: pipe.id }).ok, true);
  });
});

// ── Transformation + dry-run + validation ──────────────────────────────

describe("transfer — transforms, dry-run, validation rules", () => {
  it("dry-run applies mappings/transforms and flags validation failures", () => {
    const src = makeSource(ctxA);
    const pipe = call("pipeline-upsert", ctxA, {
      name: "p",
      sourceConnectorId: src.id,
      mappings: [
        { source: "name", target: "full_name", transforms: [{ type: "uppercase" }] },
        { source: "age", target: "age", transforms: [{ type: "cast", to: "number" }] },
      ],
      validationRules: [
        { type: "required", field: "full_name" },
        { type: "type", field: "age", dataType: "number" },
      ],
    }).result.pipeline;
    const r = call("dry-run", ctxA, { pipelineId: pipe.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.sampled, 3);
    assert.equal(r.result.preview[0].outputRow.full_name, "ALICE");
    // row 2 has age "bad" → cast yields null → type rule still passes (null skipped) but...
    // row 3 has empty name → required fails
    assert.equal(r.result.wouldQuarantine >= 1, true);
  });

  it("derived columns and concat transform work", () => {
    const src = makeSource(ctxA);
    const pipe = call("pipeline-upsert", ctxA, {
      name: "p",
      sourceConnectorId: src.id,
      mappings: [{ source: "id", target: "id" }],
      derivedColumns: [{ name: "label", from: "name", transforms: [{ type: "default", value: "anon" }] }],
    }).result.pipeline;
    const r = call("dry-run", ctxA, { pipelineId: pipe.id, sampleSize: 5 });
    assert.equal(r.ok, true);
    // row 3 has empty name → default kicks in
    const row3 = r.result.preview[2].outputRow;
    assert.equal(row3.label, "anon");
  });
});

// ── Sync execution + run log ────────────────────────────────────────────

describe("transfer — run-sync + run log", () => {
  it("runs a sync, writes good rows to destination, quarantines bad rows", () => {
    const src = makeSource(ctxA);
    const dst = makeDest(ctxA);
    const pipe = call("pipeline-upsert", ctxA, {
      name: "p",
      sourceConnectorId: src.id,
      destConnectorId: dst.id,
      mappings: [
        { source: "id", target: "id" },
        { source: "name", target: "name" },
        { source: "email", target: "email" },
      ],
      validationRules: [{ type: "required", field: "name" }],
    }).result.pipeline;
    const r = call("run-sync", ctxA, { pipelineId: pipe.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.run.rowsWritten, 2); // Alice, Bob (row3 has empty name)
    assert.equal(r.result.run.rowsQuarantined, 1);
    assert.equal(r.result.run.status, "partial");
    // destination connector actually received the rows
    const back = call("connector-read", ctxA, { id: dst.id });
    assert.equal(back.result.rowCount, 2);
  });

  it("run-log records the run with summary counts", () => {
    const src = makeSource(ctxA);
    const pipe = call("pipeline-upsert", ctxA, {
      name: "p",
      sourceConnectorId: src.id,
      mappings: [{ source: "id", target: "id" }],
    }).result.pipeline;
    call("run-sync", ctxA, { pipelineId: pipe.id });
    call("run-sync", ctxA, { pipelineId: pipe.id });
    const log = call("run-log", ctxA, { pipelineId: pipe.id });
    assert.equal(log.ok, true);
    assert.equal(log.result.summary.totalRuns, 2);
  });

  it("incremental sync only transfers rows past the CDC cursor", () => {
    const src = call("connector-upsert", ctxA, {
      name: "src", role: "source", kind: "inline",
      rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }],
    }).result.connector;
    const pipe = call("pipeline-upsert", ctxA, {
      name: "inc",
      sourceConnectorId: src.id,
      mappings: [{ source: "id", target: "id" }, { source: "name", target: "name" }],
      schedule: { mode: "incremental", cdcKey: "id" },
    }).result.pipeline;
    const r1 = call("run-sync", ctxA, { pipelineId: pipe.id });
    assert.equal(r1.result.run.rowsProcessed, 2);
    // add a new row past the cursor
    call("connector-upsert", ctxA, {
      id: src.id, name: "src", role: "source", kind: "inline",
      rows: [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }],
    });
    const r2 = call("run-sync", ctxA, { pipelineId: pipe.id });
    assert.equal(r2.result.run.rowsProcessed, 1);
    assert.equal(r2.result.run.mode, "incremental");
  });
});

// ── Scheduling + schema drift ───────────────────────────────────────────

describe("transfer — schedule-due + schema-drift", () => {
  it("schedule-due flags interval pipelines that are overdue", () => {
    const src = makeSource(ctxA);
    call("pipeline-upsert", ctxA, {
      name: "sched",
      sourceConnectorId: src.id,
      schedule: { mode: "interval", intervalMinutes: 30 },
    });
    const r = call("schedule-due", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.due.length, 1); // never run → due immediately
  });

  it("manual pipelines are never due", () => {
    const src = makeSource(ctxA);
    call("pipeline-upsert", ctxA, { name: "m", sourceConnectorId: src.id });
    assert.equal(call("schedule-due", ctxA, {}).result.due.length, 0);
  });

  it("schema-drift first snapshot then detects added/removed/type-changed fields", () => {
    const src = call("connector-upsert", ctxA, {
      name: "s", role: "source", kind: "inline",
      rows: [{ id: 1, name: "A" }],
    }).result.connector;
    const first = call("schema-drift", ctxA, { connectorId: src.id });
    assert.equal(first.ok, true);
    assert.equal(first.result.drift.firstSnapshot, true);
    assert.equal(first.result.drift.hasDrift, false);
    // mutate the connector schema
    call("connector-upsert", ctxA, {
      id: src.id, name: "s", role: "source", kind: "inline",
      rows: [{ id: 1, country: "US" }],
    });
    const second = call("schema-drift", ctxA, { connectorId: src.id });
    assert.equal(second.result.drift.hasDrift, true);
    assert.ok(second.result.drift.added.some((f) => f.field === "country"));
    assert.ok(second.result.drift.removed.some((f) => f.field === "name"));
  });

  it("schema-drift rejects an unknown connector", () => {
    assert.equal(call("schema-drift", ctxA, { connectorId: "nope" }).ok, false);
  });
});

// ── Original analysis macros still pass ─────────────────────────────────

describe("transfer — original analysis macros intact", () => {
  it("schemaMapping still maps source→target schemas", () => {
    const r = call("schemaMapping", ctxA, {}, {
      id: null,
      data: {
        sourceSchema: [{ name: "user_name", type: "string" }],
        targetSchema: [{ name: "username", type: "string" }],
      },
      meta: {},
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.mappingCount, 1);
  });

  it("dataQuality still grades a dataset", () => {
    const r = call("dataQuality", ctxA, {}, {
      id: null,
      data: { records: [{ a: 1 }, { a: 2 }] },
      meta: {},
    });
    assert.equal(r.ok, true);
    assert.ok(r.result.overallQuality.grade);
  });

  it("migrationPlan still sequences entities", () => {
    const r = call("migrationPlan", ctxA, {}, {
      id: null,
      data: { entities: [{ id: "a", name: "A" }, { id: "b", name: "B", dependencies: ["a"] }] },
      meta: {},
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.totalEntities, 2);
  });
});
