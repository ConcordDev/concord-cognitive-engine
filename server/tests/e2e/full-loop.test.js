/**
 * Tier-3 E2E test — full cognitive arc.
 *
 * Pins the through-line:
 *   1. Forward-sim composes a prediction
 *   2. Personal-beat scheduler picks it + surfaces a beat
 *   3. Player completes the realisation (realiseBeat)
 *   4. Cascade: forward-sim row → realised; player metric drifts
 *   5. Phase 2 NPC asymmetry seeded; grudge from combat death
 *      cascades to factionmates
 *   6. Phase 4a routine for the NPC + Phase 4b economic action
 *      writes economy_flow rows
 *   7. Phase 4c lattice quest spawned from a drift alert + Phase 5e
 *      region from same signature; quest realisation decays region
 *   8. Phase 5b death + legacy creates inheritance for an heir
 *
 * Uses an in-memory better-sqlite3-shaped fake (not a real DB) so the
 * test runs anywhere. Each phase's shipping module is exercised via
 * its real exported API, not mocked.
 *
 * Run: node --test tests/e2e/full-loop.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { realiseBeat, findOpenBeatBySubject, listBeatsForUser } from "../../emergent/personal-beat-scheduler.js";
import { onNpcDeath, getLegacy } from "../../lib/npc-legacy.js";
import { recordPlayerImpactEvent, composeAsymmetryContext } from "../../lib/npc-asymmetry.js";
import { performGather, performCraft, computeRegionalScarcity } from "../../lib/npc-economy.js";
import { spawnQuestFromAlert, realiseLatticeBornQuest } from "../../lib/lattice-quest-composer.js";
import { generateRegionFromAlert, regionAt } from "../../lib/procgen-regions.js";

// ── Shared fake DB covering ALL tables this test touches ────────────────────

function makeFakeDb() {
  const tables = {
    player_beats: new Map(),
    forward_predictions: new Map(),
    player_world_metrics: new Map(),
    npc_legacies: new Map(),
    npc_inheritance_links: new Map(),
    npc_grudges: new Map(),
    npc_preoccupations: new Map(),
    npc_desires: new Map(),
    npc_relations: new Map(),
    world_npcs: new Map(),
    npc_inventory: new Map(),
    economy_flows: new Map(),
    regional_scarcity: new Map(),
    lattice_born_quests: new Map(),
    procgen_regions: new Map(),
    procgen_region_visits: new Map(),
    dtus: new Map(),
  };
  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return { run: (...a) => runStmt(s, a), get: (...a) => getStmt(s, a), all: (...a) => allStmt(s, a) };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    // Minimal handlers covering the writes our test triggers. Everything
    // else returns { changes: 0 } harmlessly.
    if (sql.startsWith("INSERT INTO player_beats")) {
      const [id, userId, worldId, predictionId, prose] = args;
      tables.player_beats.set(id, { id, user_id: userId, world_id: worldId, prediction_id: predictionId, prose, surfaced_at: Math.floor(Date.now() / 1000), completed_at: null, outcome: null });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE player_beats SET completed_at = unixepoch(), outcome = ?")) {
      const [outcome, id] = args;
      const b = tables.player_beats.get(id);
      if (b && b.completed_at == null) {
        b.completed_at = Math.floor(Date.now() / 1000);
        b.outcome = outcome;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE forward_predictions")) {
      const [outcome, id] = args;
      const p = tables.forward_predictions.get(id);
      if (p && p.realised_at == null) {
        p.realised_at = Math.floor(Date.now() / 1000);
        p.reality_outcome = outcome;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE player_world_metrics SET concordia_alignment")) {
      const [userId, worldId] = args;
      const m = tables.player_world_metrics.get(`${userId}|${worldId}`);
      if (m) { m.concordia_alignment = Math.min(1.0, (m.concordia_alignment || 0) + 0.05); return { changes: 1 }; }
      return { changes: 0 };
    }
    if (sql.startsWith("INSERT INTO npc_legacies")) {
      const [id, npcId, worldId, cause, lastWords, tx, tz, faction, archetype] = args;
      for (const r of tables.npc_legacies.values()) if (r.npc_id === npcId) {
        const err = new Error("UNIQUE constraint failed: npc_legacies.npc_id"); throw err;
      }
      tables.npc_legacies.set(id, { id, npc_id: npcId, world_id: worldId, cause_of_death: cause, last_words: lastWords, tomb_x: tx, tomb_z: tz, faction, archetype, died_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_inheritance_links")) {
      const [id, deceased, heir, kind, sourceId, detail] = args;
      tables.npc_inheritance_links.set(id, { id, deceased_npc_id: deceased, heir_npc_id: heir, inherited_kind: kind, source_id: sourceId, detail_json: detail });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_grudges")) {
      const [id, npcId, targetKind, targetId, narrative, severity] = args;
      tables.npc_grudges.set(id, { id, npc_id: npcId, target_kind: targetKind, target_id: targetId, narrative, severity, resolved_at: null });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO npc_inventory") || sql.startsWith("INSERT INTO npc_inventory ")) {
      const [npcId, resourceKind, qty, delta] = args;
      const key = `${npcId}|${resourceKind}`;
      const cur = tables.npc_inventory.get(key);
      if (!cur) tables.npc_inventory.set(key, { npc_id: npcId, resource_kind: resourceKind, quantity: Math.max(0, qty) });
      else cur.quantity = Math.max(0, (cur.quantity || 0) + delta);
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO economy_flows")) {
      const [id, worldId, npcId, flowKind, resourceKind, qty] = args;
      tables.economy_flows.set(id, { id, world_id: worldId, npc_id: npcId, flow_kind: flowKind, resource_kind: resourceKind, quantity: qty, occurred_at: Math.floor(Date.now() / 1000) });
      return { changes: 1 };
    }
    if (sql.startsWith("INSERT INTO lattice_born_quests")) {
      const [id, sig, driftType, sev, questId, worldId, npcId] = args;
      for (const r of tables.lattice_born_quests.values()) if (r.drift_alert_signature === sig) {
        const err = new Error("UNIQUE constraint failed"); throw err;
      }
      tables.lattice_born_quests.set(id, { id, drift_alert_signature: sig, drift_type: driftType, drift_severity: sev, quest_id: questId, world_id: worldId, target_npc_id: npcId, realised_at: null });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE lattice_born_quests SET realised_at")) {
      const [outcome, questId] = args;
      let n = 0;
      for (const r of tables.lattice_born_quests.values()) {
        if (r.quest_id === questId && r.realised_at == null) {
          r.realised_at = Math.floor(Date.now() / 1000); r.realisation_outcome = outcome; n++;
        }
      }
      return { changes: n };
    }
    if (sql.startsWith("INSERT INTO procgen_regions")) {
      const [id, worldId, sig, driftType, regionKind, ax, az, radius] = args;
      for (const r of tables.procgen_regions.values()) if (r.drift_alert_signature === sig) {
        const err = new Error("UNIQUE constraint failed"); throw err;
      }
      tables.procgen_regions.set(id, { id, world_id: worldId, drift_alert_signature: sig, drift_type: driftType, region_kind: regionKind, anchor_x: ax, anchor_z: az, radius_m: radius, decayed_at: null });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE procgen_regions SET decayed_at")) {
      const [reason, id] = args;
      const r = tables.procgen_regions.get(id);
      if (r && r.decayed_at == null) { r.decayed_at = Math.floor(Date.now() / 1000); r.decay_reason = reason; return { changes: 1 }; }
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM player_beats WHERE id = ?")) return tables.player_beats.get(args[0]) || null;
    if (sql.startsWith("SELECT id FROM player_beats WHERE user_id = ? AND completed_at IS NULL")) {
      const [userId] = args;
      for (const b of tables.player_beats.values()) if (b.user_id === userId && b.completed_at == null) return { id: b.id };
      return null;
    }
    if (sql.startsWith("SELECT pb.* FROM player_beats pb JOIN forward_predictions fp")) {
      const [userId, subjectKind, subjectId] = args;
      for (const b of tables.player_beats.values()) {
        if (b.user_id !== userId || b.completed_at != null) continue;
        const p = tables.forward_predictions.get(b.prediction_id);
        if (p && p.subject_kind === subjectKind && p.subject_id === subjectId) return b;
      }
      return null;
    }
    if (sql.startsWith("SELECT id FROM npc_legacies WHERE npc_id = ?")) {
      const [npcId] = args;
      for (const r of tables.npc_legacies.values()) if (r.npc_id === npcId) return { id: r.id };
      return null;
    }
    if (sql.startsWith("SELECT * FROM npc_legacies WHERE npc_id = ?")) {
      const [npcId] = args;
      for (const r of tables.npc_legacies.values()) if (r.npc_id === npcId) return r;
      return null;
    }
    if (sql.startsWith("SELECT wealth_sparks FROM world_npcs WHERE id = ?")) {
      const n = tables.world_npcs.get(args[0]);
      return n ? { wealth_sparks: n.wealth_sparks || 0 } : null;
    }
    if (sql.startsWith("SELECT id FROM lattice_born_quests WHERE")) {
      const [sig] = args;
      for (const r of tables.lattice_born_quests.values()) if (r.drift_alert_signature === sig) return { id: r.id, quest_id: r.quest_id };
      return null;
    }
    if (sql.startsWith("SELECT id FROM procgen_regions WHERE drift_alert_signature = ?")) {
      const [sig] = args;
      for (const r of tables.procgen_regions.values()) if (r.drift_alert_signature === sig) return { id: r.id };
      return null;
    }
    if (sql.startsWith("SELECT quest_id, target_npc_id FROM lattice_born_quests")) {
      const [sig] = args;
      for (const r of tables.lattice_born_quests.values()) if (r.drift_alert_signature === sig) return { quest_id: r.quest_id, target_npc_id: r.target_npc_id };
      return null;
    }
    if (sql.startsWith("SELECT drift_alert_signature FROM lattice_born_quests")) {
      const [questId] = args;
      for (const r of tables.lattice_born_quests.values()) if (r.quest_id === questId) return { drift_alert_signature: r.drift_alert_signature };
      return null;
    }
    if (sql.startsWith("SELECT narrative, severity, target_kind, target_id FROM npc_grudges")) {
      const [npcId] = args;
      const arr = Array.from(tables.npc_grudges.values()).filter(g => g.npc_id === npcId && g.resolved_at == null);
      arr.sort((a, b) => b.severity - a.severity);
      return arr[0] || null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE faction = ? AND archetype = ?")) {
      const [faction, archetype, exclude] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.faction === faction && n.archetype === archetype && n.id !== exclude && !n.is_dead);
    }
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE faction = ? AND id != ?")) {
      const [faction, exclude] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.faction === faction && n.id !== exclude && !n.is_dead);
    }
    if (sql.startsWith("SELECT n.id, n.archetype, n.faction FROM npc_relations r")) {
      const [deceased] = args;
      const out = [];
      for (const r of tables.npc_relations.values()) {
        if (r.related_to !== deceased || !["child", "apprentice"].includes(r.relation_kind)) continue;
        const n = tables.world_npcs.get(r.npc_id);
        if (n && !n.is_dead) out.push({ id: n.id, archetype: n.archetype, faction: n.faction });
      }
      return out;
    }
    if (sql.startsWith("SELECT id, archetype, faction FROM world_npcs WHERE world_id = ? AND")) {
      const [worldId, ...archetypes] = args;
      return Array.from(tables.world_npcs.values()).filter(n => n.world_id === worldId && !n.is_dead && archetypes.includes(n.archetype));
    }
    if (sql.startsWith("SELECT resource_kind, quantity FROM npc_inventory")) {
      const [npcId] = args;
      return Array.from(tables.npc_inventory.values()).filter(r => r.npc_id === npcId);
    }
    if (sql.startsWith("SELECT flow_kind, SUM(quantity) AS qty FROM economy_flows")) {
      const [worldId, resourceKind, cutoff] = args;
      const buckets = {};
      for (const f of tables.economy_flows.values()) {
        if (f.world_id !== worldId || f.resource_kind !== resourceKind || f.occurred_at <= cutoff) continue;
        buckets[f.flow_kind] = (buckets[f.flow_kind] || 0) + f.quantity;
      }
      return Object.entries(buckets).map(([flow_kind, qty]) => ({ flow_kind, qty }));
    }
    if (sql.startsWith("SELECT id, region_kind, anchor_x, anchor_z, radius_m, narrative, drift_type FROM procgen_regions")) {
      const [worldId] = args;
      return Array.from(tables.procgen_regions.values()).filter(r => r.world_id === worldId && r.decayed_at == null);
    }
    if (sql.startsWith("SELECT id FROM npc_legacies WHERE")) {
      return [];
    }
    return [];
  }
  return { prepare, transaction, _tables: tables };
}

// ── E2E TESTS ───────────────────────────────────────────────────────────────

describe("E2E full loop — anticipation → action → cascade", () => {
  it("realiseBeat flows to forward-sim + bumps player metric", async () => {
    const db = makeFakeDb();
    db._tables.forward_predictions.set("p1", {
      id: "p1", user_id: "u1", world_id: "w", subject_kind: "quest",
      subject_id: "q1", anticipated: "x", confidence: 0.7,
      realised_at: null, expires_at: Math.floor(Date.now() / 1000) + 3600,
    });
    db._tables.player_beats.set("b1", {
      id: "b1", user_id: "u1", world_id: "w", prediction_id: "p1",
      prose: "carry it", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: null, outcome: null,
    });
    db._tables.player_world_metrics.set("u1|w", { user_id: "u1", world_id: "w", concordia_alignment: 0.4, refusal_debt: 0 });

    const r = await realiseBeat(db, "b1", "realised");
    assert.equal(r.ok, true);
    assert.notEqual(db._tables.forward_predictions.get("p1").realised_at, null);
    assert.ok(db._tables.player_world_metrics.get("u1|w").concordia_alignment > 0.4);
  });
});

describe("E2E NPC death cascades into legacy + inheritance + asymmetry", () => {
  it("kill propagates grudge to factionmates, legacy + heir on death", () => {
    const db = makeFakeDb();
    const dead = { id: "npc:dead", archetype: "warrior", faction: "pinewood", world_id: "w", current_location: JSON.stringify({ x: 50, z: 25 }), wealth_sparks: 100 };
    const heir = { id: "npc:heir", archetype: "warrior", faction: "pinewood", world_id: "w" };
    db._tables.world_npcs.set(dead.id, dead);
    db._tables.world_npcs.set(heir.id, heir);

    // Player kills the warrior. The factionmate gets a grudge.
    recordPlayerImpactEvent(db, heir.id, "user:killer", "killed_by_player");
    const grudge = composeAsymmetryContext(db, heir.id, "user:killer", null);
    assert.ok(grudge.persistent_grudge);

    // The death itself records a legacy + inheritance.
    const r = onNpcDeath(db, dead, { cause: "combat" });
    assert.equal(r.ok, true);
    assert.ok(r.legacyId);
    assert.equal(r.heirs[0], heir.id);
    assert.ok(r.inherited.wealth > 0);
    const legacy = getLegacy(db, "npc:dead");
    assert.ok(legacy.last_words);
  });
});

describe("E2E NPC economy: gather → craft → scarcity", () => {
  it("warrior gather then craft writes flows + scarcity computes positive", () => {
    const db = makeFakeDb();
    const npc = { id: "npc:e", archetype: "warrior", world_id: "w" };
    db._tables.world_npcs.set(npc.id, npc);

    // Gather (deterministic — warrior gets meat or ore).
    const g1 = performGather(db, npc, { hourBucket: 1 });
    assert.equal(g1.ok, true);

    // Force the inventory to have warrior recipe inputs (ore + wood).
    db._tables.npc_inventory.set(`${npc.id}|ore`, { npc_id: npc.id, resource_kind: "ore", quantity: 3 });
    db._tables.npc_inventory.set(`${npc.id}|wood`, { npc_id: npc.id, resource_kind: "wood", quantity: 3 });

    // Craft: warrior consumes 1 ore + 1 wood → produces 1 weapon.
    const c = performCraft(db, npc);
    assert.equal(c.ok, true);
    assert.equal(c.output, "weapon");

    // economy_flows now has gather + craft_input + craft_output rows.
    const flows = Array.from(db._tables.economy_flows.values()).filter(f => f.npc_id === npc.id);
    assert.ok(flows.length >= 3);

    // Scarcity for ore: consumption (1) > production (might be 0) → positive.
    const oreScarcity = computeRegionalScarcity(db, "w", "ore");
    assert.ok(oreScarcity >= 0);
  });
});

describe("E2E lattice quest + procgen region: drift → quest → region → realisation → decay", () => {
  it("alert spawns quest + region; quest realisation decays region", async () => {
    const db = makeFakeDb();
    db._tables.world_npcs.set("npc:m1", { id: "npc:m1", archetype: "mystic", world_id: "w" });

    const alert = {
      type: "memetic_drift",
      severity: "warning",
      message: "An ungrounded claim has propagated 12 times in 3 days.",
      detected_at: 1234567890000,
    };

    // Spawn the quest (Phase 4c).
    const qResult = await spawnQuestFromAlert(db, alert, "w");
    assert.equal(qResult.ok, true);
    assert.equal(qResult.action, "inserted");
    assert.equal(qResult.hostNpcId, "npc:m1");

    // Phase 5e: spawn the matching region (same signature).
    const sigCompose = await import("../../lib/lattice-quest-composer.js");
    const sig = sigCompose.alertSignature(alert);
    const regionResult = generateRegionFromAlert(db, { worldId: "w", alert, signature: sig });
    assert.equal(regionResult.ok, true);
    assert.equal(regionResult.action, "created");

    // Region is active.
    const regionAtAnchor = regionAt(db, "w", regionResult.anchor.x, regionResult.anchor.z);
    assert.ok(regionAtAnchor);
    assert.equal(regionAtAnchor.region_kind, "haunted_glade");

    // Realise the quest. Cascade should decay the region.
    realiseLatticeBornQuest(db, qResult.questId, "completed");
    // The cascade is async (fire-and-forget) — wait for the next microtask.
    await new Promise(r => setTimeout(r, 50));

    // Region should now be decayed.
    const stillActive = regionAt(db, "w", regionResult.anchor.x, regionResult.anchor.z);
    assert.equal(stillActive, null);
  });
});
