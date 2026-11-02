// S6 + S8 substrate (Database rework, PR #1716): dataset-transfer
// between connections, and real index objects (index-create/delete)
// with measured sizes, pruned alongside their datasets.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-move" } };
let aId, bId, dsId;

describe("S6/S8 — dataset transfer + index objects", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    aId = run("connection-create", CTX, { name: "A", readOnly: false }).result.connection.id;
    bId = run("connection-create", CTX, { name: "B", readOnly: false }).result.connection.id;
    dsId = run("dataset-create", CTX, { connectionId: aId, name: "books", columns: [{ name: "id", type: "integer" }, { name: "title", type: "text" }] }).result.dataset.id;
    run("query-run", CTX, { connectionId: aId, sql: "INSERT INTO books (id, title) VALUES (1, 'A')" });
  });

  it("dataset-list reports a measured sizeBytes", () => {
    const list = run("dataset-list", CTX, { connectionId: aId });
    assert.ok(list.result.datasets[0].sizeBytes > 0);
    assert.equal(list.result.datasets[0].columns[0].pk, true, "leading id column is the pk");
  });

  it("creates an index with a measured size and rejects duplicates", () => {
    const r = run("index-create", CTX, { connectionId: aId, dataset: "books", column: "title" });
    assert.equal(r.ok, true);
    assert.equal(r.result.index.name, "idx_books_title");
    assert.ok(r.result.index.sizeBytes > 0);
    assert.equal(run("index-create", CTX, { connectionId: aId, dataset: "books", column: "title" }).ok, false);
    assert.equal(run("index-create", CTX, { connectionId: aId, dataset: "books", column: "nope" }).ok, false);
  });

  it("transfers the dataset with its rows to another connection; its index stays pruned behind", () => {
    const r = run("dataset-transfer", CTX, { fromConnectionId: aId, toConnectionId: bId, datasetId: dsId });
    assert.equal(r.ok, true);
    assert.equal(run("dataset-list", CTX, { connectionId: aId }).result.datasets.length, 0);
    assert.equal(run("dataset-list", CTX, { connectionId: aId }).result.indexes.length, 0);
    const bl = run("dataset-list", CTX, { connectionId: bId });
    assert.equal(bl.result.datasets.length, 1);
    const sel = run("query-run", CTX, { connectionId: bId, sql: "SELECT title FROM books WHERE id = 1" });
    assert.equal(sel.result.rows[0].title, "A", "rows moved with the dataset");
  });

  it("transfer refuses a name clash and same-connection moves", () => {
    run("dataset-create", CTX, { connectionId: aId, name: "books", columns: [{ name: "id", type: "integer" }] });
    const clash = run("dataset-transfer", CTX, { fromConnectionId: bId, toConnectionId: aId, datasetId: dsId });
    assert.equal(clash.ok, false);
    assert.match(clash.error, /already has a dataset named "books"/);
    const same = run("dataset-transfer", CTX, { fromConnectionId: bId, toConnectionId: bId, datasetId: dsId });
    assert.equal(same.ok, false);
  });

  it("index-delete removes the object", () => {
    const made = run("index-create", CTX, { connectionId: bId, dataset: "books", column: "id" });
    const del = run("index-delete", CTX, { connectionId: bId, indexId: made.result.index.id });
    assert.equal(del.ok, true);
    assert.equal(run("dataset-list", CTX, { connectionId: bId }).result.indexes.length, 0);
  });
});
