// S5 (Database rework, PR #1716): the destructive-SQL guard. An
// unscoped DELETE/UPDATE does not run on first ask — query-run returns
// needsConfirm with the affected-row count, records NOTHING in history,
// and executes only when the caller re-sends with confirmDestructive.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-guard" } };
let connId;

function sql(s, extra = {}) { return run("query-run", CTX, { connectionId: connId, sql: s, ...extra }).result; }
function count() { return sql("SELECT COUNT(*) FROM books").rows[0].count; }

describe("S5 — destructive-SQL guard", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "Guard", readOnly: false }).result.connection.id;
    run("dataset-create", CTX, { connectionId: connId, name: "books", columns: [{ name: "id", type: "integer" }, { name: "title", type: "text" }] });
    sql("INSERT INTO books (id, title) VALUES (1, 'A')");
    sql("INSERT INTO books (id, title) VALUES (2, 'B')");
    sql("INSERT INTO books (id, title) VALUES (3, 'C')");
  });

  it("DELETE without WHERE is stopped with needsConfirm and the table is untouched", () => {
    const r = sql("DELETE FROM books");
    assert.equal(r.success, false);
    assert.equal(r.needsConfirm, true);
    assert.match(r.error, /affects every row in "books" \(3 rows\)/);
    assert.equal(count(), 3);
  });

  it("the stopped statement is NOT recorded in history (nothing ran)", () => {
    const h = run("query-history", CTX, {});
    assert.equal(h.result.history.filter((e) => e.sql === "DELETE FROM books").length, 0);
  });

  it("re-sending with confirmDestructive runs it", () => {
    const r = sql("DELETE FROM books", { confirmDestructive: true });
    assert.equal(r.success, true);
    assert.equal(r.affected, 3);
    assert.equal(count(), 0);
  });

  it("UPDATE without WHERE is guarded the same way; scoped writes are not", () => {
    sql("INSERT INTO books (id, title) VALUES (1, 'A')");
    const stopped = sql("UPDATE books SET title = 'X'");
    assert.equal(stopped.needsConfirm, true);
    assert.equal(sql("SELECT title FROM books WHERE id = 1").rows[0].title, "A");
    const scoped = sql("UPDATE books SET title = 'Y' WHERE id = 1");
    assert.equal(scoped.success, true);
    assert.equal(sql("SELECT title FROM books WHERE id = 1").rows[0].title, "Y");
  });
});
