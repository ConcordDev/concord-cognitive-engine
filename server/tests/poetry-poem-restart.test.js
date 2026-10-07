// A poem title is stored in poetry_poems. Clearing the in-memory
// poetryLens (what a process restart does) still lists that title.
// Form and status are not stored, so they come back null. The body is.
// A delete removes the row before the memory splice, so a restart
// does not bring the poem back.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerPoetryActions from "../domains/poetry.js";
import { up, down } from "../migrations/460_poetry_poems.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`poetry.${name}`);
  assert.ok(fn, `poetry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerPoetryActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, poetryLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_poem" }, userId: "user_poem", db };

describe("poetry poem restart", () => {
  it("lists the title after the in-memory lens is dropped", () => {
    const created = call("poem-create", ctx, { title: "  Door light  ", body: "one line\nand two" });
    assert.equal(created.ok, true);
    const id = created.result.poem.id;
    assert.equal(created.result.poem.title, "Door light");
    const row = db.prepare("SELECT title, body FROM poetry_poems WHERE id = ?").get(id);
    assert.equal(row.title, "Door light");
    assert.equal(row.body, "one line\nand two");

    globalThis._concordSTATE = { db, poetryLens: {} };
    const list = call("poem-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.poems[0].id, id);
    assert.equal(list.result.poems[0].title, "Door light");
    assert.equal(list.result.poems[0].form, null);
    assert.equal(list.result.poems[0].status, null);
    assert.equal(list.result.poems[0].lineCount, 2);
    const detail = call("poem-detail", ctx, { id });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.poem.body, "one line\nand two");
    assert.equal(detail.result.poem.form, null);
    assert.equal(detail.result.poem.status, null);
  });

  it("a blank title is rejected and stores nothing", () => {
    const created = call("poem-create", ctx, { title: "   ", body: "x" });
    assert.equal(created.ok, false);
    assert.equal(created.error, "poem title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM poetry_poems").get().n, 0);
  });

  it("a deleted poem stays gone after the in-memory lens is dropped", () => {
    const created = call("poem-create", ctx, { title: "Gone" });
    const id = created.result.poem.id;
    const deleted = call("poem-delete", ctx, { id });
    assert.equal(deleted.ok, true);
    globalThis._concordSTATE = { db, poetryLens: {} };
    const list = call("poem-list", ctx, {});
    assert.equal(list.result.count, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='poetry_poems'").get(),
      undefined,
    );
  });
});
