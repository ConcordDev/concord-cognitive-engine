// FIX-docs-004 (coverage leg) — workspace search covered pages only, so
// a matching database never appeared; the ticket's expected shape is
// "matching pages and databases". Pin: docs-search returns database
// hits (name / column / cell text) tagged kind:"database" alongside
// page hits, and page content matches stay labelled matchedIn:"content"
// (the walker's 'Untitled' hit was a legitimate content match).
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerDocsActions from "../domains/docs.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`docs.${name}`);
  assert.ok(fn, `docs.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerDocsActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_a" }, userId: "user_a" };

describe("FIX-docs-004 docs-search covers databases", () => {
  it("finds a database by name and by cell text, tagged as a database", () => {
    const db = call("db-create", ctx, { name: "qa-zt4-docs tracker" }).result.database;
    call("db-row-add", ctx, { id: db.id, cells: { [db.columns[0].id]: "needle-row-text" } });
    const byName = call("docs-search", ctx, { query: "qa-zt4-docs" }).result.results;
    assert.equal(byName.length, 1);
    assert.equal(byName[0].kind, "database");
    assert.equal(byName[0].id, db.id);
    const byCell = call("docs-search", ctx, { query: "needle-row" }).result.results;
    assert.equal(byCell.length, 1);
    assert.equal(byCell[0].kind, "database");
    assert.equal(byCell[0].matchedIn, "content");
  });

  it("another user's database never appears", () => {
    const other = { actor: { userId: "user_b" }, userId: "user_b" };
    call("db-create", other, { name: "qa-zt4-docs secret" });
    const mine = call("docs-search", ctx, { query: "qa-zt4-docs" }).result.results;
    assert.equal(mine.filter((r) => r.title.includes("secret")).length, 0);
  });
});
