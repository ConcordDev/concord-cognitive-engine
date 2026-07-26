// server/tests/dtu-props.test.js
//
// Contract tests for server/lib/dtu-props.js (master-spec §3.3, units B6-B9
// — DTUs as tangible interactive world props) and its thin macro wrapper
// server/domains/dtu-props.js.
//
// Real :memory: SQLite + the actual migrations the production server runs
// (same pattern as tests/royalty-cascade.test.js) — no hand-rolled mock DB.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig001 from "../migrations/001_core_tables.js";
import * as mig008 from "../migrations/008_economic_system.js";
import * as mig032 from "../migrations/032_consent_layer.js";
import * as mig064 from "../migrations/064_crafting_and_skills.js";
import * as mig087 from "../migrations/087_dtus_type_creator_data.js";
import * as mig225 from "../migrations/225_dtu_world_id.js";

import {
  propPlacementsForWorld,
  canInteract,
  inspectProp,
  takeProp,
  leaveProp,
  arrangeProp,
  interactWithProp,
  slotForDtuType,
  isVisibleToRequester,
  deterministicPosition,
  placementRules,
  SLOT_TYPES,
} from "../lib/dtu-props.js";
import { grantConsent } from "../lib/consent.js";
import { seedRoomsForBuilding } from "../lib/building-interiors.js";

import registerDtuPropsMacros from "../domains/dtu-props.js";

function createDb() {
  const db = new Database(":memory:");
  // This build's better-sqlite3 defaults foreign_keys ON; `dtus.owner_user_id`
  // has an `ON DELETE SET NULL` FK to `users(id)` and these tests use
  // synthetic user ids ("alice"/"carol"/...) with no `users` row. Matches
  // the same pragma-off precedent already used by
  // tests/quests-domain-macros.test.js and tests/stealth-perception.test.js.
  db.pragma("foreign_keys = OFF");
  mig001.up(db);
  mig008.up(db);
  mig032.up(db);
  mig064.up(db);
  mig087.up(db);
  mig225.up(db);
  return db;
}

function insertDtu(db, {
  id, ownerId, title = "Untitled", type = "knowledge", visibility = "private", worldId = "concordia-hub", data = "{}",
}) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, creator_id, title, body_json, data, tags_json, visibility, tier, type, world_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, '{}', ?, '[]', ?, 'regular', ?, ?, datetime('now'), datetime('now'))
  `).run(id, ownerId, ownerId, title, data, visibility, type, worldId);
}

describe("dtu-props — placement derivation", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("slotForDtuType is a deterministic, real heuristic over the DTU's own type field", () => {
    assert.equal(slotForDtuType("spell_recipe"), "counter");
    assert.equal(slotForDtuType("photography"), "window");
    assert.equal(slotForDtuType("knowledge_base"), "shelf");
    assert.equal(slotForDtuType("something_unclassified"), "plaza");
  });

  it("deterministicPosition is a pure function of the id — same input, same output, no randomness", () => {
    const p1 = deterministicPosition("dtu_fixed_id", { slot: "plaza" });
    const p2 = deterministicPosition("dtu_fixed_id", { slot: "plaza" });
    assert.deepEqual(p1, p2);
    const p3 = deterministicPosition("dtu_other_id", { slot: "plaza" });
    assert.notDeepEqual(p1, p3, "different ids should (almost always) yield different positions");
  });

  it("placementRules() exposes the same slot list the module actually uses", () => {
    const rules = placementRules();
    assert.deepEqual(rules.slots.sort(), [...SLOT_TYPES].sort());
    assert.ok(rules.kindToSlot.length > 0);
  });

  it("lists only visible placements for a world, honoring owner vs public vs private", () => {
    insertDtu(db, { id: "d_public", ownerId: "alice", title: "Public Recipe", type: "recipe", visibility: "public" });
    insertDtu(db, { id: "d_private_other", ownerId: "bob", title: "Bob Secret", type: "knowledge", visibility: "private" });
    insertDtu(db, { id: "d_private_mine", ownerId: "alice", title: "Alice Notes", type: "knowledge", visibility: "private" });

    const asAlice = propPlacementsForWorld(db, "concordia-hub", { requesterId: "alice" });
    assert.equal(asAlice.ok, true);
    const idsAlice = asAlice.placements.map((p) => p.dtuId).sort();
    assert.deepEqual(idsAlice, ["d_private_mine", "d_public"]);

    const asStranger = propPlacementsForWorld(db, "concordia-hub", { requesterId: "carol" });
    const idsStranger = asStranger.placements.map((p) => p.dtuId);
    assert.deepEqual(idsStranger, ["d_public"]);

    const asAnon = propPlacementsForWorld(db, "concordia-hub", {});
    assert.deepEqual(asAnon.placements.map((p) => p.dtuId), ["d_public"]);
  });

  it("honest failure on missing worldId / db", () => {
    assert.equal(propPlacementsForWorld(db, null).reason, "missing_world_id");
    assert.equal(propPlacementsForWorld(null, "w1").reason, "no_db");
  });

  it("places a shelf-slot DTU inside a real library room when the building has one", () => {
    seedRoomsForBuilding(db, "bldg_1", "concordia-hub", "library");
    insertDtu(db, { id: "d_book", ownerId: "alice", title: "Codex", type: "knowledge_base", visibility: "public" });

    const result = propPlacementsForWorld(db, "concordia-hub", { buildingId: "bldg_1", requesterId: "alice" });
    assert.equal(result.ok, true);
    const placed = result.placements.find((p) => p.dtuId === "d_book");
    assert.ok(placed, "book DTU should be placed");
    assert.equal(placed.slot, "shelf");
    assert.ok(placed.roomId, "shelf slot should resolve into the library room");
    // Position bounded within the library room's real footprint.
    const room = db.prepare("SELECT * FROM building_rooms WHERE building_id = ? AND room_type = 'library'").get("bldg_1");
    assert.ok(Math.abs(placed.position[0]) <= room.width / 2 + 0.01);
    assert.ok(Math.abs(placed.position[2]) <= room.depth / 2 + 0.01);
  });

  it("an arranged prop's stored placement wins over the deterministic default", () => {
    insertDtu(db, { id: "d_arr", ownerId: "alice", title: "Arranged", type: "recipe", visibility: "public" });
    const before = propPlacementsForWorld(db, "concordia-hub", { requesterId: "alice" }).placements.find((p) => p.dtuId === "d_arr");
    assert.equal(before.arranged, false);

    const arranged = arrangeProp(db, "alice", "d_arr", { slot: "window", position: [1, 2, 3], roomId: "custom_room" });
    assert.equal(arranged.ok, true);

    const after = propPlacementsForWorld(db, "concordia-hub", { requesterId: "alice" }).placements.find((p) => p.dtuId === "d_arr");
    assert.equal(after.arranged, true);
    assert.equal(after.slot, "window");
    assert.deepEqual(after.position, [1, 2, 3]);
    assert.equal(after.roomId, "custom_room");
  });
});

describe("dtu-props — governance (canInteract)", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("inspect: allowed for public DTUs, denied for someone else's private DTU", () => {
    insertDtu(db, { id: "d_pub", ownerId: "alice", visibility: "public" });
    insertDtu(db, { id: "d_priv", ownerId: "alice", visibility: "private" });

    assert.equal(canInteract(db, "carol", "d_pub", "inspect").allowed, true);
    const gate = canInteract(db, "carol", "d_priv", "inspect");
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "not_visible");
    // Owner can always inspect their own private DTU.
    assert.equal(canInteract(db, "alice", "d_priv", "inspect").allowed, true);
  });

  it("inspect: honest not_found for a nonexistent id", () => {
    assert.deepEqual(canInteract(db, "carol", "does_not_exist", "inspect"), { allowed: false, reason: "not_found" });
  });

  it("take: rejected without citation consent — never fabricates success", () => {
    insertDtu(db, { id: "d_pub_nocon", ownerId: "alice", visibility: "public" });
    // Public visibility alone does NOT imply consent for a private-scope
    // owner in the underlying canCiteSpecificDtu rule set — but public
    // visibility DOES satisfy it directly (see consent.js). To exercise the
    // real rejection path, use a DTU that is NOT public/marketplace and
    // whose owner has not granted allow_citation.
    insertDtu(db, { id: "d_gated", ownerId: "alice", visibility: "internal" });
    const gate = canInteract(db, "carol", "d_gated", "take");
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "citation_consent_not_granted");
  });

  it("take: allowed once the owner grants allow_citation consent", () => {
    insertDtu(db, { id: "d_gated2", ownerId: "alice", visibility: "internal" });
    assert.equal(canInteract(db, "carol", "d_gated2", "take").allowed, false);
    grantConsent(db, "alice", "allow_citation");
    assert.equal(canInteract(db, "carol", "d_gated2", "take").allowed, true);
  });

  it("take: allowed on a public DTU without any extra consent grant", () => {
    insertDtu(db, { id: "d_pub2", ownerId: "alice", visibility: "public" });
    assert.equal(canInteract(db, "carol", "d_pub2", "take").allowed, true);
  });

  it("take: your own DTU is trivially allowed (alreadyOwned), no citation needed", () => {
    insertDtu(db, { id: "d_mine", ownerId: "alice", visibility: "private" });
    const gate = canInteract(db, "alice", "d_mine", "take");
    assert.equal(gate.allowed, true);
    assert.equal(gate.alreadyOwned, true);
  });

  it("leave: denied when the requester never took the prop", () => {
    insertDtu(db, { id: "d_pub3", ownerId: "alice", visibility: "public" });
    const gate = canInteract(db, "carol", "d_pub3", "leave");
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "not_holding");
  });

  it("arrange: owner-only", () => {
    insertDtu(db, { id: "d_own", ownerId: "alice", visibility: "public" });
    assert.equal(canInteract(db, "alice", "d_own", "arrange").allowed, true);
    const gate = canInteract(db, "carol", "d_own", "arrange");
    assert.equal(gate.allowed, false);
    assert.equal(gate.reason, "not_owner");
  });
});

describe("dtu-props — take/leave round-trip through the REAL citation macro", () => {
  let db;
  beforeEach(() => { db = createDb(); });

  it("take mints a real DTU that cites the parent via registerCitation, honestly rejects without consent", () => {
    insertDtu(db, { id: "d_parent", ownerId: "alice", title: "Alice's Blueprint", type: "blueprint", visibility: "internal" });

    const rejected = takeProp(db, "carol", "d_parent");
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "citation_consent_not_granted");
    // No orphan child row left behind on rejection.
    const orphan = db.prepare("SELECT COUNT(*) AS c FROM dtus WHERE type = 'dtu_prop_take'").get();
    assert.equal(orphan.c, 0);

    grantConsent(db, "alice", "allow_citation");
    const taken = takeProp(db, "carol", "d_parent");
    assert.equal(taken.ok, true);
    assert.ok(taken.childId);
    assert.ok(taken.lineageId);

    // The lineage row is real, in royalty_lineage, pointing at the real parent.
    const lineage = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").get(taken.childId);
    assert.ok(lineage);
    assert.equal(lineage.parent_id, "d_parent");
    assert.equal(lineage.creator_id, "carol");
    assert.equal(lineage.parent_creator, "alice");

    // The child DTU is a real, owned row.
    const child = db.prepare("SELECT * FROM dtus WHERE id = ?").get(taken.childId);
    assert.equal(child.owner_user_id, "carol");
    assert.equal(child.type, "dtu_prop_take");

    // Idempotent — taking again returns the same child, doesn't duplicate.
    const takenAgain = takeProp(db, "carol", "d_parent");
    assert.equal(takenAgain.ok, true);
    assert.equal(takenAgain.alreadyTaken, true);
    assert.equal(takenAgain.childId, taken.childId);
    const count = db.prepare("SELECT COUNT(*) AS c FROM dtus WHERE type = 'dtu_prop_take'").get().c;
    assert.equal(count, 1);
  });

  it("leave deletes the held reference; a stranger cannot leave someone else's hold", () => {
    insertDtu(db, { id: "d_parent2", ownerId: "alice", visibility: "public" });
    const taken = takeProp(db, "carol", "d_parent2");
    assert.equal(taken.ok, true);

    const strangerLeave = leaveProp(db, "dave", "d_parent2");
    assert.equal(strangerLeave.ok, false);
    assert.equal(strangerLeave.reason, "not_holding");

    const left = leaveProp(db, "carol", "d_parent2");
    assert.equal(left.ok, true);
    assert.equal(left.releasedChildId, taken.childId);

    const gone = db.prepare("SELECT * FROM dtus WHERE id = ?").get(taken.childId);
    assert.equal(gone, undefined);

    // Leaving again (nothing left to leave) is an honest rejection, not a
    // silent no-op success.
    const leaveAgain = leaveProp(db, "carol", "d_parent2");
    assert.equal(leaveAgain.ok, false);
    assert.equal(leaveAgain.reason, "not_holding");
  });

  it("arrange writes ownership-gated placement into the DTU's own data column, rejects non-owners", () => {
    insertDtu(db, { id: "d_arr2", ownerId: "alice", visibility: "public" });
    const denied = arrangeProp(db, "carol", "d_arr2", { slot: "shelf", position: [1, 1, 1] });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, "not_owner");

    const ok = arrangeProp(db, "alice", "d_arr2", { slot: "shelf", position: [5, 0, 5], roomId: "room_x" });
    assert.equal(ok.ok, true);
    const row = db.prepare("SELECT data FROM dtus WHERE id = ?").get("d_arr2");
    const meta = JSON.parse(row.data);
    assert.deepEqual(meta.propPlacement.position, [5, 0, 5]);
    assert.equal(meta.propPlacement.slot, "shelf");
    assert.equal(meta.propPlacement.roomId, "room_x");
  });

  it("interactWithProp dispatches identically to the direct functions and rejects unknown actions", () => {
    insertDtu(db, { id: "d_dispatch", ownerId: "alice", visibility: "public" });
    const inspected = interactWithProp(db, "carol", "d_dispatch", "inspect");
    assert.equal(inspected.ok, true);
    assert.equal(inspected.dtu.id, "d_dispatch");

    const bad = interactWithProp(db, "carol", "d_dispatch", "detonate");
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_action");
  });
});

describe("dtu-props — visibility predicate (isVisibleToRequester)", () => {
  it("matches the exact rule cross-lens-discovery applies elsewhere", () => {
    assert.equal(isVisibleToRequester({ visibility: "public", creator_id: "x" }, null), true);
    assert.equal(isVisibleToRequester({ visibility: "private", creator_id: "x" }, null), false);
    assert.equal(isVisibleToRequester({ visibility: "private", creator_id: "x" }, "x"), true);
    assert.equal(isVisibleToRequester({ visibility: "internal", creator_id: "x" }, "y"), false);
  });
});

describe("dtu-props — macro wrapper (server/domains/dtu-props.js)", () => {
  let db;
  const macros = new Map();
  const register = (domain, name, handler) => {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, handler);
  };
  const run = (domain, name, ctx, input) => macros.get(domain).get(name)(ctx, input);

  beforeEach(() => {
    db = createDb();
    registerDtuPropsMacros(register);
  });

  it("dtu_props.list requires a worldId and returns real placements", async () => {
    insertDtu(db, { id: "d_m1", ownerId: "alice", visibility: "public" });
    const missing = await run("dtu_props", "list", { db }, {});
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing_world_id");

    const result = await run("dtu_props", "list", { db, actor: { userId: "alice" } }, { worldId: "concordia-hub" });
    assert.equal(result.ok, true);
    assert.equal(result.placements.length, 1);
  });

  it("dtu_props.interact requires auth for mutating actions but not for inspect", async () => {
    insertDtu(db, { id: "d_m2", ownerId: "alice", visibility: "public" });
    const anonInspect = await run("dtu_props", "interact", { db, actor: { userId: "anon" } }, { dtuId: "d_m2", action: "inspect" });
    assert.equal(anonInspect.ok, true);

    const anonTake = await run("dtu_props", "interact", { db, actor: { userId: "anon" } }, { dtuId: "d_m2", action: "take" });
    assert.equal(anonTake.ok, false);
    assert.equal(anonTake.reason, "auth_required");

    const authedTake = await run("dtu_props", "interact", { db, actor: { userId: "carol" } }, { dtuId: "d_m2", action: "take" });
    assert.equal(authedTake.ok, true);
  });

  it("dtu_props.interact rejects an invalid action honestly", async () => {
    insertDtu(db, { id: "d_m3", ownerId: "alice", visibility: "public" });
    const bad = await run("dtu_props", "interact", { db, actor: { userId: "alice" } }, { dtuId: "d_m3", action: "steal" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "invalid_action");
  });
});
