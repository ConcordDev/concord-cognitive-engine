// S3 (Database rework, PR #1716): no silent wrong answers. Unknown
// columns and wrong-typed values are errors that name the column (and
// the expected type), errors carry a character position, and nothing is
// stored on a rejected write — verified by re-querying after each
// rejection (the re-pass checkpoint in database.md §9).
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-integrity" } };
let connId, dsId;

function sql(s) { return run("query-run", CTX, { connectionId: connId, sql: s }).result; }
function count() { return sql("SELECT COUNT(*) FROM authors").rows[0].count; }

describe("S3 — silent wrong answers become named errors", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "Integ", readOnly: false }).result.connection.id;
    const d = run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }] });
    dsId = d.result.dataset.id;
    sql("INSERT INTO authors (id, name) VALUES (1, 'Ada')");
    sql("INSERT INTO authors (id, name) VALUES (2, 'Grace')");
  });

  it("SELECT of a nonexistent column errors by name, with a position — no NULL column", () => {
    const r = sql("SELECT nickname FROM authors");
    assert.equal(r.success, false);
    assert.match(r.error, /column "nickname" does not exist/);
    assert.equal(typeof r.position, "number");
    assert.match(r.error, /at character \d+/);
  });

  it("a wrong-typed FORM insert (row-insert) errors by column + type and stores nothing", () => {
    const r = run("row-insert", CTX, { connectionId: connId, datasetId: dsId, values: { id: "abc", name: "Bad" } });
    assert.equal(r.ok, false);
    assert.match(r.error, /column "id" expects integer, got "abc"/);
    assert.equal(count(), 2, "nothing was stored");
  });

  it("a wrong-typed SQL INSERT errors the same way and stores nothing", () => {
    const r = sql("INSERT INTO authors (id, name) VALUES ('xyz', 'Bad')");
    assert.equal(r.success, false);
    assert.match(r.error, /column "id" expects integer/);
    assert.equal(count(), 2);
  });

  it("a wrong-typed cell edit (row-update) errors and leaves the value standing", () => {
    const rows = sql("SELECT id FROM authors WHERE id = 1").rows;
    const r = run("row-update", CTX, { connectionId: connId, datasetId: dsId, rid: rows[0]._rid, column: "id", value: "abc" });
    assert.equal(r.ok, false);
    assert.match(r.error, /expects integer/);
    assert.equal(sql("SELECT name FROM authors WHERE id = 1").rows[0].name, "Ada");
  });

  it("UPDATE with an unknown SET column fails the whole statement", () => {
    const r = sql("UPDATE authors SET nickname = 'x' WHERE id = 1");
    assert.equal(r.success, false);
    assert.match(r.error, /column "nickname" does not exist/);
  });

  it("WHERE on an unknown column errors instead of silently matching nothing/everything", () => {
    const r = sql("SELECT id FROM authors WHERE nickname = 'x'");
    assert.equal(r.success, false);
    assert.match(r.error, /column "nickname" does not exist/);
  });

  it("an unparseable WHERE on DELETE errors and deletes nothing", () => {
    const r = sql("DELETE FROM authors WHERE id ~~ 1");
    assert.equal(r.success, false);
    assert.match(r.error, /Unsupported WHERE clause/);
    assert.equal(count(), 2, "the table is intact");
  });

  it("a typo'd verb reports its position", () => {
    const r = sql("SELCT id FROM authors");
    assert.equal(r.success, false);
    assert.match(r.error, /Unsupported statement: SELCT/);
    assert.equal(r.position, 0);
  });

  it("ORDER BY an unknown column errors by name", () => {
    const r = sql("SELECT id FROM authors ORDER BY nickname");
    assert.equal(r.success, false);
    assert.match(r.error, /column "nickname" does not exist/);
  });

  it("valid writes still land: correct types coerce and read back", () => {
    const r = sql("INSERT INTO authors (id, name) VALUES (3, 'Edsger')");
    assert.equal(r.success, true);
    assert.equal(count(), 3);
    assert.equal(sql("SELECT name FROM authors WHERE id = 3").rows[0].name, "Edsger");
  });
});
