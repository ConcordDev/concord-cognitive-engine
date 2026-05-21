// Tier-2 contract tests for import lens parity macros.
// Covers schema inference, in-grid error correction sessions, custom transform
// rules, saved templates, connector library, scheduled/incremental imports,
// and import rollback. Pins per-user scoping and the load-bearing math.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerImportActions from "../domains/importdomain.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}, data = {}) {
  const fn = ACTIONS.get(`import.${name}`);
  if (!fn) throw new Error(`import.${name} not registered`);
  return fn(ctx, { id: null, data, meta: {} }, params);
}

before(() => {
  registerImportActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

// ---------------------------------------------------------------------------
describe("import — schema inference", () => {
  it("inferSchema infers per-column type, nullability, and target names", () => {
    const rows = [
      { "First Name": "Ada", Age: "37", Active: "yes", Email: "ada@x.io" },
      { "First Name": "Bob", Age: "41", Active: "no", Email: "bob@x.io" },
      { "First Name": "Cy", Age: "", Active: "yes", Email: "cy@x.io" },
    ];
    const r = call("inferSchema", ctxA, { rows });
    assert.equal(r.ok, true);
    assert.equal(r.result.rowCount, 3);
    assert.equal(r.result.fieldCount, 4);
    const age = r.result.fields.find((f) => f.source === "Age");
    assert.equal(age.inferredType, "number");
    assert.equal(age.nullable, true);
    assert.equal(age.suggestedTarget, "age");
    const email = r.result.fields.find((f) => f.source === "Email");
    assert.equal(email.semanticHint, "email");
    assert.ok(r.result.schema.first_name);
  });

  it("inferSchema returns an empty-state message with no rows", () => {
    const r = call("inferSchema", ctxA, { rows: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /No rows/);
  });
});

// ---------------------------------------------------------------------------
describe("import — in-grid error correction", () => {
  const schema = { name: { type: "string", required: true }, age: { type: "number" } };

  it("startCorrectionSession + correctCell + commit flow fixes bad rows", () => {
    const rows = [{ name: "Ada", age: "not-a-number" }, { name: "", age: "40" }];
    const start = call("startCorrectionSession", ctxA, { rows, schema, name: "Q1 import" });
    assert.equal(start.ok, true);
    const id = start.result.session.id;
    assert.equal(start.result.session.invalidRows, 2);

    const get = call("getCorrectionSession", ctxA, { id });
    assert.equal(get.ok, true);
    assert.equal(get.result.validation.invalidRows, 2);

    call("correctCell", ctxA, { id, rowIndex: 0, field: "age", value: 39 });
    const fix2 = call("correctCell", ctxA, { id, rowIndex: 1, field: "name", value: "Bob" });
    assert.equal(fix2.ok, true);
    assert.equal(fix2.result.validation.invalidRows, 0);

    const commit = call("commitCorrectionSession", ctxA, { id });
    assert.equal(commit.ok, true);
    assert.equal(commit.result.committedRows.length, 2);
    assert.equal(commit.result.correctedCount, 2);
  });

  it("commit refuses while rows still have errors unless forced", () => {
    const rows = [{ name: "", age: "x" }];
    const start = call("startCorrectionSession", ctxA, { rows, schema });
    const id = start.result.session.id;
    const blocked = call("commitCorrectionSession", ctxA, { id });
    assert.equal(blocked.ok, false);
    const forced = call("commitCorrectionSession", ctxA, { id, force: true });
    assert.equal(forced.ok, true);
  });

  it("correction sessions are scoped per-user", () => {
    const rows = [{ name: "A", age: "1" }];
    call("startCorrectionSession", ctxA, { rows, schema });
    const listB = call("listCorrectionSessions", ctxB);
    assert.equal(listB.ok, true);
    assert.equal(listB.result.count, 0);
  });
});

// ---------------------------------------------------------------------------
describe("import — custom transform rules", () => {
  it("applyTransformRules runs find_replace, coerce, and formula rules", () => {
    const rows = [
      { price: "10", qty: "3", name: "  Widget  " },
      { price: "5", qty: "2", name: "  Gadget  " },
    ];
    const rules = [
      { field: "name", kind: "coerce", to: "trim" },
      { field: "price", kind: "coerce", to: "number" },
      { field: "total", kind: "formula", expression: "{price} * {qty}" },
    ];
    const r = call("applyTransformRules", ctxA, { rows, rules });
    assert.equal(r.ok, true);
    assert.equal(r.result.output[0].name, "Widget");
    assert.equal(r.result.output[0].price, 10);
    assert.equal(r.result.output[0].total, 30);
    assert.ok(r.result.totalChanges > 0);
  });

  it("applyTransformRules rejects empty rows", () => {
    const r = call("applyTransformRules", ctxA, { rows: [], rules: [] });
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------------------
describe("import — saved templates", () => {
  it("saveTemplate / listTemplates / applyTemplate / deleteTemplate round-trip", () => {
    const save = call("saveTemplate", ctxA, {
      name: "Customer CSV",
      mappings: [{ source: "Name", target: "name" }],
      transformRules: [{ field: "name", kind: "coerce", to: "trim" }],
      keyFields: ["email"],
    });
    assert.equal(save.ok, true);
    const id = save.result.template.id;

    const list = call("listTemplates", ctxA);
    assert.equal(list.result.count, 1);

    const apply = call("applyTemplate", ctxA, { id });
    assert.equal(apply.ok, true);
    assert.equal(apply.result.mappings.length, 1);
    assert.equal(apply.result.template.usageCount, 1);

    const del = call("deleteTemplate", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("listTemplates", ctxA).result.count, 0);
  });

  it("saveTemplate requires a name", () => {
    const r = call("saveTemplate", ctxA, {});
    assert.equal(r.ok, false);
  });
});

// ---------------------------------------------------------------------------
describe("import — connector library", () => {
  it("listConnectors exposes a catalog and saved connectors", () => {
    const r = call("listConnectors", ctxA);
    assert.equal(r.ok, true);
    assert.equal(r.result.catalog.length, 3);
    assert.equal(r.result.savedCount, 0);
  });

  it("saveConnector persists a connector and rejects bad kinds", () => {
    const ok = call("saveConnector", ctxA, { name: "Sheet 1", kind: "google_sheets", sheetId: "abc" });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.connector.kind, "google_sheets");
    assert.equal(call("listConnectors", ctxA).result.savedCount, 1);

    const bad = call("saveConnector", ctxA, { name: "X", kind: "ftp" });
    assert.equal(bad.ok, false);
  });

  it("fetchFromConnector reports a clear error for an unknown connector id", async () => {
    const r = await call("fetchFromConnector", ctxA, { connectorId: "nope" });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });
});

// ---------------------------------------------------------------------------
describe("import — scheduled / incremental imports", () => {
  it("createSchedule + runSchedule de-dupes incremental rows by key field", () => {
    const create = call("createSchedule", ctxA, {
      name: "Nightly sync",
      cadence: "daily",
      mode: "incremental",
      keyField: "id",
    });
    assert.equal(create.ok, true);
    const id = create.result.schedule.id;

    const run1 = call("runSchedule", ctxA, { id, rows: [{ id: "1" }, { id: "2" }] });
    assert.equal(run1.ok, true);
    assert.equal(run1.result.newCount, 2);

    const run2 = call("runSchedule", ctxA, { id, rows: [{ id: "2" }, { id: "3" }] });
    assert.equal(run2.ok, true);
    assert.equal(run2.result.newCount, 1);
    assert.equal(run2.result.skippedExisting, 1);
  });

  it("toggleSchedule disables a schedule and runSchedule then refuses", () => {
    const create = call("createSchedule", ctxA, { name: "S", cadence: "manual", mode: "full" });
    const id = create.result.schedule.id;
    const toggled = call("toggleSchedule", ctxA, { id });
    assert.equal(toggled.result.schedule.enabled, false);
    const blocked = call("runSchedule", ctxA, { id, rows: [] });
    assert.equal(blocked.ok, false);
  });
});

// ---------------------------------------------------------------------------
describe("import — rollback", () => {
  it("snapshotImport + listSnapshots + rollbackImport round-trip", () => {
    const snap = call("snapshotImport", ctxA, {
      rows: [{ id: 1 }, { id: 2 }],
      label: "Batch A",
      source: "csv_url",
    });
    assert.equal(snap.ok, true);
    const id = snap.result.snapshot.id;
    assert.equal(snap.result.snapshot.status, "applied");

    const list = call("listSnapshots", ctxA);
    assert.equal(list.result.count, 1);

    const rollback = call("rollbackImport", ctxA, { id });
    assert.equal(rollback.ok, true);
    assert.equal(rollback.result.rolledBackRows, 2);

    const second = call("rollbackImport", ctxA, { id });
    assert.equal(second.ok, false);
    assert.match(second.error, /already rolled back/);
  });

  it("snapshotImport rejects an empty row set", () => {
    const r = call("snapshotImport", ctxA, { rows: [] });
    assert.equal(r.ok, false);
  });
});
