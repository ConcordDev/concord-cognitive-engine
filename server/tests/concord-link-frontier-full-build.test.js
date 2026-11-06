// build(concord-link-frontier) — the full-build server pins (S3).
//
//   S3 — the link lifecycle exit: link-delete removes the record from
//        the in-memory bucket AND its concord_link_frontier_links row,
//        owner-scoped by construction; deleting the last link returns
//        the lens to its empty state, and the deletion survives a
//        memory drop (the DB row is the restart record).
//
// Harness mirrors the shipped restart suite: register-capture over an
// in-memory DB with migration 466 applied.

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

const ctxA = { actor: { userId: "user_a" }, userId: "user_a", db };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b", db };

function dropMemory() {
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
}

describe("concord link frontier full build — link-delete", () => {
  it("registers link-delete alongside the standing five verbs", () => {
    for (const name of ["link-open", "link-list", "link-detail", "link-bearing", "link-mark", "link-delete"]) {
      assert.ok(ACTIONS.has(`concord-link-frontier.${name}`), `${name} registered`);
    }
  });

  it("deletes the link: list empties and detail answers link_not_found", () => {
    const opened = call("link-open", ctxA, { name: "The Frontier" });
    assert.equal(opened.ok, true);
    const id = opened.result.linkId;
    call("link-bearing", ctxA, { id, bearing: "PR2 test bearing 1031" });
    const deleted = call("link-delete", ctxA, { id });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.linkId, id);
    const listed = call("link-list", ctxA, {});
    assert.equal(listed.result.count, 0);
    const detail = call("link-detail", ctxA, { id });
    assert.equal(detail.ok, false);
    assert.equal(detail.error, "link_not_found");
  });

  it("the deletion survives a memory drop — the DB row is gone", () => {
    const first = call("link-open", ctxA, { name: "North gate" });
    const second = call("link-open", ctxA, { name: "South gate" });
    call("link-delete", ctxA, { id: first.result.linkId });
    dropMemory();
    const listed = call("link-list", ctxA, {});
    assert.equal(listed.result.count, 1);
    assert.equal(listed.result.links[0].id, second.result.linkId);
    const rows = db.prepare("SELECT id FROM concord_link_frontier_links WHERE user_id = ?").all("user_a");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, second.result.linkId);
  });

  it("is owner-scoped: another account's delete answers link_not_found and the record stands", () => {
    const opened = call("link-open", ctxA, { name: "The Frontier" });
    const id = opened.result.linkId;
    const attempt = call("link-delete", ctxB, { id });
    assert.equal(attempt.ok, false);
    assert.equal(attempt.error, "link_not_found");
    const listed = call("link-list", ctxA, {});
    assert.equal(listed.result.count, 1);
  });

  it("answers honestly for missing and unknown ids", () => {
    assert.equal(call("link-delete", ctxA, {}).error, "missing_link_id");
    assert.equal(call("link-delete", ctxA, { id: "lk_nope" }).error, "link_not_found");
  });
});
