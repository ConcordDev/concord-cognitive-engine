// S1 (Database rework, PR #1716): the Query Editor's shipped default query
// runs against the workspace engine. The `dtus` table resolves virtually
// (read-only) from the platform DTU store, with or without a user
// connection — the F1 crash path (editor → graph query API → assumed
// result shape → render crash) is closed at its source.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-editor" } };

function seedDtus() {
  globalThis._concordSTATE = {
    dtus: new Map([
      ["d1", { id: "d1", title: "Alpha", tier: "regular", meta: { tags: ["music"], createdAt: "2026-10-01T00:00:00.000Z" }, createdAt: "2026-10-01T00:00:00.000Z" }],
      ["d2", { id: "d2", title: "Beta", tier: "verified", meta: { tags: ["code", "sql"], createdAt: "2026-10-03T00:00:00.000Z" }, createdAt: "2026-10-03T00:00:00.000Z" }],
    ]),
  };
}

describe("S1 — Query Editor default query over the virtual dtus dataset", () => {
  beforeEach(seedDtus);

  it("the shipped prefilled query returns rows with NO connection at all", () => {
    const r = run("query-run", CTX, { sql: "SELECT id, title, tier, tags, created_at FROM dtus ORDER BY created_at DESC LIMIT 50;" });
    assert.equal(r.ok, true);
    assert.equal(r.result.success, true);
    assert.deepEqual(r.result.columns, ["id", "title", "tier", "tags", "created_at"]);
    assert.equal(r.result.rows.length, 2);
    assert.equal(r.result.rows[0].id, "d2", "newest first");
    assert.equal(r.result.rows[0].created_at, "2026-10-03T00:00:00.000Z");
    assert.equal(r.result.rows[1].tags, "music");
  });

  it("the dtus query also resolves on a real connection that has no dtus dataset", () => {
    const c = run("connection-create", CTX, { name: "WS" });
    const connId = c.result.connection.id;
    const r = run("query-run", CTX, { connectionId: connId, sql: "SELECT id FROM dtus" });
    assert.equal(r.result.success, true);
    assert.equal(r.result.rows.length, 2);
  });

  it("writes to dtus are refused honestly and change nothing", () => {
    const r = run("query-run", CTX, { sql: "INSERT INTO dtus (id, title) VALUES ('x', 'Nope')" });
    assert.equal(r.result.success, false);
    assert.match(r.result.error, /read-only/);
    const after = run("query-run", CTX, { sql: "SELECT COUNT(*) FROM dtus" });
    assert.equal(after.result.rows[0].count, 2);
  });

  it("an explicit unknown connectionId still fails closed", () => {
    const r = run("query-run", CTX, { connectionId: "conn_nope", sql: "SELECT id FROM dtus" });
    assert.equal(r.ok, false);
    assert.match(r.error, /connection not found/);
  });

  it("ordinary workspace datasets still run end-to-end beside the virtual table", () => {
    const c = run("connection-create", CTX, { name: "WS2", readOnly: false });
    const connId = c.result.connection.id;
    const d = run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }] });
    assert.equal(d.ok, true);
    const ins = run("query-run", CTX, { connectionId: connId, sql: "INSERT INTO authors (id, name) VALUES (1, 'Ada')" });
    assert.equal(ins.result.success, true);
    const sel = run("query-run", CTX, { connectionId: connId, sql: "SELECT id, name FROM authors" });
    assert.deepEqual(sel.result.rows.map((r) => r.name), ["Ada"]);
  });

  it("EXPLAIN over dtus resolves the virtual dataset (query-explain)", () => {
    const r = run("query-explain", CTX, { sql: "SELECT id FROM dtus ORDER BY created_at DESC LIMIT 5" });
    assert.equal(r.ok, true);
    assert.equal(r.result.table, "dtus");
    assert.ok(r.result.nodes.length >= 2);
  });
});
