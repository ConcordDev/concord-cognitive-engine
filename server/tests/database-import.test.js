// S7 (Database rework, PR #1716): multi-row INSERT (all-or-nothing)
// and CSV import end-to-end — new dataset typed from the data, import
// into an existing dataset, and the deliberately-bad-row case from
// database.md §9 checkpoint 4: reported by row number, good rows land,
// imported + rejected = total.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-import" } };
let connId;

function sql(s) { return run("query-run", CTX, { connectionId: connId, sql: s }).result; }

describe("S7 — multi-row INSERT + CSV import", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "Imp", readOnly: false }).result.connection.id;
    run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }] });
  });

  it("multi-row INSERT lands every row and reports the count", () => {
    const r = sql("INSERT INTO authors (id, name) VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Edsger')");
    assert.equal(r.success, true);
    assert.equal(r.affected, 3);
    assert.equal(sql("SELECT COUNT(*) FROM authors").rows[0].count, 3);
  });

  it("multi-row INSERT with one bad row inserts NONE (statement semantics)", () => {
    const r = sql("INSERT INTO authors (id, name) VALUES (4, 'Fine'), ('bad', 'Nope')");
    assert.equal(r.success, false);
    assert.match(r.error, /row 2: column "id" expects integer/);
    assert.equal(sql("SELECT COUNT(*) FROM authors").rows[0].count, 3);
  });

  it("CSV import creates a dataset with types inferred from the data", () => {
    const r = run("dataset-import-csv", CTX, {
      connectionId: connId, name: "books",
      csv: "id,title,pages\n10,Notes,120\n11,Compilers,340",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    assert.equal(r.result.rejected, 0);
    const list = run("dataset-list", CTX, { connectionId: connId });
    const books = list.result.datasets.find((d) => d.name === "books");
    assert.deepEqual(books.columns.map((c) => [c.name, c.type]), [["id", "integer"], ["title", "text"], ["pages", "integer"]]);
  });

  it("CSV import into an existing dataset reports the bad row by number and reconciles", () => {
    const r = run("dataset-import-csv", CTX, {
      connectionId: connId,
      datasetId: run("dataset-list", CTX, { connectionId: connId }).result.datasets.find((d) => d.name === "authors").id,
      csv: "id,name\n5,Katherine\nsix,Bad\n7,Margaret",
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    assert.equal(r.result.rejected, 1);
    assert.equal(r.result.imported + r.result.rejected, r.result.totalRows);
    assert.equal(r.result.errors[0].row, 3);
    assert.match(r.result.errors[0].error, /column "id" expects integer/);
    assert.equal(sql("SELECT COUNT(*) FROM authors").rows[0].count, 5, "the good rows landed");
  });

  it("CSV with an unknown column for an existing dataset is refused by name", () => {
    const dsId = run("dataset-list", CTX, { connectionId: connId }).result.datasets.find((d) => d.name === "authors").id;
    const r = run("dataset-import-csv", CTX, { connectionId: connId, datasetId: dsId, csv: "id,nickname\n9,X" });
    assert.equal(r.ok, false);
    assert.match(r.error, /csv column "nickname" does not exist/);
  });

  it("quoted CSV fields with commas and escaped quotes parse correctly", () => {
    const r = run("dataset-import-csv", CTX, {
      connectionId: connId, name: "quotes",
      csv: 'id,note\n1,"hello, world"\n2,"say ""hi"""',
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.imported, 2);
    const sel = run("query-run", CTX, { connectionId: connId, sql: "SELECT note FROM quotes WHERE id = 2" });
    assert.equal(sel.result.rows[0].note, 'say "hi"');
  });
});
