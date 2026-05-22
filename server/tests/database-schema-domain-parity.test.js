// Contract tests for the database lens — dbdiagram.io/DrawSQL-shape
// schema designer substrate in server/domains/database.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`database.${name}`);
  assert.ok(fn, `database.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDatabaseActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newSchema(ctx = ctxA) {
  return call("schema-create", ctx, { name: "blog" }).result.schema;
}

describe("database.schema CRUD", () => {
  it("creates a schema scoped per user", () => {
    newSchema();
    assert.equal(call("schema-list", ctxA, {}).result.count, 1);
    assert.equal(call("schema-list", ctxB, {}).result.count, 0);
  });
  it("rejects an unnamed schema and deletes one", () => {
    assert.equal(call("schema-create", ctxA, {}).ok, false);
    const sc = newSchema();
    call("schema-delete", ctxA, { id: sc.id });
    assert.equal(call("schema-list", ctxA, {}).result.count, 0);
  });
});

describe("database.tables + columns", () => {
  it("adds a table with a default id column", () => {
    const sc = newSchema();
    const t = call("table-add", ctxA, { schemaId: sc.id, name: "users" });
    assert.equal(t.ok, true);
    assert.equal(t.result.table.columns[0].name, "id");
    assert.equal(t.result.table.columns[0].pk, true);
  });
  it("rejects a duplicate table name", () => {
    const sc = newSchema();
    call("table-add", ctxA, { schemaId: sc.id, name: "users" });
    assert.equal(call("table-add", ctxA, { schemaId: sc.id, name: "users" }).ok, false);
  });
  it("adds + deletes columns; sanitizes identifiers", () => {
    const sc = newSchema();
    const t = call("table-add", ctxA, { schemaId: sc.id, name: "posts" }).result.table;
    const c = call("column-add", ctxA, { schemaId: sc.id, tableId: t.id, name: "post title", type: "varchar" });
    assert.equal(c.result.column.name, "post_title"); // sanitized
    call("column-delete", ctxA, { schemaId: sc.id, tableId: t.id, columnId: c.result.column.id });
    assert.equal(call("schema-detail", ctxA, { id: sc.id }).result.schema.tables[0].columns.length, 1);
  });
});

describe("database.relations + SQL export", () => {
  it("adds a relation only when both tables exist", () => {
    const sc = newSchema();
    call("table-add", ctxA, { schemaId: sc.id, name: "users" });
    call("table-add", ctxA, { schemaId: sc.id, name: "posts" });
    const r = call("relation-add", ctxA, { schemaId: sc.id, fromTable: "posts", fromColumn: "user_id", toTable: "users", toColumn: "id" });
    assert.equal(r.ok, true);
    assert.equal(call("relation-add", ctxA, { schemaId: sc.id, fromTable: "posts", fromColumn: "x", toTable: "ghost" }).ok, false);
  });
  it("exports valid CREATE TABLE DDL", () => {
    const sc = newSchema();
    const t = call("table-add", ctxA, { schemaId: sc.id, name: "users" }).result.table;
    call("column-add", ctxA, { schemaId: sc.id, tableId: t.id, name: "email", type: "varchar", nullable: false });
    const sql = call("schema-export-sql", ctxA, { id: sc.id });
    assert.match(sql.result.sql, /CREATE TABLE users/);
    assert.match(sql.result.sql, /id INTEGER PRIMARY KEY/);
    assert.match(sql.result.sql, /email VARCHAR NOT NULL/);
  });
});

describe("database.dashboard + analysis", () => {
  it("dashboard aggregates schemas + tables", () => {
    const sc = newSchema();
    call("table-add", ctxA, { schemaId: sc.id, name: "t1" });
    const d = call("schema-dashboard", ctxA, {});
    assert.equal(d.result.schemas, 1);
    assert.equal(d.result.totalTables, 1);
  });
  it("schemaAnalysis still responds", () => {
    assert.equal(call("schemaAnalysis", ctxA, {}).ok, true);
  });
});
