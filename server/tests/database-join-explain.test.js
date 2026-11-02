// S2 (Database rework, PR #1716): JOIN + EXPLAIN in the workspace engine.
// Real-SQL scope per the founder's §8 ruling (database.md): INNER/LEFT
// JOIN … ON equality across two datasets, qualified column references,
// and EXPLAIN reachable both as the query-explain macro and typed
// through query-run.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-join" } };
let connId;

function sql(s, c = connId) {
  const r = run("query-run", CTX, { connectionId: c, sql: s });
  assert.equal(r.ok, true);
  return r.result;
}

describe("S2 — JOIN + EXPLAIN", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    const c = run("connection-create", CTX, { name: "Lib", readOnly: false });
    connId = c.result.connection.id;
    run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }] });
    run("dataset-create", CTX, { connectionId: connId, name: "books", columns: [{ name: "id", type: "integer" }, { name: "title", type: "text" }, { name: "author_id", type: "integer" }] });
    sql("INSERT INTO authors (id, name) VALUES (1, 'Ada')");
    sql("INSERT INTO authors (id, name) VALUES (2, 'Grace')");
    sql("INSERT INTO books (id, title, author_id) VALUES (10, 'Notes', 1)");
    sql("INSERT INTO books (id, title, author_id) VALUES (11, 'Compilers', 2)");
    sql("INSERT INTO books (id, title, author_id) VALUES (12, 'Orphan', 99)");
  });

  it("INNER JOIN with qualified columns combines rows across datasets", () => {
    const r = sql("SELECT books.title, authors.name FROM books JOIN authors ON books.author_id = authors.id ORDER BY books.id ASC");
    assert.equal(r.success, true);
    assert.deepEqual(r.columns, ["title", "name"]);
    assert.deepEqual(r.rows.map((x) => [x.title, x.name]), [["Notes", "Ada"], ["Compilers", "Grace"]]);
  });

  it("JOIN honours WHERE on a qualified column and LIMIT", () => {
    const r = sql("SELECT books.title FROM books JOIN authors ON books.author_id = authors.id WHERE authors.name = 'Grace' LIMIT 1");
    assert.deepEqual(r.rows.map((x) => x.title), ["Compilers"]);
  });

  it("LEFT JOIN keeps unmatched left rows with NULL right columns", () => {
    const r = sql("SELECT books.title, authors.name FROM books LEFT JOIN authors ON books.author_id = authors.id ORDER BY books.id ASC");
    assert.equal(r.rows.length, 3);
    assert.equal(r.rows[2].title, "Orphan");
    assert.equal(r.rows[2].name, null);
  });

  it("SELECT * over a join projects both tables' columns", () => {
    const r = sql("SELECT * FROM books JOIN authors ON books.author_id = authors.id WHERE books.id = 10");
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0].title, "Notes");
    assert.equal(r.rows[0].name, "Ada");
  });

  it("COUNT(*) counts joined rows", () => {
    const r = sql("SELECT COUNT(*) FROM books JOIN authors ON books.author_id = authors.id");
    assert.equal(r.rows[0].count, 2);
  });

  it("typed EXPLAIN through query-run returns a plan with a join node", () => {
    const r = sql("EXPLAIN SELECT books.title FROM books JOIN authors ON books.author_id = authors.id");
    assert.equal(r.success, true);
    assert.equal(r.op, "EXPLAIN");
    assert.ok(r.explain.nodes.some((n) => n.type === "join"), "plan has a join node");
    assert.ok(r.explain.nodes.some((n) => n.label.includes("authors")), "plan scans the joined table");
  });

  it("the query-explain macro plans the same JOIN", () => {
    const r = run("query-explain", CTX, { connectionId: connId, sql: "SELECT * FROM books JOIN authors ON books.author_id = authors.id" });
    assert.equal(r.ok, true);
    assert.ok(r.result.nodes.some((n) => n.type === "join"));
  });

  it("typed EXPLAIN on a plain SELECT returns scan/sort/limit nodes", () => {
    const r = sql("EXPLAIN SELECT id FROM authors ORDER BY id DESC LIMIT 1");
    assert.equal(r.op, "EXPLAIN");
    const types = r.explain.nodes.map((n) => n.type);
    assert.ok(types.includes("scan") && types.includes("sort") && types.includes("limit"));
  });

  it("JOIN against a missing dataset errors by name", () => {
    const r = sql("SELECT * FROM books JOIN nope ON books.author_id = nope.id");
    assert.equal(r.success, false);
    assert.match(r.error, /dataset "nope" not found/);
  });

  it("a malformed JOIN is rejected, not silently mis-run", () => {
    const r = sql("SELECT * FROM books JOIN authors USING (author_id)");
    assert.equal(r.success, false);
    assert.match(r.error, /Unsupported/);
  });
});
