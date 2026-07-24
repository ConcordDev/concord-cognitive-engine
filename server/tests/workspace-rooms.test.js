// server/tests/workspace-rooms.test.js
//
// V1.2 Wave A — shared DTU spaces: discovery metadata for MU2's Shared
// Workspace Room. These tests cover the lib functions directly against a
// real in-memory better-sqlite3 DB (mirroring tests/ambient-chat.test.js's
// pattern) AND the three macros end-to-end through a minimal `register`
// harness (mirroring how server.js's real `register(domain, name, fn)`
// is consumed, without booting the whole server).
//
// Run: node --test server/tests/workspace-rooms.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upWorkspaceRooms } from "../migrations/377_workspace_rooms.js";
import { up as upWorkspaceRoomObjectives } from "../migrations/380_workspace_room_objectives.js";
import { up as upGoalTrees } from "../migrations/340_goal_decomposition.js";
import { up as upAgentMarathon } from "../migrations/171_agent_marathon_sessions.js";
import { up as upAgentMarathonGovernance } from "../migrations/379_agent_marathon_governance.js";
import {
  createRoom, getRoom, listInDistrict, listMine,
  setRoomObjective, getRoomObjective, linkMarathonToRoom, getActiveRoomMarathon,
  describeRoomConkayActivity, startOrResumeConkayAssist, CONKAY_ASSIST_DEFAULT_DOMAINS,
} from "../lib/workspace-rooms.js";
import { createGoalTree } from "../lib/goal-decomposition.js";
import { startMarathon } from "../lib/agent-marathon.js";
import registerWorkspaceRoomMacros from "../domains/workspace-rooms.js";

/** V1.2 Wave A fixture, PLUS the V1.2 Wave B "team mode" additions (mig 380)
 *  and the goal-tree / marathon tables that setRoomObjective /
 *  startOrResumeConkayAssist call straight into (mirrors
 *  tests/agent-projects.test.js's pattern of migrating the tables its lib
 *  file genuinely depends on, rather than running the full ledger). */
function freshDb() {
  const db = new Database(":memory:");
  upWorkspaceRooms(db);
  upGoalTrees(db);
  upAgentMarathon(db);
  upAgentMarathonGovernance(db);
  upWorkspaceRoomObjectives(db);
  return db;
}

/** Minimal macro-registry harness mirroring server.js's real `register`. */
function makeRegistry() {
  const macros = new Map();
  function register(domain, name, fn) {
    if (!macros.has(domain)) macros.set(domain, new Map());
    macros.get(domain).set(name, fn);
  }
  function call(domain, name, ctx, input) {
    const fn = macros.get(domain)?.get(name);
    if (!fn) throw new Error(`macro not registered: ${domain}.${name}`);
    return fn(ctx, input);
  }
  return { register, call };
}

describe("V1.2 Wave A — workspace-rooms lib (direct, real in-memory DB)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("migration applies cleanly to a fresh DB and creates the table + indexes", () => {
    const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_rooms'`).get();
    assert.ok(tbl, "workspace_rooms table exists");
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_workspace_rooms_%'`).all();
    assert.equal(idx.length, 2);
  });

  it("migration is idempotent — re-running up() is a no-op", () => {
    createRoom(db, { ownerId: "u1", worldId: "concordia-hub", name: "Q3 planning" });
    upWorkspaceRooms(db); // second run
    const rows = db.prepare("SELECT COUNT(*) n FROM workspace_rooms").get();
    assert.equal(rows.n, 1, "row preserved across a re-applied migration");
  });

  it("createRoom mints a fresh id + persists owner/world/district/name", () => {
    const r = createRoom(db, { ownerId: "u1", worldId: "concordia-hub", districtId: "plaza", name: "  Roadmap sync  " });
    assert.equal(r.ok, true);
    assert.match(r.room.id, /^wr_[0-9a-f]{16}$/);
    assert.equal(r.room.name, "Roadmap sync", "name is trimmed");
    assert.equal(r.room.owner_id, "u1");
    assert.equal(r.room.world_id, "concordia-hub");
    assert.equal(r.room.district_id, "plaza");
  });

  it("createRoom requires ownerId, worldId, and a non-empty name", () => {
    assert.equal(createRoom(db, { worldId: "w", name: "x" }).ok, false); // no owner
    assert.equal(createRoom(db, { ownerId: "u1", name: "x" }).ok, false); // no world
    assert.equal(createRoom(db, { ownerId: "u1", worldId: "w", name: "   " }).ok, false); // blank name
  });

  it("district anchor is optional — a room can be created with no district", () => {
    const r = createRoom(db, { ownerId: "u1", worldId: "concordia-hub", name: "No anchor" });
    assert.equal(r.ok, true);
    assert.equal(r.room.district_id, null);
  });

  it("getRoom round-trips a created room by id", () => {
    const created = createRoom(db, { ownerId: "u1", worldId: "w", name: "Findable" });
    const found = getRoom(db, created.room.id);
    assert.equal(found.id, created.room.id);
    assert.equal(found.name, "Findable");
  });

  it("listInDistrict scopes by (worldId, districtId) — mirrors ambient-chat's isolation", () => {
    createRoom(db, { ownerId: "u1", worldId: "tunya", districtId: "market", name: "A" });
    createRoom(db, { ownerId: "u2", worldId: "tunya", districtId: "docks", name: "B" });
    createRoom(db, { ownerId: "u3", worldId: "cyber", districtId: "market", name: "C" });

    const market = listInDistrict(db, "tunya", "market");
    assert.equal(market.length, 1);
    assert.equal(market[0].name, "A");

    const docks = listInDistrict(db, "tunya", "docks");
    assert.equal(docks.length, 1);
    assert.equal(docks[0].name, "B");

    const cyberMarket = listInDistrict(db, "cyber", "market");
    assert.equal(cyberMarket.length, 1);
    assert.equal(cyberMarket[0].name, "C");
  });

  it("listInDistrict orders newest first", () => {
    createRoom(db, { ownerId: "u1", worldId: "w", districtId: "d", name: "first" });
    db.prepare("UPDATE workspace_rooms SET created_at = created_at - 100 WHERE name = 'first'").run();
    createRoom(db, { ownerId: "u1", worldId: "w", districtId: "d", name: "second" });
    const list = listInDistrict(db, "w", "d");
    assert.equal(list[0].name, "second");
    assert.equal(list[1].name, "first");
  });

  it("listMine returns only rooms the given owner created", () => {
    createRoom(db, { ownerId: "alice", worldId: "w", name: "Alice's room" });
    createRoom(db, { ownerId: "bob", worldId: "w", name: "Bob's room" });
    const mine = listMine(db, "alice");
    assert.equal(mine.length, 1);
    assert.equal(mine[0].name, "Alice's room");
  });

  it("rooms with no district anchor are absent from listInDistrict but present in listMine", () => {
    createRoom(db, { ownerId: "alice", worldId: "w", name: "Unanchored" });
    assert.equal(listInDistrict(db, "w", "anywhere").length, 0);
    assert.equal(listMine(db, "alice").length, 1);
  });
});

describe("V1.2 Wave A — workspace macros (create-room / list-in-district / list-mine)", () => {
  let db, registry, ctx;
  beforeEach(() => {
    db = freshDb();
    registry = makeRegistry();
    registerWorkspaceRoomMacros(registry.register);
    ctx = { db, actor: { userId: "user_alice" } };
  });

  it("create-room requires an authenticated actor", async () => {
    const r = await registry.call("workspace", "create-room", { db, actor: {} }, { worldId: "w", name: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("create-room requires worldId", async () => {
    const r = await registry.call("workspace", "create-room", ctx, { name: "x" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_world_id");
  });

  it("full round-trip: create -> appears in list-in-district -> appears in list-mine", async () => {
    const created = await registry.call("workspace", "create-room", ctx, {
      name: "Sprint planning",
      worldId: "concordia-hub",
      districtId: "plaza",
    });
    assert.equal(created.ok, true);
    assert.ok(created.room?.id);

    const inDistrict = await registry.call("workspace", "list-in-district", ctx, {
      worldId: "concordia-hub",
      districtId: "plaza",
    });
    assert.equal(inDistrict.ok, true);
    assert.equal(inDistrict.rooms.length, 1);
    assert.equal(inDistrict.rooms[0].id, created.room.id);
    assert.equal(inDistrict.rooms[0].name, "Sprint planning");

    const mine = await registry.call("workspace", "list-mine", ctx, {});
    assert.equal(mine.ok, true);
    assert.equal(mine.rooms.length, 1);
    assert.equal(mine.rooms[0].id, created.room.id);
  });

  it("list-in-district requires both worldId and districtId", async () => {
    const r = await registry.call("workspace", "list-in-district", ctx, { worldId: "w" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("list-mine defaults to ctx.actor.userId when no userId is passed", async () => {
    await registry.call("workspace", "create-room", ctx, { name: "Mine", worldId: "w" });
    const otherCtx = { db, actor: { userId: "user_bob" } };
    await registry.call("workspace", "create-room", otherCtx, { name: "Bob's", worldId: "w" });

    const mine = await registry.call("workspace", "list-mine", ctx, {});
    assert.equal(mine.rooms.length, 1);
    assert.equal(mine.rooms[0].name, "Mine");

    const bobs = await registry.call("workspace", "list-mine", ctx, { userId: "user_bob" });
    assert.equal(bobs.rooms.length, 1);
    assert.equal(bobs.rooms[0].name, "Bob's");
  });

  it("list-mine requires a resolvable user", async () => {
    const r = await registry.call("workspace", "list-mine", { db, actor: {} }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("rooms created by different owners in the same district are all discoverable there", async () => {
    await registry.call("workspace", "create-room", { db, actor: { userId: "alice" } }, {
      name: "Alice room", worldId: "concordia-hub", districtId: "plaza",
    });
    await registry.call("workspace", "create-room", { db, actor: { userId: "bob" } }, {
      name: "Bob room", worldId: "concordia-hub", districtId: "plaza",
    });
    const list = await registry.call("workspace", "list-in-district", ctx, {
      worldId: "concordia-hub", districtId: "plaza",
    });
    assert.equal(list.rooms.length, 2);
  });
});

// ── V1.2 Wave B — "team mode": shared objective + ConKay participation ─────

describe("V1.2 Wave B — migration 380 (workspace room objectives + room<->marathon links)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("workspace_rooms gains nullable objective + goal_tree_id columns", () => {
    const cols = db.prepare(`PRAGMA table_info(workspace_rooms)`).all().map((c) => c.name);
    assert.ok(cols.includes("objective"));
    assert.ok(cols.includes("goal_tree_id"));
  });

  it("a pre-existing room (created before an objective was ever set) reads both new columns as null", () => {
    const r = createRoom(db, { ownerId: "u1", worldId: "w", name: "Old room" });
    assert.equal(r.room.objective, null);
    assert.equal(r.room.goal_tree_id, null);
  });

  it("workspace_room_marathon_links table + both indexes exist", () => {
    const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='workspace_room_marathon_links'`).get();
    assert.ok(tbl);
    const idx = db.prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_workspace_room_marathon_links_%'`).all();
    assert.equal(idx.length, 2);
  });

  it("migration is idempotent — re-running up() twice does not error or duplicate columns", () => {
    assert.doesNotThrow(() => upWorkspaceRoomObjectives(db));
    const cols = db.prepare(`PRAGMA table_info(workspace_rooms)`).all().map((c) => c.name);
    assert.equal(cols.filter((c) => c === "objective").length, 1);
  });
});

describe("V1.2 Wave B — setRoomObjective / getRoomObjective (lib, direct)", () => {
  let db, roomId;
  beforeEach(() => {
    db = freshDb();
    roomId = createRoom(db, { ownerId: "owner1", worldId: "w", name: "Team room" }).room.id;
  });

  it("requires a real room", () => {
    const r = setRoomObjective(db, "wr_nope", "owner1", { objective: "Ship it" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "room_not_found");
  });

  it("requires at least one of objective/goalTreeId/mintGoalTree", () => {
    const r = setRoomObjective(db, roomId, "owner1", {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });

  it("sets a trimmed objective with no goal tree", () => {
    const r = setRoomObjective(db, roomId, "owner1", { objective: "  Ship the v1.2 release  " });
    assert.equal(r.ok, true);
    assert.equal(r.room.objective, "Ship the v1.2 release");
    assert.equal(r.room.goal_tree_id, null);
  });

  it("rejects a blank (whitespace-only) objective", () => {
    const r = setRoomObjective(db, roomId, "owner1", { objective: "   " });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "empty_objective");
  });

  it("passing objective: null clears a previously-set objective", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Something" });
    const cleared = setRoomObjective(db, roomId, "owner1", { objective: null });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.room.objective, null);
  });

  it("mintGoalTree creates + links a fresh goal tree owned by the caller", () => {
    const r = setRoomObjective(db, roomId, "owner1", { objective: "Ship it", mintGoalTree: true });
    assert.equal(r.ok, true);
    assert.ok(r.room.goal_tree_id);
    const got = getRoomObjective(db, roomId);
    assert.equal(got.goalTree.ok, true);
    assert.equal(got.goalTree.tree.userId, "owner1");
  });

  it("linking an existing goalTreeId requires the caller to OWN that tree", () => {
    const tree = createGoalTree(db, { userId: "someone-else", title: "Not yours", mintDtu: false });
    const r = setRoomObjective(db, roomId, "owner1", { goalTreeId: tree.treeId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "goal_tree_not_owned");
  });

  it("linking an existing goalTreeId the caller genuinely owns succeeds", () => {
    const tree = createGoalTree(db, { userId: "owner1", title: "Owned goal", mintDtu: false });
    const r = setRoomObjective(db, roomId, "owner1", { goalTreeId: tree.treeId, objective: "Finish it" });
    assert.equal(r.ok, true);
    assert.equal(r.room.goal_tree_id, tree.treeId);
  });

  it("linking a nonexistent goalTreeId is reported honestly", () => {
    const r = setRoomObjective(db, roomId, "owner1", { goalTreeId: "gt_does_not_exist" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "goal_tree_not_found");
  });

  it("getRoomObjective on a bare room (no objective, no tree) is honest-empty, not fabricated", () => {
    const r = getRoomObjective(db, roomId);
    assert.equal(r.ok, true);
    assert.equal(r.objective, null);
    assert.equal(r.goalTreeId, null);
    assert.equal(r.goalTree, null);
  });

  it("getRoomObjective reflects the REAL live state of the linked tree, not a snapshot", () => {
    const tree = createGoalTree(db, { userId: "owner1", title: "Two-step goal", mintDtu: false });
    setRoomObjective(db, roomId, "owner1", { goalTreeId: tree.treeId, objective: "Do the thing" });

    const before1 = getRoomObjective(db, roomId);
    assert.equal(before1.goalTree.progress, 0);

    db.prepare(`UPDATE goal_nodes SET status = 'done' WHERE id = ?`).run(tree.rootId);
    db.prepare(`UPDATE goal_trees SET status = 'done' WHERE id = ?`).run(tree.treeId);

    const after = getRoomObjective(db, roomId);
    assert.equal(after.goalTree.tree.status, "done");
  });

  it("getRoomObjective reports a dangling goal_tree_id plainly, never fabricated", () => {
    const tree = createGoalTree(db, { userId: "owner1", title: "Doomed", mintDtu: false });
    setRoomObjective(db, roomId, "owner1", { goalTreeId: tree.treeId });
    db.prepare(`DELETE FROM goal_trees WHERE id = ?`).run(tree.treeId);
    db.prepare(`DELETE FROM goal_nodes WHERE tree_id = ?`).run(tree.treeId);

    const r = getRoomObjective(db, roomId);
    assert.equal(r.ok, true, "the room itself is still fine");
    assert.equal(r.goalTree.ok, false);
    assert.equal(r.goalTree.reason, "tree_not_found");
  });
});

describe("V1.2 Wave B — linkMarathonToRoom / getActiveRoomMarathon (lib, direct)", () => {
  let db, roomId;
  beforeEach(() => {
    db = freshDb();
    roomId = createRoom(db, { ownerId: "owner1", worldId: "w", name: "Room" }).room.id;
  });

  it("requires both sides to genuinely exist, and is idempotent", () => {
    assert.equal(linkMarathonToRoom(db, "wr_missing", "mar_x").reason, "room_not_found");
    assert.equal(linkMarathonToRoom(db, roomId, "mar_missing").reason, "marathon_not_found");

    const mar = startMarathon(db, "owner1", { goal: "do a thing" });
    const r1 = linkMarathonToRoom(db, roomId, mar.sessionId);
    assert.equal(r1.ok, true);
    const r2 = linkMarathonToRoom(db, roomId, mar.sessionId); // re-link
    assert.equal(r2.ok, true, "idempotent re-link is a no-op, not an error");
    const links = db.prepare(`SELECT COUNT(*) n FROM workspace_room_marathon_links WHERE room_id = ?`).get(roomId);
    assert.equal(links.n, 1);
  });

  it("getActiveRoomMarathon returns null when nothing is linked", () => {
    assert.equal(getActiveRoomMarathon(db, roomId), null);
  });

  it("getActiveRoomMarathon finds a linked pending/running/paused session", () => {
    const mar = startMarathon(db, "owner1", { goal: "do a thing" });
    linkMarathonToRoom(db, roomId, mar.sessionId);
    const active = getActiveRoomMarathon(db, roomId);
    assert.ok(active);
    assert.equal(active.id, mar.sessionId);
    assert.equal(active.status, "pending");
  });

  it("getActiveRoomMarathon skips a terminal (abandoned/completed/failed/revoked) session", () => {
    const mar = startMarathon(db, "owner1", { goal: "do a thing" });
    linkMarathonToRoom(db, roomId, mar.sessionId);
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned' WHERE id = ?`).run(mar.sessionId);
    assert.equal(getActiveRoomMarathon(db, roomId), null);
  });

  it("a room can accumulate multiple sessions; only the active one surfaces", () => {
    const m1 = startMarathon(db, "owner1", { goal: "first attempt" });
    linkMarathonToRoom(db, roomId, m1.sessionId);
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'abandoned' WHERE id = ?`).run(m1.sessionId);

    const m2 = startMarathon(db, "owner1", { goal: "second attempt" });
    linkMarathonToRoom(db, roomId, m2.sessionId);

    const active = getActiveRoomMarathon(db, roomId);
    assert.equal(active.id, m2.sessionId);
  });
});

describe("V1.2 Wave B — describeRoomConkayActivity (honest activity summary, never fabricated)", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("returns null for no session", () => {
    assert.equal(describeRoomConkayActivity(null), null);
  });

  it("a pending session (started, not yet ticked) reads as queued, not 'working'", () => {
    const mar = startMarathon(db, "u1", { goal: "goal text" });
    const session = { id: mar.sessionId, status: "pending", total_turns: 0, max_turns: 200, updated_at: 1, turns: [] };
    const d = describeRoomConkayActivity(session);
    assert.equal(d.label, "Queued to start");
    assert.deepEqual(d.lastToolCalls, []);
  });

  it("a running session with a real last tool call names that exact tool, not a generic 'thinking'", () => {
    const session = {
      id: "mar_x", status: "running", total_turns: 3, max_turns: 200, updated_at: 1,
      turns: [
        { role: "user", content: "goal" },
        { role: "assistant", content: "working...", tool_calls: [{ tool: "run_lens_action", params: { domain: "decomp" } }] },
      ],
    };
    const d = describeRoomConkayActivity(session);
    assert.equal(d.label, "Working — last action: run_lens_action");
    assert.deepEqual(d.lastToolCalls, ["run_lens_action"]);
  });

  it("a running session with no tool calls yet reads as a real (non-fabricated-detail) working state", () => {
    const session = { id: "mar_x", status: "running", total_turns: 1, max_turns: 200, updated_at: 1, turns: [{ role: "assistant", content: "x", tool_calls: [] }] };
    const d = describeRoomConkayActivity(session);
    assert.equal(d.label, "Working on the shared objective");
  });

  it("a paused session reads as blocked, not silently 'done'", () => {
    const session = { id: "mar_x", status: "paused", total_turns: 2, max_turns: 200, updated_at: 1, turns: [] };
    const d = describeRoomConkayActivity(session);
    assert.equal(d.label, "Paused — blocked, waiting on the team");
  });
});

describe("V1.2 Wave B — startOrResumeConkayAssist (lib, direct)", () => {
  let db, roomId;
  beforeEach(() => {
    db = freshDb();
    roomId = createRoom(db, { ownerId: "owner1", worldId: "w", name: "Team room" }).room.id;
  });

  it("requires a real room and an authenticated caller", () => {
    assert.equal(startOrResumeConkayAssist(db, "wr_missing", "owner1").reason, "room_not_found");
    assert.equal(startOrResumeConkayAssist(db, roomId, null).reason, "no_user");
  });

  it("refuses to start on a room with no objective set", () => {
    const r = startOrResumeConkayAssist(db, roomId, "owner1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "objective_not_set");
  });

  it("refuses to start on a room with an objective but no linked goal tree", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Ship it" });
    const r = startOrResumeConkayAssist(db, roomId, "owner1");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "goal_tree_not_linked");
  });

  it("starts a new, bounded marathon session once objective + goal tree are both set", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Ship the v1.2 release", mintGoalTree: true });
    const r = startOrResumeConkayAssist(db, roomId, "owner1");
    assert.equal(r.ok, true);
    assert.equal(r.resumed, false);
    assert.ok(r.sessionId);

    const session = db.prepare(`SELECT allowed_domains_json, goal, title FROM agent_marathon_sessions WHERE id = ?`).get(r.sessionId);
    assert.deepEqual(JSON.parse(session.allowed_domains_json), [...CONKAY_ASSIST_DEFAULT_DOMAINS]);
    assert.match(session.goal, /Ship the v1\.2 release/);
    assert.match(session.title, /Team room/);

    // Real, honest linkage — findable via the same path a poll would use.
    const active = getActiveRoomMarathon(db, roomId);
    assert.equal(active.id, r.sessionId);
  });

  it("an explicit allowedDomains/budgetCap override is honored instead of the default", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Ship it", mintGoalTree: true });
    const r = startOrResumeConkayAssist(db, roomId, "owner1", { allowedDomains: ["dtu"], budgetCap: 42 });
    assert.equal(r.ok, true);
    const session = db.prepare(`SELECT allowed_domains_json, budget_cap FROM agent_marathon_sessions WHERE id = ?`).get(r.sessionId);
    assert.deepEqual(JSON.parse(session.allowed_domains_json), ["dtu"]);
    assert.equal(session.budget_cap, 42);
  });

  it("a second call resumes the SAME session instead of starting a duplicate worker", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Ship it", mintGoalTree: true });
    const first = startOrResumeConkayAssist(db, roomId, "owner1");
    const second = startOrResumeConkayAssist(db, roomId, "owner1");
    assert.equal(second.ok, true);
    assert.equal(second.resumed, true);
    assert.equal(second.sessionId, first.sessionId);

    const links = db.prepare(`SELECT COUNT(*) n FROM workspace_room_marathon_links WHERE room_id = ?`).get(roomId);
    assert.equal(links.n, 1, "only one session was ever linked");
  });

  it("once the linked session goes terminal, the next call starts a genuinely new one", () => {
    setRoomObjective(db, roomId, "owner1", { objective: "Ship it", mintGoalTree: true });
    const first = startOrResumeConkayAssist(db, roomId, "owner1");
    db.prepare(`UPDATE agent_marathon_sessions SET status = 'completed' WHERE id = ?`).run(first.sessionId);

    const second = startOrResumeConkayAssist(db, roomId, "owner1");
    assert.equal(second.resumed, false);
    assert.notEqual(second.sessionId, first.sessionId);
  });
});

describe("V1.2 Wave B — workspace macros (set-objective / get-objective / conkay-assist / conkay-status)", () => {
  let db, registry, ctx, roomId;
  beforeEach(() => {
    db = freshDb();
    registry = makeRegistry();
    registerWorkspaceRoomMacros(registry.register);
    ctx = { db, actor: { userId: "owner1" } };
    roomId = createRoom(db, { ownerId: "owner1", worldId: "w", name: "Macro room" }).room.id;
  });

  it("set-objective requires an authenticated actor and a roomId", async () => {
    const noUser = await registry.call("workspace", "set-objective", { db, actor: {} }, { roomId, objective: "x" });
    assert.equal(noUser.reason, "no_user");
    const noRoom = await registry.call("workspace", "set-objective", ctx, { objective: "x" });
    assert.equal(noRoom.reason, "missing_room_id");
  });

  it("set-objective -> get-objective round-trip through the macro layer", async () => {
    const set = await registry.call("workspace", "set-objective", ctx, {
      roomId, objective: "Ship v1.2", mintGoalTree: true,
    });
    assert.equal(set.ok, true);
    assert.ok(set.room.goal_tree_id);

    const got = await registry.call("workspace", "get-objective", ctx, { roomId });
    assert.equal(got.ok, true);
    assert.equal(got.objective, "Ship v1.2");
    assert.equal(got.goalTree.ok, true);
  });

  it("get-objective requires roomId but not authentication (shared-room read)", async () => {
    const r = await registry.call("workspace", "get-objective", { db, actor: {} }, { roomId });
    assert.equal(r.ok, true);
  });

  it("conkay-assist requires an authenticated actor and refuses without an objective+tree", async () => {
    const noUser = await registry.call("workspace", "conkay-assist", { db, actor: {} }, { roomId });
    assert.equal(noUser.reason, "no_user");

    const bare = await registry.call("workspace", "conkay-assist", ctx, { roomId });
    assert.equal(bare.ok, false);
    assert.equal(bare.reason, "objective_not_set");
  });

  it("conkay-assist starts a bounded session once the room has an objective + goal tree, and conkay-status reflects it honestly", async () => {
    await registry.call("workspace", "set-objective", ctx, { roomId, objective: "Ship v1.2", mintGoalTree: true });

    const idleStatus = await registry.call("workspace", "conkay-status", ctx, { roomId });
    assert.equal(idleStatus.ok, true);
    assert.equal(idleStatus.active, false, "no ConKay session yet — honestly reports inactive, not a fake 'thinking'");

    const started = await registry.call("workspace", "conkay-assist", ctx, { roomId });
    assert.equal(started.ok, true);
    assert.equal(started.resumed, false);
    assert.ok(started.sessionId);

    const activeStatus = await registry.call("workspace", "conkay-status", ctx, { roomId });
    assert.equal(activeStatus.ok, true);
    assert.equal(activeStatus.active, true);
    assert.equal(activeStatus.activity.sessionId, started.sessionId);
    assert.equal(activeStatus.activity.label, "Queued to start");
  });

  it("conkay-assist called twice resumes the same session through the macro layer too", async () => {
    await registry.call("workspace", "set-objective", ctx, { roomId, objective: "Ship v1.2", mintGoalTree: true });
    const first = await registry.call("workspace", "conkay-assist", ctx, { roomId });
    const second = await registry.call("workspace", "conkay-assist", ctx, { roomId });
    assert.equal(second.resumed, true);
    assert.equal(second.sessionId, first.sessionId);
  });
});
