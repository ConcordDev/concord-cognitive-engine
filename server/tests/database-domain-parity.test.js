// Contract tests for server/domains/database.js — pure-compute macros
// plus the per-user connection manager + in-memory SQL engine substrate.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`database.${name}`);
  if (!fn) throw new Error(`database.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerDatabaseActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };

describe("database pure-compute macros", () => {
  it("schemaAnalysis flags a table with no primary key", () => {
    const r = call("schemaAnalysis", ctxA, { data: { tables: [{ name: "logs", columns: [
      { name: "a", type: "text" }, { name: "b", type: "text" }, { name: "c", type: "text" }, { name: "d", type: "text" },
    ] }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalIssues > 0, true);
    assert.equal(r.result.tables[0].hasPrimaryKey, false);
  });

  it("queryOptimize grades SELECT * as imperfect", () => {
    const r = call("queryOptimize", ctxA, { data: { query: "SELECT * FROM users" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.issueCount > 0, true);
  });

  it("migrationPlan marks DROP as high risk", () => {
    const r = call("migrationPlan", ctxA, { data: { changes: [{ type: "drop", table: "old", column: "x" }] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.highRiskChanges, 1);
  });

  it("indexRecommendation suggests a B-tree for a WHERE column", () => {
    const r = call("indexRecommendation", ctxA, { data: { queries: ["SELECT id FROM t WHERE status = 1"] } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestedIndexes >= 1, true);
  });
});

describe("database connection manager", () => {
  it("creates, lists, updates and deletes a connection", () => {
    const c = call("connection-create", ctxA, { name: "Prod", engine: "in-memory" });
    assert.equal(c.ok, true);
    assert.equal(c.result.connection.name, "Prod");
    const id = c.result.connection.id;

    const list = call("connection-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);

    const up = call("connection-update", ctxA, { id, name: "Prod2", readOnly: false });
    assert.equal(up.ok, true);
    assert.equal(up.result.connection.name, "Prod2");
    assert.equal(up.result.connection.readOnly, false);

    const test = call("connection-test", ctxA, { id });
    assert.equal(test.ok, true);
    assert.equal(test.result.connected, true);

    const del = call("connection-delete", ctxA, { id });
    assert.equal(del.ok, true);
    assert.equal(call("connection-list", ctxA, {}).result.count, 0);
  });

  it("rejects empty connection name", () => {
    assert.equal(call("connection-create", ctxA, { name: "" }).ok, false);
  });
});

describe("database datasets + result-grid editing", () => {
  function freshConn(readOnly = false) {
    const c = call("connection-create", ctxA, { name: "X", readOnly });
    return c.result.connection.id;
  }

  it("creates a dataset with typed columns", () => {
    const cid = freshConn();
    const ds = call("dataset-create", ctxA, { connectionId: cid, name: "users", columns: [
      { name: "id", type: "integer" }, { name: "name", type: "text" }, { name: "age", type: "integer" },
    ] });
    assert.equal(ds.ok, true);
    assert.equal(ds.result.dataset.columns.length, 3);
  });

  it("inserts, updates and deletes rows; coerces types", () => {
    const cid = freshConn();
    const ds = call("dataset-create", ctxA, { connectionId: cid, name: "users", columns: [
      { name: "id", type: "integer" }, { name: "name", type: "text" },
    ] }).result.dataset;

    const ins = call("row-insert", ctxA, { connectionId: cid, datasetId: ds.id, values: { id: "7", name: "Ada" } });
    assert.equal(ins.ok, true);
    assert.equal(ins.result.row.id, 7); // coerced integer
    const rid = ins.result.row._rid;

    const upd = call("row-update", ctxA, { connectionId: cid, datasetId: ds.id, rid, column: "name", value: "Grace" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.row.name, "Grace");

    const del = call("row-delete", ctxA, { connectionId: cid, datasetId: ds.id, rid });
    assert.equal(del.ok, true);
    assert.equal(del.result.rowCount, 0);
  });

  it("blocks writes on a read-only connection", () => {
    const cid = freshConn(true);
    const ds = call("dataset-create", ctxA, { connectionId: cid, name: "t", columns: [{ name: "id", type: "integer" }] }).result.dataset;
    const r = call("row-insert", ctxA, { connectionId: cid, datasetId: ds.id, values: { id: 1 } });
    assert.equal(r.ok, false);
    assert.match(r.error, /read-only/);
  });

  it("persists draggable ER-canvas positions", () => {
    const cid = freshConn();
    const ds = call("dataset-create", ctxA, { connectionId: cid, name: "t", columns: [{ name: "id", type: "integer" }] }).result.dataset;
    const mv = call("dataset-move", ctxA, { connectionId: cid, datasetId: ds.id, x: 320, y: 180 });
    assert.equal(mv.ok, true);
    assert.equal(mv.result.x, 320);
    assert.equal(mv.result.y, 180);
  });
});

describe("database live SQL engine", () => {
  function seeded() {
    const cid = call("connection-create", ctxA, { name: "DB", readOnly: false }).result.connection.id;
    const ds = call("dataset-create", ctxA, { connectionId: cid, name: "users", columns: [
      { name: "id", type: "integer" }, { name: "name", type: "text" }, { name: "age", type: "integer" },
    ] }).result.dataset;
    call("row-insert", ctxA, { connectionId: cid, datasetId: ds.id, values: { id: 1, name: "Ada", age: 36 } });
    call("row-insert", ctxA, { connectionId: cid, datasetId: ds.id, values: { id: 2, name: "Grace", age: 45 } });
    call("row-insert", ctxA, { connectionId: cid, datasetId: ds.id, values: { id: 3, name: "Linus", age: 28 } });
    return { cid, dsId: ds.id };
  }

  it("runs SELECT with WHERE / ORDER BY / LIMIT", () => {
    const { cid } = seeded();
    const r = call("query-run", ctxA, { connectionId: cid, sql: "SELECT name, age FROM users WHERE age > 30 ORDER BY age DESC LIMIT 5" });
    assert.equal(r.ok, true);
    assert.equal(r.result.success, true);
    assert.equal(r.result.rowCount, 2);
    assert.equal(r.result.rows[0].name, "Grace");
  });

  it("runs COUNT(*) aggregate", () => {
    const { cid } = seeded();
    const r = call("query-run", ctxA, { connectionId: cid, sql: "SELECT COUNT(*) FROM users" });
    assert.equal(r.result.rows[0].count, 3);
  });

  it("runs INSERT / UPDATE / DELETE and reports affected rows", () => {
    const { cid } = seeded();
    const ins = call("query-run", ctxA, { connectionId: cid, sql: "INSERT INTO users (id, name, age) VALUES (4, 'Tim', 50)" });
    assert.equal(ins.result.affected, 1);
    const upd = call("query-run", ctxA, { connectionId: cid, sql: "UPDATE users SET age = 99 WHERE name = 'Tim'" });
    assert.equal(upd.result.affected, 1);
    const del = call("query-run", ctxA, { connectionId: cid, sql: "DELETE FROM users WHERE name = 'Tim'" });
    assert.equal(del.result.affected, 1);
  });

  it("returns a graceful error for unsupported syntax", () => {
    const { cid } = seeded();
    const r = call("query-run", ctxA, { connectionId: cid, sql: "GIBBERISH" });
    assert.equal(r.ok, true);
    assert.equal(r.result.success, false);
    assert.ok(r.result.error);
  });

  it("query-explain produces a plan tree with cost + warnings", () => {
    const { cid } = seeded();
    const r = call("query-explain", ctxA, { connectionId: cid, sql: "SELECT * FROM users WHERE age > 10 ORDER BY age" });
    assert.equal(r.ok, true);
    assert.equal(Array.isArray(r.result.nodes), true);
    assert.equal(r.result.nodes.length >= 2, true);
    assert.equal(typeof r.result.totalCost, "number");
  });

  it("query-history records executed statements", () => {
    const { cid } = seeded();
    call("query-run", ctxA, { connectionId: cid, sql: "SELECT * FROM users" });
    const h = call("query-history", ctxA, { connectionId: cid });
    assert.equal(h.ok, true);
    assert.equal(h.result.count >= 1, true);
    const cleared = call("history-clear", ctxA, {});
    assert.equal(cleared.ok, true);
    assert.equal(call("query-history", ctxA, {}).result.count, 0);
  });
});

describe("database export + autocomplete", () => {
  it("query-export emits CSV with escaping", () => {
    const r = call("query-export", ctxA, {
      columns: ["id", "label"],
      rows: [{ id: 1, label: "a,b" }, { id: 2, label: "plain" }],
      format: "csv",
    });
    assert.equal(r.ok, true);
    assert.match(r.result.content, /"a,b"/);
    assert.equal(r.result.rowCount, 2);
  });

  it("query-export emits JSON", () => {
    const r = call("query-export", ctxA, { columns: ["id"], rows: [{ id: 1 }], format: "json" });
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "json");
    assert.deepEqual(JSON.parse(r.result.content), [{ id: 1 }]);
  });

  it("sql-autocomplete returns schema-aware suggestions", () => {
    const cid = call("connection-create", ctxA, { name: "DB" }).result.connection.id;
    call("dataset-create", ctxA, { connectionId: cid, name: "orders", columns: [{ name: "order_id", type: "integer" }] });
    const r = call("sql-autocomplete", ctxA, { connectionId: cid, prefix: "ord" });
    assert.equal(r.ok, true);
    assert.equal(r.result.suggestions.some((sg) => sg.value === "orders" && sg.kind === "table"), true);
    assert.equal(r.result.suggestions.some((sg) => sg.value === "order_id" && sg.kind === "column"), true);
  });
});
