// tests/combat-impact-pvp-feel.test.js
//
// Pins the PvP combat-feel parity fix: the socket `combat:attack` path now emits
// `combat:impact` so player-vs-player gets the same hitstop/knockback/wince the
// NPC HTTP route already had (POLISH_AUDIT "PvP combat has no server-authoritative
// feel"). The socket path has no per-bone momentum, so it derives severity from
// the resolved damage/crit/kill/heavy — these pins lock that grading + that the
// shared buildImpactPayload produces a client-applicable feel.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  derivePvpSeverity,
  pvpMomentumFromDamage,
  buildImpactPayload,
  SEVERITY_FEEL,
} from "../lib/combat/impact-feel.js";

describe("PvP combat-feel derivation (socket combat:impact parity)", () => {
  it("grades severity from damage/crit/kill/heavy the way the NPC path grades momentum", () => {
    assert.equal(derivePvpSeverity({ damage: 0 }), "none", "a whiff has no feel");
    assert.equal(derivePvpSeverity({ damage: 5 }), "flinch", "a light hit flinches");
    assert.equal(derivePvpSeverity({ damage: 10, crit: true }), "rocked", "a crit rocks regardless of size");
    assert.equal(derivePvpSeverity({ damage: 20, heavy: true }), "rocked", "a solid heavy rocks");
    assert.equal(derivePvpSeverity({ damage: 12, heavy: true }), "flinch", "a weak heavy only flinches");
    assert.equal(derivePvpSeverity({ damage: 40 }), "rocked", "a big hit rocks even light/non-crit");
    assert.equal(derivePvpSeverity({ damage: 1, kill: true }), "knockdown", "a kill always reads as knockdown");
  });

  it("derives a clamped, damage-proportional momentum (no flat shove)", () => {
    assert.equal(pvpMomentumFromDamage(0), 0);
    assert.equal(pvpMomentumFromDamage(25), 125, "nominal sword-swing band");
    assert.equal(pvpMomentumFromDamage(1000), 300, "clamped to the hammer ceiling");
    assert.ok(pvpMomentumFromDamage(50) > pvpMomentumFromDamage(20), "heavier hit ⇒ more shove");
  });

  it("the shared payload turns a PvP hit into a client-applicable feel (targetKind=player)", () => {
    const p = buildImpactPayload({
      worldId: "w1", attackerId: "u1", targetId: "u2", targetKind: "player",
      severity: derivePvpSeverity({ damage: 40, heavy: true }),
      momentum: pvpMomentumFromDamage(40),
      damage: 40, element: "physical",
      targetPosition: { x: 1, y: 0, z: 2 }, attackerPosition: { x: 0, y: 0, z: 0 },
    });
    assert.equal(p.targetKind, "player");
    assert.equal(p.severity, "rocked");
    assert.ok(p.feel.knockback > 0, "a rocked PvP hit shoves the target");
    assert.ok(p.feel.targetPauseMs >= SEVERITY_FEEL.rocked.targetPauseMs, "hitstop present");
    assert.equal(p.isKill, false);
  });

  it("a PvP kill forces at-least-knockdown feel (finisher reads big)", () => {
    const p = buildImpactPayload({
      targetKind: "player", severity: derivePvpSeverity({ damage: 8, kill: true }),
      momentum: pvpMomentumFromDamage(8), isKill: true, damage: 8,
    });
    assert.equal(p.severity, "knockdown");
    assert.ok(p.feel.knockback >= SEVERITY_FEEL.rocked.knockback);
  });
});
