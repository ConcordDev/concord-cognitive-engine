/**
 * T1.4b — server-authoritative combat FEEL.
 *
 * Pins the mapping from poise severity (+ impact momentum) to the exact
 * hitstop / knockback / wince parameters the client applies verbatim. The
 * point of T1.4b is that the *feel* is decided by the server's physics, not a
 * client heuristic — so these assertions guard:
 *   - severity grades the feel monotonically (knockdown > rocked > flinch > none)
 *   - a kill always reads at-least-knockdown
 *   - momentum nudges knockback within a sane band (heavier weapon shoves more)
 *   - flinch never shoves; none produces no feel at all
 *   - the wire payload carries everything the client needs (feel + positions)
 *
 * Run: node --test tests/integration/combat-impact-feel.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SEVERITY_FEEL, impactFeel, buildImpactPayload, maxSeverity,
} from "../../lib/combat/impact-feel.js";

describe("T1.4b — impact feel mapping", () => {
  it("severity grades hitstop monotonically", () => {
    assert.ok(SEVERITY_FEEL.knockdown.targetPauseMs > SEVERITY_FEEL.rocked.targetPauseMs);
    assert.ok(SEVERITY_FEEL.rocked.targetPauseMs > SEVERITY_FEEL.flinch.targetPauseMs);
    assert.ok(SEVERITY_FEEL.flinch.targetPauseMs > SEVERITY_FEEL.none.targetPauseMs);
    assert.equal(SEVERITY_FEEL.none.targetPauseMs, 0);
  });

  it("flinch never shoves; rocked and knockdown do", () => {
    assert.equal(impactFeel("flinch", 200).knockback, 0);
    assert.equal(impactFeel("none", 999).knockback, 0);
    assert.ok(impactFeel("rocked", 120).knockback > 0);
    assert.ok(impactFeel("knockdown", 120).knockback > impactFeel("rocked", 120).knockback);
  });

  it("momentum nudges knockback within a bounded band (heavier shoves more)", () => {
    const light = impactFeel("rocked", 60);
    const heavy = impactFeel("rocked", 260);
    assert.ok(heavy.knockback > light.knockback, "heavier weapon shoves harder for same severity");
    // Bounded: never less than 0.8× or more than 1.3× the base.
    const base = SEVERITY_FEEL.rocked.knockback;
    assert.ok(light.knockback >= base * 0.8 - 0.05);
    assert.ok(heavy.knockback <= base * 1.3 + 0.05);
  });

  it("wince severity tracks the poise severity", () => {
    assert.equal(impactFeel("flinch").wince, "light");
    assert.equal(impactFeel("rocked").wince, "heavy");
    assert.equal(impactFeel("knockdown").wince, "crit");
  });

  it("maxSeverity returns the stronger of two", () => {
    assert.equal(maxSeverity("flinch", "knockdown"), "knockdown");
    assert.equal(maxSeverity("rocked", "flinch"), "rocked");
    assert.equal(maxSeverity("none", "none"), "none");
  });

  it("a kill always reads at-least-knockdown", () => {
    const p = buildImpactPayload({
      attackerId: "u1", targetId: "npc1", severity: "flinch", isKill: true, momentum: 100,
    });
    assert.equal(p.severity, "knockdown");
    assert.ok(p.feel.knockback > 0);
    assert.equal(p.isKill, true);
  });

  it("payload carries the full wire contract for the client", () => {
    const p = buildImpactPayload({
      worldId: "w1", attackerId: "u1", targetId: "npc1", targetKind: "npc",
      severity: "rocked", momentum: 130, element: "fire", damage: 42.7,
      targetPosition: { x: 1, y: 0, z: 2 }, attackerPosition: { x: 0, y: 0, z: 0 },
    });
    assert.equal(p.worldId, "w1");
    assert.equal(p.attackerId, "u1");
    assert.equal(p.targetId, "npc1");
    assert.equal(p.severity, "rocked");
    assert.equal(p.element, "fire");
    assert.equal(p.damage, 42.7);
    assert.equal(p.impactMomentum, 130);
    assert.ok(p.feel && typeof p.feel.targetPauseMs === "number");
    assert.deepEqual(p.targetPosition, { x: 1, y: 0, z: 2 });
    assert.deepEqual(p.attackerPosition, { x: 0, y: 0, z: 0 });
    assert.ok(typeof p.ts === "number");
  });

  it("a non-staggering, non-kill hit still produces a coherent (zero-feel) payload", () => {
    const p = buildImpactPayload({ attackerId: "u1", targetId: "npc1", severity: "none" });
    assert.equal(p.severity, "none");
    assert.equal(p.feel.targetPauseMs, 0);
    assert.equal(p.feel.knockback, 0);
  });
});
