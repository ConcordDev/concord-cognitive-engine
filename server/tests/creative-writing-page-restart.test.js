// A page title is stored in creative_writing_pages. Clearing the in-memory
// writingLens (what a process restart does) still lists that title.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCreativeWritingActions from "../domains/creativewriting.js";
import { up, down } from "../migrations/456_creative_writing_pages.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`creative-writing.${name}`);
  assert.ok(fn, `creative-writing.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerCreativeWritingActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, writingLens: { projects: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_page" }, userId: "user_page", db };

describe("creative writing page restart", () => {
  it("lists the title after the in-memory lens is dropped", () => {
    const created = call("project-create", ctx, { title: "  Door page  " });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.equal(created.result.project.title, "Door page");
    const row = db.prepare("SELECT title FROM creative_writing_pages WHERE id = ?").get(id);
    assert.equal(row.title, "Door page");

    globalThis._concordSTATE = { db, writingLens: { projects: new Map() } };
    const list = call("project-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].id, id);
    assert.equal(list.result.projects[0].title, "Door page");
    assert.equal(list.result.projects[0].genre, null);
    assert.equal(list.result.projects[0].wordCount, null);
  });

  it("a blank title is rejected and stores nothing", () => {
    const created = call("project-create", ctx, { title: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "project title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM creative_writing_pages").get().n, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='creative_writing_pages'").get(),
      undefined,
    );
  });
});
