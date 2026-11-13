// FIX-bridge-003 (audit sweep CB-0447) — an opened link gains a delete:
// leftover links persisted forever because the domain registered
// open/list/detail/bearing/mark and no removal. link-delete removes
// the link from the in-memory board AND its sqlite row, so it does
// not resurrect on the next hydrate; it is owner-scoped and honest
// about unknown ids.

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
const ctxOther = { actor: { userId: "user_other" }, userId: "user_other", db };

function dropMemory() {
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
}

describe("frontier link-delete (FIX-bridge-003)", () => {
  it("deletes an opened link from the board and the row; it stays deleted after a restart hydrate", () => {
    const opened = call("link-open", ctx, { name: "North gate" });
    assert.equal(opened.ok, true);
    const id = opened.result.linkId;
    const del = call("link-delete", ctx, { id });
    assert.equal(del.ok, true);
    assert.equal(call("link-list", ctx, {}).result.count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM concord_link_frontier_links WHERE id = ?").get(id).n, 0);
    dropMemory();
    assert.equal(call("link-list", ctx, {}).result.count, 0);
    assert.equal(call("link-detail", ctx, { id }).ok, false);
  });

  it("deleting one link leaves the others on the board", () => {
    const a = call("link-open", ctx, { name: "Alpha" }).result.linkId;
    call("link-open", ctx, { name: "Beta" });
    assert.equal(call("link-delete", ctx, { id: a }).ok, true);
    const list = call("link-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.links[0].name, "Beta");
  });

  it("an unknown id is link_not_found, and another user cannot delete the link", () => {
    const id = call("link-open", ctx, { name: "Mine" }).result.linkId;
    assert.equal(call("link-delete", ctx, { id: "lk_nope" }).error, "link_not_found");
    assert.equal(call("link-delete", ctxOther, { id }).error, "link_not_found");
    assert.equal(call("link-list", ctx, {}).result.count, 1);
  });
});
