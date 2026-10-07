// An opened trace is stored in cognition_traces. Clearing the in-memory
// cognitionLens (what a process restart does) still lists that title and
// getExport returns the same trace body. Mode is read from the stored
// trace. A delete removes the row, so a restart does not bring it back.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCognitionMacros from "../domains/cognition.js";
import { up, down } from "../migrations/461_cognition_traces.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`cognition.${name}`);
  assert.ok(fn, `cognition.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCognitionMacros(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, cognitionLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_trace" }, userId: "user_trace", db };
const trace = {
  traceId: "hlr_door",
  input: { question: "What did the door hinge on?", mode: "abductive" },
};

describe("cognition trace restart", () => {
  it("lists the title and opens the same trace after the in-memory lens is dropped", () => {
    const created = call("exportTrace", ctx, { title: "  Door trace  ", note: "keep", trace });
    assert.equal(created.ok, true);
    const id = created.result.exportId;
    assert.equal(created.result.export.title, "Door trace");
    const row = db.prepare("SELECT title, trace_json FROM cognition_traces WHERE id = ?").get(id);
    assert.equal(row.title, "Door trace");
    assert.equal(JSON.parse(row.trace_json).traceId, "hlr_door");

    globalThis._concordSTATE = { db, cognitionLens: {} };
    const list = call("listExports", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.exports[0].id, id);
    assert.equal(list.result.exports[0].title, "Door trace");
    assert.equal(list.result.exports[0].mode, "abductive");
    assert.equal(list.result.exports[0].traceId, "hlr_door");
    const detail = call("getExport", ctx, { exportId: id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.export.trace.input.question, "What did the door hinge on?");
    assert.equal(detail.result.export.mode, "abductive");
  });

  it("a missing trace is rejected and stores nothing", () => {
    const created = call("exportTrace", ctx, { title: "Empty" });
    assert.equal(created.ok, false);
    assert.equal(created.error, "trace_required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM cognition_traces").get().n, 0);
  });

  it("a deleted trace stays gone after the in-memory lens is dropped", () => {
    const created = call("exportTrace", ctx, { title: "Gone", trace });
    const id = created.result.exportId;
    const deleted = call("deleteExport", ctx, { exportId: id });
    assert.equal(deleted.ok, true);
    globalThis._concordSTATE = { db, cognitionLens: {} };
    const list = call("listExports", ctx, {});
    assert.equal(list.result.count, 0);
    assert.equal(call("getExport", ctx, { exportId: id }).error, "export_not_found");
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cognition_traces'").get(),
      undefined,
    );
  });
});
