// S10 (Database rework, PR #1716): rename verbs exist for every named
// object — workspace datasets, Designer schemas, tables, columns — and
// renames cascade into the name-keyed relations and indexes instead of
// orphaning them. Duplicates are refused.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-rename" } };
let connId, dsId, schemaId, authorsTbl, booksTbl;

describe("S10 — renames with cascades", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "Rn", readOnly: false }).result.connection.id;
    dsId = run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }] }).result.dataset.id;
    run("dataset-create", CTX, { connectionId: connId, name: "books", columns: [{ name: "id", type: "integer" }, { name: "author_id", type: "integer" }] });
    run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "author_id", toDataset: "authors", toColumn: "id" });
    run("index-create", CTX, { connectionId: connId, dataset: "authors", column: "id" });

    schemaId = run("schema-create", CTX, { name: "Shop" }).result.schema.id;
    authorsTbl = run("table-add", CTX, { schemaId, name: "authors" }).result.table;
    booksTbl = run("table-add", CTX, { schemaId, name: "books" }).result.table;
    const col = run("column-add", CTX, { schemaId, tableId: booksTbl.id, name: "author_id", type: "integer" }).result;
    run("relation-add", CTX, { schemaId, fromTable: "books", fromColumn: "author_id", toTable: "authors", toColumn: "id" });
    booksTbl.authorColId = col.column?.id || col.id;
  });

  it("dataset-rename cascades into relations and indexes", () => {
    const r = run("dataset-rename", CTX, { connectionId: connId, datasetId: dsId, name: "writers" });
    assert.equal(r.ok, true);
    const list = run("dataset-list", CTX, { connectionId: connId });
    assert.equal(list.result.relations[0].toDataset, "writers");
    const ix = list.result.indexes.find((i) => i.dataset === "writers");
    assert.ok(ix, "index followed the rename");
    assert.equal(ix.name, "idx_writers_id");
    const sel = run("query-run", CTX, { connectionId: connId, sql: "SELECT * FROM writers" });
    assert.equal(sel.result.success, true);
  });

  it("dataset-rename refuses a name another dataset owns", () => {
    const r = run("dataset-rename", CTX, { connectionId: connId, datasetId: dsId, name: "books" });
    assert.equal(r.ok, false);
    assert.match(r.error, /already exists/);
  });

  it("table-rename + column-rename cascade into Designer relations", () => {
    assert.equal(run("table-rename", CTX, { schemaId, tableId: authorsTbl.id, name: "writers" }).ok, true);
    const detail1 = run("schema-detail", CTX, { id: schemaId }).result.schema;
    assert.equal(detail1.relations[0].toTable, "writers");

    const books = detail1.tables.find((t) => t.name === "books");
    const colId = books.columns.find((c) => c.name === "author_id").id;
    assert.equal(run("column-rename", CTX, { schemaId, tableId: booksTbl.id, columnId: colId, name: "writer_id" }).ok, true);
    const detail2 = run("schema-detail", CTX, { id: schemaId }).result.schema;
    assert.equal(detail2.relations[0].fromColumn, "writer_id");
  });

  it("schema-rename works and refuses duplicates", () => {
    assert.equal(run("schema-rename", CTX, { id: schemaId, name: "Store" }).ok, true);
    const other = run("schema-create", CTX, { name: "Other" }).result.schema.id;
    const dup = run("schema-rename", CTX, { id: other, name: "Store" });
    assert.equal(dup.ok, false);
  });
});
