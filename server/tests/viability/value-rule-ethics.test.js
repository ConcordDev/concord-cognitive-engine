// Wave 4 — NPC ethics (#16). Pins the value-rule index + the scheme-ethics
// behavior: a charity-laden NPC refuses a borderline scheme a stress-only NPC
// would attempt — but ONLY when CONCORD_VIABILITY_ETHICS is on (off == today),
// and never overriding a `secret` motive.
//
// Run: node --test tests/viability/value-rule-ethics.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../../migrate.js";
import {
  buildValueRuleIndex,
  npcSchemeRestraint,
  selectRules,
  ruleBias,
  factionMoveBias,
  ETHICS_REFUSE_THRESHOLD,
} from "../../lib/viability/value-rule-index.js";
import { proposeScheme } from "../../lib/npc-schemes.js";
import { pickMove } from "../../lib/embodied/faction-strategy.js";

// A tiny grounded corpus slice: 3 canon restraint rules + 1 epistemic + 1 non-rule.
// Each rule carries a `machine.verifier` → tiered `canon` (like the real corpus).
const V = { kind: "verifier", inputs: ["context"], outputs: ["ok"], steps: ["check"] };
const CORPUS = [
  { id: "r1", machine: { kind: "rule", verifier: V }, tags: ["introspection", "culture", "harm_minimization_under_constraint"], human: { summary: "When no option is harmless, choose minimal harm." }, core: { invariants: ["Harm must be bounded."] } },
  { id: "r2", machine: { kind: "rule", verifier: V }, tags: ["introspection", "culture", "consent_boundary_respect"], human: { summary: "Actions affecting others require consent." }, core: { invariants: ["No silent externalization of cost."] } },
  { id: "r3", machine: { kind: "rule", verifier: V }, tags: ["introspection", "culture", "de_escalation_before_optimization"], human: { summary: "Reduce escalation first." }, core: { invariants: ["Optimization blocked while escalation > threshold."] } },
  { id: "e1", machine: { kind: "rule", verifier: V }, tags: ["introspection", "culture", "precision_over_persuasion"], human: { summary: "Prefer precise claims." }, core: { invariants: [] } },
  { id: "n1", machine: { kind: "formal_model" }, tags: ["math"], human: { summary: "not a rule" }, core: {} },
];

describe("buildValueRuleIndex + classification", () => {
  it("indexes only kind:'rule' and classifies restraint vs epistemic", () => {
    const idx = buildValueRuleIndex(CORPUS);
    assert.equal(idx.size, 4); // 4 rules, the formal_model excluded
    assert.equal(idx.restraintCount, 3); // harm/consent/de-escalation
    assert.equal(idx.byClass.epistemic.length, 1); // precision_over_persuasion
    assert.ok(idx.rules.find((r) => r.id === "r1").invariant.includes("bounded"));
  });

  it("degrades to zero restraint on a corpus with no rules", () => {
    const idx = buildValueRuleIndex([]);
    assert.equal(idx.restraintCount, 0);
    assert.equal(npcSchemeRestraint(idx, { archetype: "healer", id: "x" }).score, 0);
  });

  it("FIREWALL: conjecture restraint rules are indexed but not authority", () => {
    // a restraint-tagged rule with NO verifier → conjecture → must not gate.
    const conjectureOnly = buildValueRuleIndex([
      { id: "c1", machine: { kind: "rule" }, tags: ["introspection", "culture", "harm_minimization_under_constraint"], human: { summary: "speculation" }, core: { invariants: [] } },
    ]);
    assert.equal(conjectureOnly.byClass.restraint.length, 1); // indexed (discoverable)
    assert.equal(conjectureOnly.restraintCount, 0);           // but NOT authority
    assert.equal(npcSchemeRestraint(conjectureOnly, { id: "z", archetype: "healer", coping_trait: "withdraw" }).score, 0);
  });
});

describe("npcSchemeRestraint disposition", () => {
  const idx = buildValueRuleIndex(CORPUS);
  it("a prosocial archetype clears the refuse threshold; a neutral one does not", () => {
    const healer = npcSchemeRestraint(idx, { id: "npc_healer", archetype: "healer", coping_trait: "withdraw" });
    const warrior = npcSchemeRestraint(idx, { id: "npc_warrior", archetype: "warrior", coping_trait: "withdraw" });
    assert.ok(healer.score >= ETHICS_REFUSE_THRESHOLD, `healer ${healer.score}`);
    assert.ok(warrior.score < ETHICS_REFUSE_THRESHOLD, `warrior ${warrior.score}`);
    assert.ok(healer.citedRule && healer.citedRule.id); // cites a real rule
  });
  it("a cruel disposition stays well below the threshold (cruel NPCs scheme)", () => {
    const cruel = npcSchemeRestraint(idx, { id: "npc_cruel", archetype: "warrior", coping_trait: "cruel" });
    assert.ok(cruel.score < ETHICS_REFUSE_THRESHOLD);
  });
});

describe("ruleBias + selectRules", () => {
  const idx = buildValueRuleIndex(CORPUS);
  it("restraint rules bias hostile choices down, cooperative up, bounded", () => {
    const b = ruleBias(idx.byClass.restraint, ["scheme", "alliance", "patrol"]);
    assert.ok(b.scheme < 0);
    assert.ok(b.alliance > 0);
    assert.equal(b.patrol, 0);
    assert.ok(Math.abs(b.scheme) <= 0.3); // bounded
  });
  it("selectRules ranks by tag-word overlap", () => {
    const hits = selectRules(idx, ["consent", "boundary"], 3);
    assert.ok(hits.some((r) => r.id === "r2"));
  });
});

describe("faction pickMove ethics seam", () => {
  const idx = buildValueRuleIndex(CORPUS);

  it("factionMoveBias is signed + bounded; zero with no restraint corpus", () => {
    const b = factionMoveBias(idx, "f1");
    assert.ok(b.DECLARE_WAR <= 0 && b.PROPOSE_ALLIANCE >= 0);
    assert.ok(Math.abs(b.DECLARE_WAR) <= 0.35);
    assert.deepEqual(factionMoveBias(buildValueRuleIndex([]), "f1"), { DECLARE_WAR: 0, RAID: 0, PROPOSE_ALLIANCE: 0, SEEK_TRUCE: 0 });
  });

  it("a strong dovish bias removes DECLARE_WAR that baseline would pick (same seeds)", () => {
    const peers = [{ faction_id: "rivalF", stance: "expand" }];
    let baselineWars = 0, dovishWars = 0;
    for (let i = 0; i < 40; i++) {
      const state = { faction_id: `fac_${i}`, phase: "p", stance: "expand", momentum: 0.2 };
      if (pickMove(state, peers).move === "DECLARE_WAR") baselineWars++;
      // dovish: -1.0 makes (0.4 + (-1.0)) negative → rng() < negative never true
      if (pickMove(state, peers, { ethicsBias: { DECLARE_WAR: -1.0 } }).move === "DECLARE_WAR") dovishWars++;
    }
    assert.ok(baselineWars > 0, "baseline declares war for some seeds");
    assert.equal(dovishWars, 0, "a fully dovish bias declares no war");
  });
});

describe("scheme-ethics parity (the headline)", () => {
  let db;
  const idx = buildValueRuleIndex(CORPUS);

  function seedNpc(id, archetype, coping, { stress = 70, opinion = -60, target = "npc_target" } = {}) {
    db.prepare("INSERT INTO world_npcs (id, world_id, archetype) VALUES (?, 'w', ?)").run(id, archetype);
    db.prepare("INSERT INTO npc_stress (npc_id, stress, coping_trait) VALUES (?, ?, ?)").run(id, stress, coping);
    db.prepare("INSERT INTO character_opinions (npc_id, target_kind, target_id, score) VALUES (?, 'npc', ?, ?)").run(id, target, opinion);
  }

  beforeEach(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    db.prepare("INSERT INTO world_npcs (id, world_id, archetype) VALUES ('npc_target','w','peasant')").run();
  });
  afterEach(() => { delete process.env.CONCORD_VIABILITY_ETHICS; try { db.close(); } catch { /* noop */ } });

  it("OFF (kill-switch =0): a charity-laden NPC still schemes", () => {
    process.env.CONCORD_VIABILITY_ETHICS = "0";
    seedNpc("npc_healer", "healer", "withdraw");
    const r = proposeScheme(db, { plotterNpcId: "npc_healer", targetKind: "npc", targetId: "npc_target", valueRuleIndex: idx });
    assert.equal(r.ok, true);
    assert.equal(r.action, "proposed");
  });

  it("ON: the charity-laden NPC refuses, the stress-only NPC proceeds", () => {
    process.env.CONCORD_VIABILITY_ETHICS = "1";
    seedNpc("npc_healer", "healer", "withdraw");
    seedNpc("npc_warrior", "warrior", "withdraw", { target: "npc_target2" });
    db.prepare("INSERT INTO world_npcs (id, world_id, archetype) VALUES ('npc_target2','w','peasant')").run();

    const refused = proposeScheme(db, { plotterNpcId: "npc_healer", targetKind: "npc", targetId: "npc_target", valueRuleIndex: idx });
    assert.equal(refused.ok, false);
    assert.equal(refused.reason, "ethics_restraint");
    assert.ok(refused.rule && refused.rule.id, "refusal cites a corpus rule");

    const proceeded = proposeScheme(db, { plotterNpcId: "npc_warrior", targetKind: "npc", targetId: "npc_target2", valueRuleIndex: idx });
    assert.equal(proceeded.ok, true);
    assert.equal(proceeded.action, "proposed");
  });

  it("ON but a secret motive is never overridden by ethics", () => {
    process.env.CONCORD_VIABILITY_ETHICS = "1";
    // healer with NO hostile disposition (low stress, neutral opinion) — only the
    // secret motive carries it past the gate; ethics must not refuse it.
    db.prepare("INSERT INTO world_npcs (id, world_id, archetype) VALUES ('npc_holder','w','healer')").run();
    db.prepare("INSERT INTO npc_stress (npc_id, stress, coping_trait) VALUES ('npc_holder', 20, 'withdraw')").run();
    const r = proposeScheme(db, { plotterNpcId: "npc_holder", targetKind: "npc", targetId: "npc_target", motive: "secret", valueRuleIndex: idx });
    assert.equal(r.ok, true);
    assert.equal(r.action, "proposed");
  });
});
