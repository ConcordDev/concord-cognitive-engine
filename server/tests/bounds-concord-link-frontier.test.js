// GB-1539 bounds enforcement — FIX-concord-link-frontier-008 (Link name).
// The walk: a 300-character name displayed with no length warning and
// the server side was never tested. link-open and link-rename now
// refuse a name over the 200-char title limit with invalid_input;
// names at the limit open and rename as before.
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerConcordLinkFrontierActions from "../domains/concord-link-frontier.js";
import { up } from "../migrations/466_concord_link_frontier_links.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`concord-link-frontier.${name}`);
  if (!fn) throw new Error(`concord-link-frontier.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerConcordLinkFrontierActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
});

const ctxA = { actor: { userId: "bnd_clf_a" }, userId: "bnd_clf_a", db };

describe("link name bounds (FIX-concord-link-frontier-008)", () => {
  it("link-open refuses a 300-character name with invalid_input", () => {
    const r = call("link-open", ctxA, { name: "x".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    assert.match(r.message, /200 characters/);
  });

  it("link-open accepts a name at the limit, whole", () => {
    const r = call("link-open", ctxA, { name: "x".repeat(200) });
    assert.equal(r.ok, true);
    assert.equal(r.result.link.name.length, 200);
  });

  it("a refused open writes nothing", () => {
    call("link-open", ctxA, { name: "x".repeat(300) });
    const list = call("link-list", ctxA, {});
    const links = list.result?.links || [];
    assert.equal(links.length, 0);
  });

  it("link-rename refuses an over-limit name and keeps the old one", () => {
    const opened = call("link-open", ctxA, { name: "Frontier note" });
    const id = opened.result.linkId;
    const r = call("link-rename", ctxA, { id, name: "y".repeat(300) });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid_input");
    const detail = call("link-detail", ctxA, { id });
    assert.equal(detail.result.link.name, "Frontier note");
  });
});
