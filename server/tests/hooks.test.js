/**
 * D5 — CK3 hooks (information-as-spendable-leverage) contract tests.
 *
 * Pins the deterministic behaviour of server/lib/hooks.js + its wiring into
 * npc-schemes (strong-hook block, success bonus, blackmail intervene) and
 * inheritance. No RNG in any resolution path here.
 *
 * Run: node --test tests/hooks.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as up152 } from "../migrations/152_npc_stress.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { up as up155 } from "../migrations/155_npc_schemes.js";
import { up as up277 } from "../migrations/277_npc_hooks.js";

import {
  grantHook,
  generateHookFromSecretDiscovery,
  getHooksHeldBy,
  hasStrongHookOver,
  blocksHostileAction,
  successBonusFor,
  spendHook,
  coerce,
  inheritHooks,
  decaySweep,
  getHookSummaryForTrait,
  HOOK_CONSTANTS,
} from "../lib/hooks.js";
import { proposeScheme, proposePlayerScheme, interveneInScheme } from "../lib/npc-schemes.js";
import { getOpinion } from "../lib/npc-opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up152(db); up153(db); up154(db); up155(db); up277(db);
  return db;
}

function seedSecret(db, { id, holder, subjectId, difficulty = 4, subjectKind = "npc" }) {
  db.prepare(`
    INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
    VALUES (?, ?, ?, ?, 'debt', 'x', ?)
  `).run(id, holder, subjectKind, subjectId, difficulty);
  return id;
}

describe("D5 hooks — grantHook", () => {
  it("grants a fresh hook", () => {
    const db = setupDb();
    const r = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "weak" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "granted");
    assert.equal(r.strength, "weak");
  });

  it("is idempotent on (holder,target,secret)", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1" });
    const r2 = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1" });
    assert.equal(r2.action, "exists");
    assert.equal(getHooksHeldBy(db, "player", "u1").length, 1);
  });

  it("upgrades weak → strong on re-grant", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1", strength: "weak" });
    const up = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", sourceSecretId: "s1", strength: "strong" });
    assert.equal(up.action, "upgraded");
    assert.equal(up.strength, "strong");
  });

  it("rejects a self-hook", () => {
    const db = setupDb();
    const r = grantHook(db, { holderKind: "npc", holderId: "n1", targetKind: "npc", targetId: "n1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self_hook");
  });
});

describe("D5 hooks — generateHookFromSecretDiscovery", () => {
  it("yields a WEAK hook for an easy secret", () => {
    const db = setupDb();
    seedSecret(db, { id: "s1", holder: "n_holder", subjectId: "n_subject", difficulty: 4 });
    const r = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: "s1" });
    assert.equal(r.ok, true);
    assert.equal(r.strength, "weak");
    // hook is over the SUBJECT, not the holder
    const held = getHooksHeldBy(db, "player", "u1");
    assert.equal(held[0].target_id, "n_subject");
  });

  it("yields a STRONG hook for a hard secret (difficulty ≥ 7)", () => {
    const db = setupDb();
    seedSecret(db, { id: "s2", holder: "n_holder", subjectId: "n_subject", difficulty: 8 });
    const r = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: "s2" });
    assert.equal(r.strength, "strong");
  });

  it("promotes to STRONG on corroboration (a second secret on same subject)", () => {
    const db = setupDb();
    seedSecret(db, { id: "s3", holder: "n_h1", subjectId: "n_subject", difficulty: 3 });
    seedSecret(db, { id: "s4", holder: "n_h2", subjectId: "n_subject", difficulty: 3 });
    const r1 = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: "s3" });
    assert.equal(r1.strength, "weak");
    const r2 = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: "s4" });
    assert.equal(r2.strength, "strong");
  });

  it("refuses a world-subject secret (no coercible target)", () => {
    const db = setupDb();
    seedSecret(db, { id: "s5", holder: "n_h", subjectId: "concordia-hub", subjectKind: "world", difficulty: 9 });
    const r = generateHookFromSecretDiscovery(db, { holderId: "u1", secretId: "s5" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "subject_not_coercible");
  });
});

describe("D5 hooks — reads + spend", () => {
  it("hasStrongHookOver / blocksHostileAction", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "npc", holderId: "target_npc", targetKind: "npc", targetId: "plotter_npc", strength: "strong" });
    assert.equal(hasStrongHookOver(db, "npc", "target_npc", "npc", "plotter_npc"), true);
    // target holds a strong hook over the plotter → plotter is blocked
    assert.equal(blocksHostileAction(db, { plotterKind: "npc", plotterId: "plotter_npc", targetKind: "npc", targetId: "target_npc" }), true);
    // reverse direction is NOT blocked
    assert.equal(blocksHostileAction(db, { plotterKind: "npc", plotterId: "target_npc", targetKind: "npc", targetId: "plotter_npc" }), false);
  });

  it("successBonusFor scales weak < strong", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "weak", sourceSecretId: "a" });
    assert.equal(successBonusFor(db, { plotterKind: "player", plotterId: "u1", targetKind: "npc", targetId: "n1" }), HOOK_CONSTANTS.SUCCESS_BONUS_WEAK);
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "strong", sourceSecretId: "a" });
    assert.equal(successBonusFor(db, { plotterKind: "player", plotterId: "u1", targetKind: "npc", targetId: "n1" }), HOOK_CONSTANTS.SUCCESS_BONUS_STRONG);
  });

  it("spendHook consumes a weak hook and rejects re-spend", () => {
    const db = setupDb();
    const g = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "weak" });
    const s1 = spendHook(db, g.hookId);
    assert.equal(s1.action, "consumed");
    assert.equal(s1.usesLeft, 0);
    const s2 = spendHook(db, g.hookId);
    assert.equal(s2.ok, false);
    assert.equal(s2.reason, "spent");
  });

  it("spendHook rejects an expired hook", () => {
    const db = setupDb();
    const g = grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "strong", at: 1000 });
    // expires_at = 1000 + TTL; spend "after" that
    const s = spendHook(db, g.hookId, { at: 1000 + HOOK_CONSTANTS.HOOK_TTL_S + 1 });
    assert.equal(s.ok, false);
    assert.equal(s.reason, "expired");
  });
});

describe("D5 hooks — coerce", () => {
  it("spends a hook and records resentment opinion on an NPC target", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "weak" });
    const r = coerce(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1" });
    assert.equal(r.ok, true);
    assert.equal(r.action, "coerced");
    assert.equal(r.opinionDelta, HOOK_CONSTANTS.COERCE_OPINION_DELTA);
    const op = getOpinion(db, "n1", "player", "u1");
    assert.equal(op.score, HOOK_CONSTANTS.COERCE_OPINION_DELTA);
  });

  it("returns no_hook when the holder has no leverage", () => {
    const db = setupDb();
    const r = coerce(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_hook");
  });
});

describe("D5 hooks — inheritance", () => {
  it("re-points a hook held over the deceased to the heir, and passes held hooks on", () => {
    const db = setupDb();
    // player holds a hook over the dead NPC
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "dead_lord", strength: "strong", sourceSecretId: "s1" });
    // dead NPC held a hook over a third NPC
    grantHook(db, { holderKind: "npc", holderId: "dead_lord", targetKind: "npc", targetId: "rival", strength: "weak", sourceSecretId: "s2" });

    const r = inheritHooks(db, "dead_lord", "heir_npc");
    assert.equal(r.ok, true);
    assert.equal(r.transferredOver, 1);
    assert.equal(r.transferredHeld, 1);

    // the player's hook now bites the heir (decayed to weak), the original is retired
    const overHeir = getHooksHeldBy(db, "player", "u1");
    assert.equal(overHeir.length, 1);
    assert.equal(overHeir[0].target_id, "heir_npc");
    assert.equal(overHeir[0].strength, "weak");

    // the heir now holds the deceased's hook over the rival
    const heirHolds = getHooksHeldBy(db, "npc", "heir_npc");
    assert.ok(heirHolds.some((h) => h.target_id === "rival"));
    // the deceased holds nothing active anymore
    assert.equal(getHooksHeldBy(db, "npc", "dead_lord").length, 0);
  });
});

describe("D5 hooks — decaySweep + trait summary", () => {
  it("decaySweep marks expired hooks spent", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", at: 1000 });
    const r = decaySweep(db, 1000 + HOOK_CONSTANTS.HOOK_TTL_S + 1);
    assert.equal(r.expired, 1);
    assert.equal(getHooksHeldBy(db, "player", "u1").length, 0);
  });

  it("getHookSummaryForTrait reports both directions", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "n1", strength: "strong" });
    grantHook(db, { holderKind: "npc", holderId: "n1", targetKind: "player", targetId: "u1", strength: "weak" });
    const s = getHookSummaryForTrait(db, "n1", "u1");
    assert.equal(s.playerHolds.strength, "strong");
    assert.equal(s.npcHolds.strength, "weak");
  });
});

describe("D5 hooks — scheme wiring", () => {
  it("a target's strong hook blocks the plotter's scheme (even with motive:secret)", () => {
    const db = setupDb();
    // target holds a strong hook over the plotter
    grantHook(db, { holderKind: "npc", holderId: "target_npc", targetKind: "npc", targetId: "plotter_npc", strength: "strong" });
    const r = proposeScheme(db, { plotterNpcId: "plotter_npc", targetKind: "npc", targetId: "target_npc", kind: "blackmail", motive: "secret" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "hooked");
  });

  it("a plotter's hook raises the scheme's starting success_pct", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "npc", holderId: "plotter_npc", targetKind: "npc", targetId: "victim", strength: "strong" });
    const r = proposeScheme(db, { plotterNpcId: "plotter_npc", targetKind: "npc", targetId: "victim", kind: "blackmail", motive: "secret" });
    assert.equal(r.ok, true);
    const sch = db.prepare(`SELECT success_pct FROM npc_schemes WHERE id = ?`).get(r.schemeId);
    // blackmail base 50 + strong bonus 20 = 70
    assert.equal(sch.success_pct, 50 + HOOK_CONSTANTS.SUCCESS_BONUS_STRONG);
  });

  it("player scheme blocked when target NPC holds a strong hook over them", () => {
    const db = setupDb();
    grantHook(db, { holderKind: "npc", holderId: "n_target", targetKind: "player", targetId: "u1", strength: "strong" });
    const r = proposePlayerScheme(db, "u1", { targetKind: "npc", targetId: "n_target", kind: "blackmail" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "hooked");
  });

  it("blackmail intervene spends the player's hook and abandons the scheme", () => {
    const db = setupDb();
    // an active NPC scheme against the player
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, next_tick_at)
      VALUES ('sch1', 'npc', 'plotter_npc', 'player', 'u1', 'blackmail', 'recruiting', 50, 10, 0)
    `).run();
    // the player holds a hook over the plotter
    grantHook(db, { holderKind: "player", holderId: "u1", targetKind: "npc", targetId: "plotter_npc", strength: "weak" });

    const r = interveneInScheme(db, "u1", "sch1", "blackmail");
    assert.equal(r.ok, true);
    assert.equal(r.abandoned, true);
    const sch = db.prepare(`SELECT phase FROM npc_schemes WHERE id = 'sch1'`).get();
    assert.equal(sch.phase, "abandoned");
    // hook is now spent
    assert.equal(getHooksHeldBy(db, "player", "u1").length, 0);
  });

  it("blackmail intervene without a hook fails cleanly", () => {
    const db = setupDb();
    db.prepare(`
      INSERT INTO npc_schemes (id, plotter_kind, plotter_id, target_kind, target_id, kind, phase, success_pct, discovery_pct, next_tick_at)
      VALUES ('sch2', 'npc', 'plotter_npc', 'player', 'u1', 'blackmail', 'recruiting', 50, 10, 0)
    `).run();
    const r = interveneInScheme(db, "u1", "sch2", "blackmail");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_hook");
  });
});
