// Sere main arc — the interlocking payoff. Assembling the proof + reuniting Amon
// & Pell heals the Twin Pact, which cuts the Tessera's managed-parity funding so
// the war can finally resolve and the Open Table can cohere. Pins the mechanical
// consequence (not just the prose) + the authored quest chain shape.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { up as upFactionStrategy } from "../migrations/117_faction_strategy.js";
import { up as upFunding } from "../migrations/321_faction_funding.js";
import { up as upQuestState } from "../migrations/068_quest_state_machine.js";
import { recordFunding, clampParity, healTwinPact, activeFunding } from "../lib/tessera-parity.js";
import registerArcMacros from "../domains/arc.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function freshDb() {
  const db = new Database(":memory:");
  upFactionStrategy(db);
  upFunding(db);
  upQuestState(db);
  // a player who has reached the final heal/hold branch (gates arc.heal_twin_pact)
  db.prepare("INSERT OR IGNORE INTO player_quests (id, user_id, quest_id, world_id, status) VALUES ('pq1','u1','sere_arc_4_heal_the_pact','sere','active')").run();
  for (const [fid, mom] of [["dovrane", -0.5], ["keshar", -0.55]]) {
    db.prepare("INSERT INTO faction_strategy_state (faction_id, stance, momentum, next_move_at, updated_at) VALUES (?, 'war', ?, 0, unixepoch())").run(fid, mom);
  }
  recordFunding(db, { worldId: "sere", funderId: "the_tessera", warFactionA: "dovrane", warFactionB: "keshar" });
  return db;
}

describe("Sere arc payoff — heal the Twin Pact", () => {
  it("cuts the managed-parity funding and flips the relation to truce", () => {
    process.env.CONCORD_TESSERA_PARITY = "1";
    const db = freshDb();
    assert.equal(activeFunding(db, "sere").length, 1, "funded before");
    const r = healTwinPact(db, { worldId: "sere" });
    assert.equal(r.ok, true);
    assert.ok(r.fundingCut >= 1, "funding cut");
    assert.equal(r.relation, "truce");
    assert.equal(activeFunding(db, "sere").length, 0, "no managed parity after healing");
    delete process.env.CONCORD_TESSERA_PARITY;
  });

  it("after healing, parity no longer clamps — the war can finally resolve", () => {
    process.env.CONCORD_TESSERA_PARITY = "1";
    const db = freshDb();
    healTwinPact(db, { worldId: "sere" });
    // drive a belligerent toward collapse; with funding gone it stays there (free to truce)
    db.prepare("UPDATE faction_strategy_state SET momentum=-0.7 WHERE faction_id='keshar'").run();
    clampParity(db, "sere");
    assert.equal(db.prepare("SELECT momentum FROM faction_strategy_state WHERE faction_id='keshar'").get().momentum, -0.7,
      "no longer topped up — the truce machine can fire");
    delete process.env.CONCORD_TESSERA_PARITY;
  });

  it("open_table_status reports cohesion once the parity is cut", () => {
    process.env.CONCORD_TESSERA_PARITY = "1";
    const db = freshDb();
    const m = new Map();
    registerArcMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    assert.equal(m.get("arc.open_table_status")({ db }, {}).openTableCanCohere, false, "blocked while funded");
    m.get("arc.heal_twin_pact")({ db, actor: { userId: "u1" } }, {});
    assert.equal(m.get("arc.open_table_status")({ db }, {}).openTableCanCohere, true, "coheres once cut");
    delete process.env.CONCORD_TESSERA_PARITY;
  });

  it("heal_twin_pact rejects anonymous + un-progressed callers (auth gate)", () => {
    process.env.CONCORD_TESSERA_PARITY = "1";
    const db = freshDb();
    const m = new Map();
    registerArcMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    // anonymous / unauthenticated → blocked (POST /api/lens/run is public)
    assert.equal(m.get("arc.heal_twin_pact")({ db }, {}).reason, "auth_required");
    assert.equal(m.get("arc.heal_twin_pact")({ db, actor: { userId: "anon" } }, {}).reason, "auth_required");
    // authenticated but never reached the final arc quest → blocked
    assert.equal(m.get("arc.heal_twin_pact")({ db, actor: { userId: "stranger" } }, {}).reason, "arc_not_reached");
    // funding is untouched after the rejected attempts
    assert.equal(activeFunding(db, "sere").length, 1, "still funded — no unauthorized cut");
    // the player who reached the branch can heal
    assert.equal(m.get("arc.heal_twin_pact")({ db, actor: { userId: "u1" } }, {}).ok, true);
    delete process.env.CONCORD_TESSERA_PARITY;
  });

  it("the authored arc is a 4-quest chain ending on the heal/hold branch", () => {
    const arc = JSON.parse(readFileSync(path.resolve(__dirname, "../../content/world/sere/quests/main-arc.json"), "utf8"));
    assert.equal(arc.length, 4);
    assert.equal(arc[0].id, "sere_arc_1_the_ferrymans_hint");
    // chain is linked
    assert.deepEqual(arc[0].unlocks_quests, ["sere_arc_2_assemble_the_proof"]);
    assert.deepEqual(arc[3].prerequisite_quests, ["sere_arc_3_interrupt_the_tea"]);
    // the proof is two halves
    const proof = arc[1].objectives.map((o) => o.target);
    assert.ok(proof.includes("amons_letters") && proof.includes("sarns_dual_manifests"));
    // the finale branches heal vs hold
    assert.ok(arc[3].branch_consequences.heal_the_pact && arc[3].branch_consequences.hold_for_leverage);
  });
});
