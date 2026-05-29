/**
 * D2 (depth plan) — defensive-window enforcement contract.
 *
 * Pins the combat-state.js contract the /combat/npc-attack path now relies
 * on, and asserts the wiring is present:
 *   - a fresh actor takes full damage (damageMul 1, not iframed)
 *   - active dodge i-frames whiff the hit (damageMul 0, iframed) WITHOUT
 *     depleting poise (early-return before poise damage)
 *   - a held block halves damage (damageMul 0.5, blocked)
 *   - the npc-attack route consults applyHitToState + returns evaded on iframe
 *   - the combat:block socket handler engages the server block window
 *
 * Before D2, dodge/parry/block were cosmetic on the NPC→player path — the
 * route applied damage with no defensive check, so a perfectly-timed dodge
 * cost the player full HP.
 *
 * Run: node --test tests/combat-defensive-enforcement.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyHitToState,
  grantIFrames,
  setBlock,
  getCombatState,
  resetCombatState,
} from "../lib/combat-state.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("D2 — combat-state defensive enforcement", () => {
  it("a fresh actor takes full damage", () => {
    const id = "test-actor-fresh";
    resetCombatState(id);
    const mod = applyHitToState(id, { damage: 40 });
    assert.equal(mod.iframed, false);
    assert.equal(mod.blocked, false);
    assert.equal(mod.damageMul, 1.0);
  });

  it("active dodge i-frames whiff the hit and cost no poise", () => {
    const id = "test-actor-dodge";
    resetCombatState(id);
    const poiseBefore = getCombatState(id).poise;
    grantIFrames(id, 350);
    const mod = applyHitToState(id, { damage: 80, isCrit: true });
    assert.equal(mod.iframed, true);
    assert.equal(mod.damageMul, 0);
    // Early-return on i-frames means poise is untouched by the whiffed hit.
    assert.equal(getCombatState(id).poise, poiseBefore);
  });

  it("a held block halves incoming damage", () => {
    const id = "test-actor-block";
    resetCombatState(id);
    setBlock(id, 800);
    const mod = applyHitToState(id, { damage: 40 });
    assert.equal(mod.iframed, false);
    assert.equal(mod.blocked, true);
    assert.equal(mod.damageMul, 0.5);
  });
});

describe("D2 — wiring", () => {
  it("the npc-attack route consults applyHitToState and evades on i-frames", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "routes/worlds.js"), "utf8",
    );
    // Scope to the npc-attack handler so we don't match an unrelated import.
    const idx = src.indexOf("/combat/npc-attack");
    assert.ok(idx > 0, "npc-attack route present");
    const seg = src.slice(idx, idx + 5500);
    assert.match(seg, /applyHitToState/);
    assert.match(seg, /defMod\.iframed/);
    assert.match(seg, /defMod\.damageMul/);
    assert.match(seg, /combat:npc-attack-evaded/);
  });

  it("the combat:block socket handler engages the server block window", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "..", "server.js"), "utf8",
    );
    const idx = src.indexOf('socket.on("combat:block"');
    assert.ok(idx > 0, "combat:block handler present");
    const seg = src.slice(idx, idx + 1200);
    assert.match(seg, /_setBlock\(userId/);
  });
});
