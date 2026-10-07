// A study title is stored in artistry_studies. Clearing the in-memory
// artistryLens (what a process restart does) still lists that title.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerArtistryActions from "../domains/artistry.js";
import { up, down } from "../migrations/455_artistry_studies.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`artistry.${name}`);
  assert.ok(fn, `artistry.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerArtistryActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, artistryLens: { projects: new Map() } };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_study" }, userId: "user_study", db };

describe("artistry study restart", () => {
  it("lists the title after the in-memory lens is dropped", () => {
    const created = call("projectCreate", ctx, { title: "  Door study  " });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.equal(created.result.project.title, "Door study");
    const row = db.prepare("SELECT title FROM artistry_studies WHERE id = ?").get(id);
    assert.equal(row.title, "Door study");

    globalThis._concordSTATE = { db, artistryLens: { projects: new Map() } };
    const list = call("projectList", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].id, id);
    assert.equal(list.result.projects[0].title, "Door study");
    assert.equal(list.result.projects[0].discipline, null);
  });

  it("a blank title is stored as the server default only when sent blank", () => {
    const created = call("projectCreate", ctx, { title: "   " });
    assert.equal(created.ok, true);
    assert.equal(created.result.project.title, "Untitled Project");
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='artistry_studies'").get(),
      undefined,
    );
  });
});
