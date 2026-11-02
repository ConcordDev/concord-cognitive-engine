// S4 (Database rework, PR #1716): dataset relations. Datasets — the
// objects the ER Diagram draws — gain a real foreign-key store on the
// connection (dataset-relation-add/delete), validated against real
// datasets and columns, riding dataset-list for the ER, and pruned
// when a dataset is deleted.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import registerDatabaseActions from "../domains/database.js";

const handlers = new Map();
function registerLensAction(domain, action, fn) { handlers.set(`${domain}.${action}`, fn); }
registerDatabaseActions(registerLensAction);
const run = (action, ctx, params) => handlers.get(`database.${action}`)(ctx, null, params || {});
const CTX = { actor: { userId: "u-rel" } };
let connId, booksId;

describe("S4 — dataset relations", () => {
  before(() => {
    globalThis._concordSTATE = { dtus: new Map() };
    connId = run("connection-create", CTX, { name: "Rel", readOnly: false }).result.connection.id;
    run("dataset-create", CTX, { connectionId: connId, name: "authors", columns: [{ name: "id", type: "integer" }, { name: "name", type: "text" }] });
    booksId = run("dataset-create", CTX, { connectionId: connId, name: "books", columns: [{ name: "id", type: "integer" }, { name: "author_id", type: "integer" }] }).result.dataset.id;
  });

  it("adds a relation and returns it via dataset-list", () => {
    const r = run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "author_id", toDataset: "authors", toColumn: "id" });
    assert.equal(r.ok, true);
    const list = run("dataset-list", CTX, { connectionId: connId });
    assert.equal(list.result.relations.length, 1);
    assert.equal(list.result.relations[0].fromDataset, "books");
  });

  it("rejects a duplicate relation", () => {
    const r = run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "author_id", toDataset: "authors", toColumn: "id" });
    assert.equal(r.ok, false);
    assert.match(r.error, /already exists/);
  });

  it("rejects relations naming missing datasets or columns", () => {
    assert.equal(run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "author_id", toDataset: "nope", toColumn: "id" }).ok, false);
    const bad = run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "nope", toDataset: "authors", toColumn: "id" });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /column "nope" does not exist/);
  });

  it("deletes a relation by id", () => {
    const list = run("dataset-list", CTX, { connectionId: connId });
    const r = run("dataset-relation-delete", CTX, { connectionId: connId, relationId: list.result.relations[0].id });
    assert.equal(r.ok, true);
    assert.equal(run("dataset-list", CTX, { connectionId: connId }).result.relations.length, 0);
  });

  it("deleting a dataset prunes its relations", () => {
    run("dataset-relation-add", CTX, { connectionId: connId, fromDataset: "books", fromColumn: "author_id", toDataset: "authors", toColumn: "id" });
    run("dataset-delete", CTX, { connectionId: connId, datasetId: booksId });
    assert.equal(run("dataset-list", CTX, { connectionId: connId }).result.relations.length, 0);
  });
});
