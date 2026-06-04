// Contract test for Wave 7 / Track B1-B3 — the autonomous agent core.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAgent } from "../migrations/325_agent_identity.js";
import { up as migDisclosure } from "../migrations/324_agent_disclosure.js";
import {
  createAgentSelf,
  getAgentSelf,
  updateAgentSelf,
  reviewAgentValues,
  measureValueDrift,
  composeAgentName,
} from "../lib/agent-self.js";
import { DRIVE_KINDS } from "../lib/ecosystem/drives.js";

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT)`);
  migDisclosure(db);
  migAgent(db);
  // a minimal dtus table so the identity DTU can mint
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, world_id TEXT, kind TEXT, title TEXT, data TEXT, created_at INTEGER)`);
  return db;
}

test("Track B1-B3 — autonomous agent core", async (t) => {
  await t.test("self-naming is deterministic (idempotent across restart)", () => {
    assert.equal(composeAgentName("seed-x"), composeAgentName("seed-x"));
    assert.notEqual(composeAgentName("a"), composeAgentName("b"));
    assert.match(composeAgentName("a"), /^[A-Za-z]+$/);
  });

  await t.test("createAgentSelf installs identity + name + motivation seed + values anchor", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO users (id, name) VALUES ('u1', 'owner')`).run();
    const r = createAgentSelf(db, { userId: "u1", worldId: "concordia-hub", coreValues: ["honesty", "courage"] });
    assert.equal(r.ok, true);
    const self = r.self;
    assert.ok(self.given_name && self.naming_origin === "self_named");
    assert.deepEqual(self.core_values, ["honesty", "courage"], "the values anchor is stored");
    assert.ok(DRIVE_KINDS.every((k) => Number.isFinite(self.drive_profile[k])), "Panksepp motivation seed present");
    assert.equal(self.status, "active");
    // identity DTU minted
    assert.ok(self.identity_dtu_id, "a continuous identity DTU exists");
    const dtu = db.prepare(`SELECT kind FROM dtus WHERE id = ?`).get(self.identity_dtu_id);
    assert.equal(dtu.kind, "agent_identity");
  });

  await t.test("C1 disclosure: the backing account is flagged is_agent", () => {
    const db = setupDb();
    db.prepare(`INSERT INTO users (id, name) VALUES ('u2', 'owner')`).run();
    createAgentSelf(db, { userId: "u2", worldId: "w" });
    const u = db.prepare(`SELECT is_agent, agent_kind FROM users WHERE id = 'u2'`).get();
    assert.equal(u.is_agent, 1);
    assert.equal(u.agent_kind, "resident");
  });

  await t.test("no coded survive() — only the capacity for worth (the drive seed)", () => {
    // The motivation seed is a drive vector, NOT a goal list containing 'survive'.
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w" });
    const seedKeys = Object.keys(r.self.drive_profile);
    assert.deepEqual(seedKeys.sort(), [...DRIVE_KINDS].sort(), "seed is exactly the 7 drives");
    assert.equal(seedKeys.includes("survive"), false, "there is no coded survive drive");
  });

  await t.test("the values anchor cannot be mutated via updateAgentSelf", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["honesty"] });
    const id = r.agentId;
    // attempt to overwrite the anchor — must be ignored
    updateAgentSelf(db, id, { core_values_json: JSON.stringify(["greed"]) });
    assert.deepEqual(getAgentSelf(db, id).core_values, ["honesty"], "anchor is immutable here");
    // a mutable field DOES change
    updateAgentSelf(db, id, { status: "paused" });
    assert.equal(getAgentSelf(db, id).status, "paused");
  });

  await t.test("measureValueDrift scores divergence from the anchor", () => {
    const self = { core_values: ["honesty", "curiosity", "care_for_others"] };
    assert.equal(measureValueDrift(self, ["honesty", "curiosity", "care_for_others"]), 0, "fully aligned");
    assert.ok(measureValueDrift(self, ["honesty"]) > 0, "partial expression → some drift");
    assert.equal(measureValueDrift(self, ["greed", "cruelty"]), 1, "none of the anchor expressed → max drift");
  });

  await t.test("C3 review cadence stamps last_reviewed_at", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w" });
    assert.equal(getAgentSelf(db, r.agentId).last_reviewed_at, null);
    reviewAgentValues(db, r.agentId);
    assert.ok(getAgentSelf(db, r.agentId).last_reviewed_at > 0);
  });

  await t.test("totality: creates the identity row even with no users/dtus tables", () => {
    const bare = new Database(":memory:");
    migAgent(bare); // only agent_identities
    const r = createAgentSelf(bare, { worldId: "w" });
    assert.equal(r.ok, true, "core identity still writes when DTU mint + embodiment degrade");
    assert.equal(getAgentSelf(bare, r.agentId).identity_dtu_id, null);
  });
});
