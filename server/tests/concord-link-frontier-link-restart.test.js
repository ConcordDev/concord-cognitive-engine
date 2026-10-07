// An opened link keeps its name, its edited bearing, and its mark
// after the in-memory concordLinkFrontier bag is dropped. The list
// does not carry the bearing or the mark. A second link stays on
// the board.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerConcordLinkFrontierActions from "../domains/concord-link-frontier.js";
import { up, down } from "../migrations/466_concord_link_frontier_links.js";

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

function dropMemory() {
  globalThis._concordSTATE = { db, concordLinkFrontier: {} };
}

describe("concord link frontier restart", () => {
  it("lists the name, opens the bearing, and keeps an edit and a mark", () => {
    const opened = call("link-open", ctx, { name: "  North gate  " });
    assert.equal(opened.ok, true);
    const id = opened.result.linkId;
    assert.equal(opened.result.link.name, "North gate");
    assert.equal(opened.result.link.bearing, undefined);
    assert.equal(opened.result.link.mark, undefined);
    const row = db.prepare("SELECT name, bearing, mark FROM concord_link_frontier_links WHERE id = ?").get(id);
    assert.equal(row.name, "North gate");
    assert.equal(row.bearing, "");
    assert.equal(row.mark, null);

    dropMemory();
    const list = call("link-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.links[0].name, "North gate");
    assert.equal(list.result.links[0].bearing, undefined);
    const detail = call("link-detail", ctx, { id });
    assert.equal(detail.result.link.bearing, "");
    assert.equal(detail.result.link.mark, null);

    const set = call("link-bearing", ctx, { id, bearing: "  Two spans north.  " });
    assert.equal(set.ok, true);
    assert.equal(set.result.link.bearing, undefined);
    dropMemory();
    assert.equal(call("link-detail", ctx, { id }).result.link.bearing, "Two spans north.");

    const edited = call("link-bearing", ctx, { id, bearing: "  Three spans north.  " });
    assert.equal(edited.ok, true);
    assert.equal(edited.result.link.bearing, undefined);
    dropMemory();
    assert.equal(call("link-detail", ctx, { id }).result.link.bearing, "Three spans north.");

    const marked = call("link-mark", ctx, { id, mark: "  The hinge is warm.  " });
    assert.equal(marked.ok, true);
    assert.equal(marked.result.link.mark, undefined);
    dropMemory();
    const after = call("link-detail", ctx, { id }).result.link;
    assert.equal(after.name, "North gate");
    assert.equal(after.bearing, "Three spans north.");
    assert.equal(after.mark, "The hinge is warm.");
  });

  it("keeps a second link on the board", async () => {
    const first = call("link-open", ctx, { name: "North gate" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = call("link-open", ctx, { name: "South gate" });
    dropMemory();
    const listed = call("link-list", ctx, {}).result.links;
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, first.result.linkId);
    assert.equal(listed[1].id, second.result.linkId);
    assert.equal(listed[0].bearing, undefined);
    assert.equal(listed[1].bearing, undefined);
  });

  it("a blank name, bearing, or mark stores nothing", () => {
    assert.equal(call("link-open", ctx, { name: "  " }).error, "name required");
    const opened = call("link-open", ctx, { name: "North gate" });
    assert.equal(call("link-bearing", ctx, { id: opened.result.linkId, bearing: " " }).error, "bearing required");
    assert.equal(call("link-mark", ctx, { id: opened.result.linkId, mark: " " }).error, "mark required");
    const row = db.prepare("SELECT bearing, mark FROM concord_link_frontier_links WHERE id = ?").get(opened.result.linkId);
    assert.equal(row.bearing, "");
    assert.equal(row.mark, null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM concord_link_frontier_links").get().n, 1);
  });

  it("refuses an actorless write, rolls back a failed write, and drops the table", () => {
    const anon = { actor: {}, db };
    assert.equal(call("link-open", anon, { name: "North gate" }).error, "no_actor");
    const bad = {
      prepare(sql) {
        if (String(sql).includes("sqlite_master")) return { get: () => ({ ok: 1 }) };
        throw new Error("disk");
      },
    };
    globalThis._concordSTATE = { db: bad, concordLinkFrontier: {} };
    const failed = call("link-open", { actor: { userId: "user_link" }, userId: "user_link", db: bad }, { name: "North gate" });
    assert.equal(failed.error, "link_not_saved");
    assert.equal(globalThis._concordSTATE.concordLinkFrontier.links.get("user_link").length, 0);
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='concord_link_frontier_links'").get(),
      undefined,
    );
  });
});
