// FIX-move-builder-005 — the missing row action: duplicate a minted
// move. Hermetic pins for move-builder.duplicate against a real
// in-memory SQLite carrying the legacy dtus shape the list macro reads:
//  1. Duplicating mints a NEW move owned by the caller, named
//     "<name> copy", with the recipe body carried over verbatim apart
//     from the name fields; the list then shows both.
//  2. Another user's move cannot be duplicated (move_not_found) and no
//     row is created.
//  3. An unknown id and a non-move DTU are refused.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import registerMoveBuilderActions from "../domains/move-builder.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
async function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`move-builder.${name}`);
  assert.ok(fn, `move-builder.${name} not registered`);
  return fn(ctx, params); // move-builder macros are (ctx, input) two-arg
}

let db;
before(() => {
  registerMoveBuilderActions(register);
  db = new DatabaseSync(":memory:");
  db.prepare(`CREATE TABLE dtus (
    id TEXT PRIMARY KEY, title TEXT, body_json TEXT, owner_user_id TEXT,
    created_at TEXT, updated_at TEXT
  )`).run();
  const body = JSON.stringify({ kind: "move_recipe", name: "Sky Hook", current_name: "Sky Hook", element: "air", skill_kind: "strike", tier: 2, allocation: { power: 3 } });
  db.prepare(`INSERT INTO dtus (id, title, body_json, owner_user_id) VALUES ('move:user_a:aaa', 'Sky Hook', ?, 'user_a')`).run(body);
  db.prepare(`INSERT INTO dtus (id, title, body_json, owner_user_id) VALUES ('dtu_note', 'Note', ?, 'user_a')`)
    .run(JSON.stringify({ kind: "note", name: "Note" }));
});

const ctxA = { db: null, actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { db: null, actor: { userId: "user_b" }, userId: "user_b" };

describe("move-builder.duplicate", () => {
  it("clones the caller's move under a new id with a copy name", async () => {
    ctxA.db = db;
    const r = await call("duplicate", ctxA, { moveId: "move:user_a:aaa" });
    assert.equal(r.ok, true);
    assert.notEqual(r.moveId, "move:user_a:aaa");
    const list = await call("list", ctxA, {});
    assert.equal(list.moves.length, 2);
    const copy = list.moves.find((m) => m.id === r.moveId);
    assert.equal(copy.name, "Sky Hook copy");
    const orig = db.prepare("SELECT body_json FROM dtus WHERE id = 'move:user_a:aaa'").get();
    assert.equal(JSON.parse(orig.body_json).name, "Sky Hook", "original untouched");
  });

  it("refuses another user's move and unknown ids", async () => {
    ctxB.db = db;
    assert.equal((await call("duplicate", ctxB, { moveId: "move:user_a:aaa" })).ok, false);
    ctxA.db = db;
    assert.equal((await call("duplicate", ctxA, { moveId: "move:nope" })).reason, "move_not_found");
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM dtus").get().c, 3);
  });

  it("refuses a DTU that is not a move recipe", async () => {
    ctxA.db = db;
    const r = await call("duplicate", ctxA, { moveId: "dtu_note" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "move_not_found");
  });
});
