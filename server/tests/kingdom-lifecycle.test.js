// FIX-kingdoms-001 — kingdom lifecycle for your own kingdom: the
// ruler can rename, abdicate (crown passes to the longest-serving
// noble/resident; alone → dissolved), and dissolve; a resident can
// leave; the ruler cannot simply leave. Before, lib/kingdom.js had
// found/join/contest only — no lifecycle exits at all.
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { up as up105 } from "../migrations/105_kingdoms.js";
import {
  foundKingdom, joinKingdom, getKingdom, listResidents,
  updateKingdom, leaveKingdom, abdicateKingdom, deleteKingdom,
} from "../lib/kingdom.js";

const POLY = [[0, 0], [10, 0], [10, 10], [0, 10]];
let db;

beforeEach(() => {
  db = new DatabaseSync(":memory:");
  up105(db);
});

function found() {
  const r = foundKingdom(db, { rulerId: "ruler1", worldId: "w1", regionPolygon: POLY, name: "Old Name" });
  assert.equal(r.ok, true);
  return r.kingdomId;
}

describe("kingdom lifecycle (FIX-kingdoms-001)", () => {
  it("renames for the ruler; refuses non-rulers and empty names", () => {
    const id = found();
    assert.equal(updateKingdom(db, id, "ruler1", { name: "  New Name  " }).ok, true);
    assert.equal(getKingdom(db, id).name, "New Name");
    assert.equal(updateKingdom(db, id, "someone", { name: "Hijack" }).error, "not_ruler");
    assert.equal(updateKingdom(db, id, "ruler1", { name: "   " }).error, "name_required");
  });

  it("a resident can leave; the ruler cannot (must abdicate)", () => {
    const id = found();
    joinKingdom(db, id, "cit1");
    assert.equal(leaveKingdom(db, id, "cit1").ok, true);
    assert.equal(listResidents(db, id).some((r) => r.user_id === "cit1"), false);
    assert.equal(leaveKingdom(db, id, "ruler1").error, "ruler_must_abdicate");
    assert.equal(leaveKingdom(db, id, "ghost").error, "not_resident");
  });

  it("abdication passes the crown to the longest-serving resident; ex-ruler stays a citizen", () => {
    const id = found();
    joinKingdom(db, id, "cit1");
    joinKingdom(db, id, "cit2");
    const r = abdicateKingdom(db, id, "ruler1");
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "succeeded");
    assert.equal(r.newRulerId, "cit1");
    assert.equal(getKingdom(db, id).ruler_user_id, "cit1");
    const roles = Object.fromEntries(listResidents(db, id).map((x) => [x.user_id, x.role]));
    assert.equal(roles["cit1"], "ruler");
    assert.equal(roles["ruler1"], "citizen");
  });

  it("abdication with no heir dissolves; dissolve is ruler-only and total", () => {
    const id = found();
    const r = abdicateKingdom(db, id, "ruler1");
    assert.equal(r.outcome, "dissolved");
    assert.equal(getKingdom(db, id), null);

    const id2 = found();
    joinKingdom(db, id2, "cit1");
    assert.equal(deleteKingdom(db, id2, "cit1").error, "not_ruler");
    assert.equal(deleteKingdom(db, id2, "ruler1").ok, true);
    assert.equal(getKingdom(db, id2), null);
    assert.equal(listResidents(db, id2).length, 0);
  });
});
