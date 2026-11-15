// FIX-concord-link-frontier-003 — a link can be renamed in place.
// Before link-rename, a mistyped or stale fixture name was permanent:
// links could be opened, borne, marked and deleted, never renamed.
// The rename persists through the same write/rollback discipline as
// link-mark, and survives the in-memory bag being dropped (restart).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerConcordLinkFrontierActions from "../domains/concord-link-frontier.js";
import { up } from "../migrations/466_concord_link_frontier_links.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`concord-link-frontier.${name}`);
  assert.ok(fn, `concord-link-frontier.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerConcordLinkFrontierActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
});

const ctx = { actor: { userId: "user_link" }, userId: "user_link", db };
const other = { actor: { userId: "user_other" }, userId: "user_other", db };

function dropMemory() {
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
}

describe("concord link frontier rename", () => {
  it("renames in place, persists across a memory drop, and leaves bearing/mark alone", () => {
    const opened = call("link-open", ctx, { name: "North gate" });
    assert.equal(opened.ok, true);
    const id = opened.result.linkId;
    call("link-bearing", ctx, { id, bearing: "Two spans north." });

    const renamed = call("link-rename", ctx, { id, name: "  North gate (winter)  " });
    assert.equal(renamed.ok, true);
    assert.equal(renamed.result.link.name, "North gate (winter)");

    dropMemory();
    const detail = call("link-detail", ctx, { id });
    assert.equal(detail.result.link.name, "North gate (winter)");
    assert.equal(detail.result.link.bearing, "Two spans north.");
    const row = db.prepare("SELECT name FROM concord_link_frontier_links WHERE id = ?").get(id);
    assert.equal(row.name, "North gate (winter)");
  });

  it("refuses an empty name, an unknown id, and another user's link", () => {
    const opened = call("link-open", ctx, { name: "South gate" });
    const id = opened.result.linkId;
    const empty = call("link-rename", ctx, { id, name: "   " });
    assert.equal(empty.ok, false);
    assert.match(empty.error, /link name required/);
    const missing = call("link-rename", ctx, { id: "nope", name: "X" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /link_not_found/);
    const foreign = call("link-rename", other, { id, name: "Hijacked" });
    assert.equal(foreign.ok, false);
    assert.match(foreign.error, /link_not_found/);
    assert.equal(call("link-detail", ctx, { id }).result.link.name, "South gate");
  });
});
