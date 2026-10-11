// Paper library persistence (migration 471 + domains/paper.js).
//
// paper-add writes the owner's library synchronously. paper-list returns that
// paper, the row survives wiping the in-memory bucket (a process restart),
// and another account's list does not include a private paper.
//
// Run: node --test server/tests/paper-library-persist.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate471 } from "../migrations/471_paper_library.js";
import registerPaperActions from "../domains/paper.js";

const ACTIONS = new Map();
registerPaperActions((domain, name, fn) => ACTIONS.set(`${domain}.${name}`, fn));
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`paper.${name}`);
  if (!fn) throw new Error(`paper.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

function freshDb() {
  const db = new Database(":memory:");
  migrate471(db);
  return db;
}

describe("paper library persistence", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
  });
  afterEach(() => {
    db.close();
    if (globalThis._concordSTATE) delete globalThis._concordSTATE.paperLens;
  });

  it("paper-add lists the paper and it survives a restart", () => {
    const ctx = { db, userId: "owner", actor: { userId: "owner" } };
    const saved = call("paper-add", ctx, {
      title: "Attention Is All You Need",
      authors: ["Vaswani", "Shazeer"],
      year: 2017,
    });
    assert.equal(saved.ok, true);
    assert.equal(saved.result.paper.title, "Attention Is All You Need");
    assert.deepEqual(saved.result.paper.authors, ["Vaswani", "Shazeer"]);
    assert.equal(saved.result.paper.year, 2017);
    assert.equal(saved.result.paper.visibility, "private");
    assert.equal(saved.result.paper.ownerId, "owner");

    const listed = call("paper-list", ctx, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.papers[0].title, "Attention Is All You Need");
    assert.equal(call("library-dashboard", ctx, {}).result.totalPapers, 1);

    delete globalThis._concordSTATE.paperLens;

    const again = call("paper-list", ctx, {});
    assert.equal(again.ok, true);
    assert.equal(again.result.count, 1);
    assert.equal(again.result.papers[0].id, saved.result.paper.id);
    assert.deepEqual(again.result.papers[0].authors, ["Vaswani", "Shazeer"]);
    assert.equal(again.result.papers[0].year, 2017);
    assert.equal(call("library-dashboard", ctx, {}).result.totalPapers, 1);
  });

  it("accepts a comma-separated author string and a nested params envelope", () => {
    const ctx = { db, userId: "owner", actor: { userId: "owner" } };
    const saved = call("paper-add", ctx, {
      params: { title: "Sketch of the Analytical Engine", authors: "Lovelace, Menabrea", year: "1843" },
    });
    assert.equal(saved.ok, true, saved.error);
    assert.deepEqual(saved.result.paper.authors, ["Lovelace", "Menabrea"]);
    assert.equal(saved.result.paper.year, 1843);
    delete globalThis._concordSTATE.paperLens;
    assert.equal(call("paper-list", ctx, {}).result.papers[0].title, "Sketch of the Analytical Engine");
  });

  it("hides a private paper from another account", () => {
    const owner = { db, userId: "owner", actor: { userId: "owner" } };
    const other = { db, userId: "other", actor: { userId: "other" } };
    const saved = call("paper-add", owner, { title: "Private Notes on Vision", authors: ["Ada"], year: 2024 });
    assert.equal(saved.ok, true);
    delete globalThis._concordSTATE.paperLens;

    const theirs = call("paper-list", other, {});
    assert.equal(theirs.result.count, 0);
    assert.equal(call("library-dashboard", other, {}).result.totalPapers, 0);
    const detail = call("paper-detail", other, { id: saved.result.paper.id });
    assert.equal(detail.ok, false);
    assert.equal(detail.error, "paper not found");

    const mine = call("paper-list", owner, {});
    assert.equal(mine.result.count, 1);
    assert.equal(mine.result.papers[0].title, "Private Notes on Vision");
  });

  it("paper-save remains an alias of paper-add", () => {
    const ctx = { db, userId: "owner", actor: { userId: "owner" } };
    const saved = call("paper-save", ctx, { title: "Alias Paper", authors: ["Grace"], year: 1952 });
    assert.equal(saved.ok, true);
    delete globalThis._concordSTATE.paperLens;
    assert.equal(call("paper-list", ctx, {}).result.count, 1);
  });
});
