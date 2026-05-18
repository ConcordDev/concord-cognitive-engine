// server/tests/smoking-gun-sprint-3.test.js
//
// Sprint 3 (I9) — read paths for 8 write-only audit tables.
// Each table now has a macro that surfaces the data.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerAuditReadsMacros from "../domains/audit-reads.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  // Stub world_npcs (FK target for migration 189's ALTER TABLE)
  db.exec(`CREATE TABLE IF NOT EXISTS world_npcs (id TEXT PRIMARY KEY, name TEXT, world_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))`);
  for (const m of ["110_affect_state", "127_knowledge_trade", "135_land_claims", "137_procgen_regions", "165_classroom_research", "186_war_campaigns", "189_npc_equal_agency", "226_social_durable", "227_social_ai"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  registerAuditReadsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

describe("I9 — affect.affect_history", () => {
  it("returns recent affect events for an entity", async () => {
    db.prepare(`INSERT INTO affect_events_log (id, entity_id, world_id, event_type, delta_json) VALUES (?, ?, ?, ?, ?)`)
      .run("ae:1", "npc:test", "concordia-hub", "USER_MESSAGE", '{"valence":0.1}');
    const r = await MACROS.get("affect_history")(ctx("u"), { entityId: "npc:test" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.deepEqual(r.history[0].delta, { valence: 0.1 });
  });

  it("rejects missing entityId", async () => {
    const r = await MACROS.get("affect_history")(ctx("u"), {});
    assert.equal(r.reason, "entityId_required");
  });
});

describe("I9 — classroom.list_submissions + grade_submission", () => {
  it("list returns submissions for a cohort", async () => {
    db.prepare(`INSERT INTO homework_submissions (cohort_id, student_user_id, dtu_id) VALUES (?, ?, ?)`)
      .run(42, "u_student", "dtu:abc");
    const r = await MACROS.get("list_submissions")(ctx("u_teach"), { cohortId: 42 });
    assert.equal(r.ok, true);
    assert.ok(r.submissions.find((s) => s.student_user_id === "u_student"));
  });

  it("filter=ungraded excludes graded", async () => {
    db.prepare(`INSERT INTO homework_submissions (cohort_id, student_user_id, dtu_id, score, reviewed_at) VALUES (?, ?, ?, ?, unixepoch())`)
      .run(42, "u_student2", "dtu:def", 90);
    const ungraded = await MACROS.get("list_submissions")(ctx("u"), { cohortId: 42, filter: "ungraded" });
    assert.ok(!ungraded.submissions.find((s) => s.student_user_id === "u_student2"));
  });

  it("grade clamps to 0-100", async () => {
    db.prepare(`INSERT INTO homework_submissions (id, cohort_id, student_user_id, dtu_id) VALUES (?, ?, ?, ?)`)
      .run(999, 42, "u_g", "dtu:g");
    const r = await MACROS.get("grade_submission")(ctx("u_t"), { submissionId: 999, score: 150 });
    assert.equal(r.ok, true);
    assert.equal(r.score, 100);
  });
});

describe("I9 — land-claims.history", () => {
  it("returns event timeline for a claim", async () => {
    db.prepare(`INSERT INTO land_claim_events (id, claim_id, kind, actor_id, detail_json) VALUES (?, ?, ?, ?, ?)`)
      .run("lce:1", "claim:abc", "trespass", "u_intruder", '{"x":1}');
    const r = await MACROS.get("history")(ctx("u"), { claimId: "claim:abc" });
    assert.equal(r.ok, true);
    assert.equal(r.events[0].kind, "trespass");
    assert.deepEqual(r.events[0].detail, { x: 1 });
  });
});

describe("I9 — npc.ambition_log", () => {
  it("filters by worldId", async () => {
    db.prepare(`INSERT INTO npc_ambition_log (id, npc_id, move_kind, world_id) VALUES (?, ?, ?, ?)`)
      .run("amb:1", "npc:x", "declare_war", "concordia-hub");
    db.prepare(`INSERT INTO npc_ambition_log (id, npc_id, move_kind, world_id) VALUES (?, ?, ?, ?)`)
      .run("amb:2", "npc:y", "betray", "tunya");
    const r = await MACROS.get("ambition_log")(ctx("u"), { worldId: "tunya" });
    assert.equal(r.count, 1);
    assert.equal(r.ambitions[0].npc_id, "npc:y");
  });
});

describe("I9 — npc-economy.skill_acquisitions", () => {
  it("filters by buyerNpcId", async () => {
    db.prepare(`INSERT INTO npc_skill_acquisitions (id, buyer_npc_id, seller_npc_id, recipe_dtu_id, price) VALUES (?, ?, ?, ?, ?)`)
      .run("sa:1", "npc:buyer", "npc:seller", "dtu:recipe", 50);
    const r = await MACROS.get("skill_acquisitions")(ctx("u"), { buyerNpcId: "npc:buyer" });
    assert.equal(r.count, 1);
    assert.equal(r.acquisitions[0].price, 50);
  });
});

describe("I9 — procgen.user_visits", () => {
  it("returns visits + uniqueRegions count", async () => {
    db.prepare(`INSERT INTO procgen_region_visits (id, region_id, user_id) VALUES (?, ?, ?)`).run("v:1", "r:a", "u_explorer");
    db.prepare(`INSERT INTO procgen_region_visits (id, region_id, user_id) VALUES (?, ?, ?)`).run("v:2", "r:a", "u_explorer");
    db.prepare(`INSERT INTO procgen_region_visits (id, region_id, user_id) VALUES (?, ?, ?)`).run("v:3", "r:b", "u_explorer");
    const r = await MACROS.get("user_visits")(ctx("u_explorer"));
    assert.equal(r.count, 3);
    assert.equal(r.uniqueRegions, 2);
  });
});

describe("I9 — social-ai.get_ranking_audit", () => {
  it("returns parsed breakdown + reasons", async () => {
    db.prepare(`INSERT INTO social_ranking_audit (user_id, post_id, algo_id, score, breakdown_json, reasons_json) VALUES (?, ?, ?, ?, ?, ?)`)
      .run("u_a", "post:x", "algo:seed:inverse_x", 7.5, '{"informative":1.5}', '["boosted because informative=0.85"]');
    const r = await MACROS.get("get_ranking_audit")(ctx("u_a"), { postId: "post:x" });
    assert.equal(r.count, 1);
    assert.deepEqual(r.audit[0].breakdown, { informative: 1.5 });
    assert.equal(r.audit[0].reasons[0], "boosted because informative=0.85");
  });
});

describe("I9 — war-campaigns.town_capture_history", () => {
  it("filters by realmId (either side)", async () => {
    db.prepare(`INSERT INTO war_town_captures (id, campaign_id, territory_id, from_realm_id, to_realm_id) VALUES (?, ?, ?, ?, ?)`)
      .run("tc:1", "c:1", "t:1", "realm:north", "realm:south");
    const r1 = await MACROS.get("town_capture_history")(ctx("u"), { realmId: "realm:south" });
    assert.equal(r1.count, 1);
    const r2 = await MACROS.get("town_capture_history")(ctx("u"), { realmId: "realm:irrelevant" });
    assert.equal(r2.count, 0);
  });
});
