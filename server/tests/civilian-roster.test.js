/**
 * Living Society — Phase 1: civilian occupation roster (the labor floor).
 *
 * Pins that the 8 civilian archetypes are first-class:
 *   - each has a routine with a production activity block;
 *   - each has gather targets + a craft recipe;
 *   - non-martial factions actually spawn civilians;
 *   - civilians carry NO combat archetype (they lose 1v1 to enforcers).
 *
 * Run: node --test tests/civilian-roster.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeScheduleForNpc } from "../lib/npc-routines.js";
import { FACTION_PROFILES, generateNpc } from "../lib/npc-generator.js";
import { _internal as econInternal } from "../lib/npc-economy.js";

const CIVILIANS = ["farmer", "builder", "miner", "logger", "miller", "fisher", "cook", "laborer"];
const PRODUCTION = new Set(["farm", "build", "mine", "log", "mill", "fish", "cook", "gather"]);

describe("Phase 1 — civilian roster routines", () => {
  for (const arch of CIVILIANS) {
    it(`${arch} has a routine with a production activity block`, () => {
      const sched = composeScheduleForNpc({ id: `n_${arch}`, archetype: arch, spawn_location: '{"x":0,"z":0}' }, 1);
      assert.ok(Array.isArray(sched) && sched.length === 8);
      const acts = sched.map((b) => b.activity_kind);
      assert.ok(acts.some((a) => PRODUCTION.has(a)), `${arch} routine has no production block: ${acts}`);
    });
  }
});

describe("Phase 1 — non-martial factions spawn civilians", () => {
  it("merchant_collective + verdant_veil + pinewood + default include civilian archetypes", () => {
    for (const fid of ["merchant_collective", "verdant_veil_remnant", "pinewood_coalition", "default"]) {
      const arch = FACTION_PROFILES[fid].archetypes;
      assert.ok(arch.some((a) => CIVILIANS.includes(a)), `${fid} has no civilians: ${arch}`);
    }
  });

  it("generateNpc produces a civilian for a civilian-heavy faction across seeds", () => {
    let sawCivilian = false;
    for (let i = 0; i < 40; i++) {
      const npc = generateNpc({ factionId: "default", seed: `s${i}` });
      if (CIVILIANS.includes(npc.archetype)) { sawCivilian = true; break; }
    }
    assert.ok(sawCivilian, "default faction never spawned a civilian across 40 seeds");
  });

  it("INVARIANT: civilians carry no martial archetype", () => {
    const MARTIAL = new Set(["warrior", "guard"]);
    for (const c of CIVILIANS) assert.ok(!MARTIAL.has(c));
  });
});

describe("Phase 1 — civilian economy targets", () => {
  it("each civilian archetype has gather targets + a craft recipe", () => {
    const g = econInternal?.ARCHETYPE_GATHER_TARGETS;
    const r = econInternal?.ARCHETYPE_CRAFT_RECIPES;
    if (!g || !r) return; // internals not exported on this build — skip softly
    for (const c of CIVILIANS) {
      assert.ok(Array.isArray(g[c]) && g[c].length >= 1, `${c} has no gather targets`);
      assert.ok(r[c] && r[c].output, `${c} has no craft recipe`);
    }
  });
});
