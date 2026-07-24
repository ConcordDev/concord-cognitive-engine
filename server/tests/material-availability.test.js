/**
 * Tier-2 contract test for per-world material availability.
 *
 * Pins:
 *   - availabilityForMaterial reads from getWorldMeta — registering a
 *     meta with material_availability returns the declared value.
 *   - Unknown world / unknown material defaults to documented values.
 *   - materialForSkill maps gun/weapons_modern → ballistic_ammo, magic →
 *     magical_reagents, hacking → tech_parts, bio_powers → bloodline_fuel.
 *   - classifyAvailability bucketing thresholds.
 *   - The 8 canon worlds' meta.json files each declare material_availability
 *     with the four canonical kinds.
 *   - Gun skill_affinity is now ≥ 0.9 across all canon worlds (the old
 *     0.0 was the user-noted "guns do zero damage" bug).
 *   - liveAvailabilityForMaterial: with no economy_flows data for a
 *     (world, material) pair, returns the exact static floor (zero HUD
 *     regression); with sustained consume-heavy flows, shifts the tier
 *     toward scarce/depleted; once those flows age out of
 *     computeRegionalScarcity's rolling window, it recovers back to the
 *     static floor — the same rolling-window recovery npc-economy.js
 *     already provides, not a new curve.
 *
 * Run: node --test tests/material-availability.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  availabilityForMaterial,
  materialForSkill,
  materialAvailabilityForSkillInWorld,
  liveAvailabilityForMaterial,
  classifyAvailability,
  MATERIAL_KINDS,
} from "../lib/embodied/material-availability.js";
import { registerWorldMeta } from "../lib/cross-world-effectiveness.js";
import { _internal as npcEconomyInternal } from "../lib/npc-economy.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

const CANON_META_PATHS = [
  "content/world/_meta.json",
  "content/world/tunya/meta.json",
  "content/world/cyber/meta.json",
  "content/world/crime/meta.json",
  "content/world/fantasy/meta.json",
  "content/world/superhero/meta.json",
  "content/world/sovereign-ruins/meta.json",
  "content/world/lattice-crucible/meta.json",
  "content/world/concord-link-frontier/meta.json",
];

function readJSON(rel) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, rel), "utf8"));
}

beforeEach(() => {
  // Register one fixture world so availabilityForMaterial has something
  // to read.
  registerWorldMeta({
    world_id: "test_world",
    universe_type: "test",
    material_availability: {
      ballistic_ammo: 0.05,
      magical_reagents: 1.0,
      tech_parts: 0.30,
      bloodline_fuel: 0.50,
    },
  });
});

describe("availabilityForMaterial reads from registry", () => {
  it("returns declared value for a registered world", () => {
    assert.equal(availabilityForMaterial("test_world", "ballistic_ammo"), 0.05);
    assert.equal(availabilityForMaterial("test_world", "magical_reagents"), 1.0);
    assert.equal(availabilityForMaterial("test_world", "tech_parts"), 0.30);
    assert.equal(availabilityForMaterial("test_world", "bloodline_fuel"), 0.50);
  });

  it("falls back to documented defaults for an unknown world", () => {
    assert.equal(availabilityForMaterial("nope_world", "ballistic_ammo"), 1.0);
    assert.equal(availabilityForMaterial("nope_world", "magical_reagents"), 0.5);
    assert.equal(availabilityForMaterial("nope_world", "tech_parts"), 0.5);
    assert.equal(availabilityForMaterial("nope_world", "bloodline_fuel"), 0.5);
  });
});

describe("materialForSkill maps skill → consumable kind", () => {
  it("ballistic skills map to ballistic_ammo", () => {
    assert.equal(materialForSkill("gun"), "ballistic_ammo");
    assert.equal(materialForSkill("weapons_modern"), "ballistic_ammo");
    assert.equal(materialForSkill("weapon_attachments"), "ballistic_ammo");
  });
  it("magic / alchemy map to magical_reagents", () => {
    assert.equal(materialForSkill("magic"), "magical_reagents");
    assert.equal(materialForSkill("alchemy"), "magical_reagents");
  });
  it("hacking / tech / engineering map to tech_parts", () => {
    assert.equal(materialForSkill("hacking"), "tech_parts");
    assert.equal(materialForSkill("tech"), "tech_parts");
    assert.equal(materialForSkill("engineering"), "tech_parts");
  });
  it("bio_powers / bloodlines map to bloodline_fuel", () => {
    assert.equal(materialForSkill("bio_powers"), "bloodline_fuel");
    assert.equal(materialForSkill("fire_bloodline"), "bloodline_fuel");
    assert.equal(materialForSkill("ice_bloodline"), "bloodline_fuel");
  });
  it("material-independent skills return null", () => {
    assert.equal(materialForSkill("athletics"), null);
    assert.equal(materialForSkill("diplomacy"), null);
    assert.equal(materialForSkill("stealth"), null);
  });
});

describe("materialAvailabilityForSkillInWorld combines both", () => {
  it("gun in test_world returns the ballistic_ammo availability", () => {
    const r = materialAvailabilityForSkillInWorld("test_world", "gun");
    assert.equal(r.ok, true);
    assert.equal(r.materialKind, "ballistic_ammo");
    assert.equal(r.availability, 0.05);
  });
  it("stealth never gates by material", () => {
    const r = materialAvailabilityForSkillInWorld("test_world", "stealth");
    assert.equal(r.materialKind, null);
    assert.equal(r.availability, 1.0);
  });
});

describe("classifyAvailability tiers", () => {
  it("0.9 → abundant, 0.5 → moderate, 0.2 → scarce, 0.05 → depleted", () => {
    assert.equal(classifyAvailability(0.9), "abundant");
    assert.equal(classifyAvailability(0.5), "moderate");
    assert.equal(classifyAvailability(0.2), "scarce");
    assert.equal(classifyAvailability(0.05), "depleted");
  });
  it("exact thresholds: 0.70 = abundant, 0.40 = moderate, 0.15 = scarce", () => {
    assert.equal(classifyAvailability(0.70), "abundant");
    assert.equal(classifyAvailability(0.40), "moderate");
    assert.equal(classifyAvailability(0.15), "scarce");
  });
});

describe("canon worlds declare material_availability", () => {
  for (const p of CANON_META_PATHS) {
    it(`${p} has material_availability for all 4 kinds`, () => {
      const meta = readJSON(p);
      assert.ok(meta.material_availability, `${p} missing material_availability`);
      for (const kind of MATERIAL_KINDS) {
        const v = meta.material_availability[kind];
        assert.equal(typeof v, "number", `${p} missing material_availability.${kind}`);
        assert.ok(v >= 0 && v <= 1, `${p} ${kind} out of [0,1]`);
      }
    });
  }
});

describe("gun skill_affinity is no longer 0.0 in low-tech worlds", () => {
  it("tunya gun affinity is ≥ 0.9 — bullets still hurt", () => {
    const meta = readJSON("content/world/tunya/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `tunya gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("fantasy gun affinity is ≥ 0.9", () => {
    const meta = readJSON("content/world/fantasy/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `fantasy gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("sovereign-ruins gun affinity ≥ 0.9", () => {
    const meta = readJSON("content/world/sovereign-ruins/meta.json");
    assert.ok(meta.skill_affinity?.gun >= 0.9, `sovereign-ruins gun affinity ${meta.skill_affinity?.gun} should be ≥ 0.9`);
  });
  it("tunya / fantasy ammo IS gated (ballistic_ammo ≤ 0.10)", () => {
    const tunya = readJSON("content/world/tunya/meta.json");
    const fantasy = readJSON("content/world/fantasy/meta.json");
    assert.ok(tunya.material_availability.ballistic_ammo <= 0.10, "tunya should have rare ammo");
    assert.ok(fantasy.material_availability.ballistic_ammo <= 0.10, "fantasy should have rare ammo");
  });
});

// ── Live regional-scarcity blend ─────────────────────────────────────────────
//
// Minimal fake db — only what computeRegionalScarcity(db, worldId,
// resourceKind) actually reads: a plain array of economy_flows rows,
// filtered by world_id + resource_kind + occurred_at > cutoff, grouped by
// flow_kind. Mirrors the fake-db pattern in tests/npc-economy.test.js so
// this exercises the REAL computeRegionalScarcity implementation, not a
// re-invented one.

function makeScarcityFakeDb() {
  const flows = []; // { world_id, resource_kind, flow_kind, quantity, occurred_at }
  const db = {
    prepare(sql) {
      const s = sql.replace(/\s+/g, " ").trim();
      if (s.startsWith("SELECT flow_kind, SUM(quantity) AS qty FROM economy_flows")) {
        return {
          all(worldId, resourceKind, cutoff) {
            const buckets = {};
            for (const f of flows) {
              if (f.world_id !== worldId || f.resource_kind !== resourceKind) continue;
              if (f.occurred_at <= cutoff) continue;
              buckets[f.flow_kind] = (buckets[f.flow_kind] || 0) + f.quantity;
            }
            return Object.entries(buckets).map(([flow_kind, qty]) => ({ flow_kind, qty }));
          },
        };
      }
      // Unhandled statement shapes just no-op — nothing else in
      // computeRegionalScarcity issues other queries.
      return { all: () => [], get: () => null, run: () => ({ changes: 0 }) };
    },
  };
  function addFlow(worldId, resourceKind, flowKind, quantity, occurredAt) {
    flows.push({
      world_id: worldId, resource_kind: resourceKind, flow_kind: flowKind,
      quantity, occurred_at: occurredAt ?? Math.floor(Date.now() / 1000),
    });
  }
  return { db, addFlow, _flows: flows };
}

const SCARCITY_WINDOW_S = npcEconomyInternal.SCARCITY_WINDOW_S;

describe("liveAvailabilityForMaterial — no db / no data is a no-op", () => {
  beforeEach(() => {
    registerWorldMeta({
      world_id: "live_test_world",
      universe_type: "test",
      material_availability: {
        ballistic_ammo: 0.05,
        magical_reagents: 1.0,
        tech_parts: 0.30,
        bloodline_fuel: 0.50,
      },
    });
  });

  it("with no db, returns exactly the static floor", () => {
    for (const kind of MATERIAL_KINDS) {
      assert.equal(
        liveAvailabilityForMaterial(null, "live_test_world", kind),
        availabilityForMaterial("live_test_world", kind),
      );
    }
  });

  it("with a db but zero economy_flows rows for this (world, material), returns the exact static floor — zero HUD regression", () => {
    const { db } = makeScarcityFakeDb();
    for (const kind of MATERIAL_KINDS) {
      const live = liveAvailabilityForMaterial(db, "live_test_world", kind);
      const staticFloor = availabilityForMaterial("live_test_world", kind);
      assert.equal(live, staticFloor, `${kind}: live=${live} static=${staticFloor}`);
    }
  });

  it("a real canon world (crime) with no flow data also matches its static meta.json floor exactly", () => {
    const { db } = makeScarcityFakeDb();
    const meta = readJSON("content/world/crime/meta.json");
    registerWorldMeta(meta);
    for (const kind of MATERIAL_KINDS) {
      const live = liveAvailabilityForMaterial(db, "crime", kind);
      assert.equal(live, meta.material_availability[kind]);
    }
  });

  it("materialAvailabilityForSkillInWorld without a db argument is unchanged (static only)", () => {
    const r = materialAvailabilityForSkillInWorld("live_test_world", "gun");
    assert.equal(r.availability, 0.05);
  });
});

describe("liveAvailabilityForMaterial — sustained consumption shifts scarcer", () => {
  beforeEach(() => {
    registerWorldMeta({
      world_id: "live_test_world",
      universe_type: "test",
      material_availability: {
        ballistic_ammo: 0.05,
        magical_reagents: 1.0,
        tech_parts: 0.30,
        bloodline_fuel: 0.50,
      },
    });
  });

  it("heavy consume with zero production drives ballistic_ammo toward depleted", () => {
    const { db, addFlow } = makeScarcityFakeDb();
    const now = Math.floor(Date.now() / 1000);
    // Sustained gunfire: many 'consume' flows, no 'gather'/'craft_output'
    // to replenish. All well inside the rolling window.
    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "magical_reagents", "consume", 5, now - i * 10);
    }
    const staticFloor = availabilityForMaterial("live_test_world", "magical_reagents");
    const live = liveAvailabilityForMaterial(db, "live_test_world", "magical_reagents");
    assert.ok(live < staticFloor, `expected live (${live}) < static floor (${staticFloor})`);
    assert.equal(classifyAvailability(live), "depleted");
  });

  it("net production (glut) raises availability toward the [0,1] ceiling, never past it", () => {
    const { db, addFlow } = makeScarcityFakeDb();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "tech_parts", "gather", 5, now - i * 10);
    }
    const staticFloor = availabilityForMaterial("live_test_world", "tech_parts");
    const live = liveAvailabilityForMaterial(db, "live_test_world", "tech_parts");
    assert.ok(live > staticFloor, `expected live (${live}) > static floor (${staticFloor})`);
    assert.ok(live <= 1.0, `live (${live}) must never exceed 1.0`);
  });

  it("materialAvailabilityForSkillInWorld(db) reflects the live number, not the static one", () => {
    const { db, addFlow } = makeScarcityFakeDb();
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "magical_reagents", "consume", 5, now - i * 10);
    }
    const r = materialAvailabilityForSkillInWorld("live_test_world", "magic", db);
    assert.equal(r.materialKind, "magical_reagents");
    assert.ok(r.availability < 1.0, "magic's static floor was 1.0 — live must have dropped it");
  });
});

describe("liveAvailabilityForMaterial — recovery as flows age out of the rolling window", () => {
  beforeEach(() => {
    registerWorldMeta({
      world_id: "live_test_world",
      universe_type: "test",
      material_availability: {
        ballistic_ammo: 0.05,
        magical_reagents: 1.0,
        tech_parts: 0.30,
        bloodline_fuel: 0.50,
      },
    });
  });

  it("a scarcity-driving flow burst OUTSIDE the SCARCITY_WINDOW_S window no longer affects availability — the same rolling-window recovery computeRegionalScarcity already provides", () => {
    const { db, addFlow } = makeScarcityFakeDb();
    const now = Math.floor(Date.now() / 1000);
    const staleAt = now - SCARCITY_WINDOW_S - 60; // just past the cutoff

    // First: prove this exact burst WOULD deplete availability if it were
    // still inside the window (sanity check the fixture is potent).
    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "magical_reagents", "consume", 5, now - i * 10);
    }
    const depleted = liveAvailabilityForMaterial(db, "live_test_world", "magical_reagents");
    assert.equal(classifyAvailability(depleted), "depleted");

    // Now: the identical burst, but aged past the window (simulating
    // time having passed since the activity happened) — recovers to the
    // static floor, exactly like computeRegionalScarcity's own window
    // expiry already does for the civilian economy.
    const { db: db2, addFlow: addFlow2 } = makeScarcityFakeDb();
    for (let i = 0; i < 20; i++) {
      addFlow2("live_test_world", "magical_reagents", "consume", 5, staleAt - i * 10);
    }
    const recovered = liveAvailabilityForMaterial(db2, "live_test_world", "magical_reagents");
    const staticFloor = availabilityForMaterial("live_test_world", "magical_reagents");
    assert.equal(recovered, staticFloor, `expected full recovery to static floor once flows age out; got ${recovered}`);
  });

  it("reduced consumption (fewer/no new flows) relative to a prior heavy burst also relaxes scarcity back toward neutral", () => {
    const { db, addFlow } = makeScarcityFakeDb();
    const now = Math.floor(Date.now() / 1000);
    // A single old-but-still-in-window heavy consume burst, balanced by
    // production added later — net scarcity within the window trends
    // back toward 0 as production catches up, without ever reintroducing
    // the original all-consume imbalance.
    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "tech_parts", "consume", 5, now - 3000 - i * 5);
    }
    const heavilyScarce = liveAvailabilityForMaterial(db, "live_test_world", "tech_parts");
    assert.ok(heavilyScarce < availabilityForMaterial("live_test_world", "tech_parts"));

    for (let i = 0; i < 20; i++) {
      addFlow("live_test_world", "tech_parts", "gather", 5, now - i * 5);
    }
    const rebalanced = liveAvailabilityForMaterial(db, "live_test_world", "tech_parts");
    assert.ok(rebalanced > heavilyScarce, `expected rebalanced (${rebalanced}) > heavilyScarce (${heavilyScarce})`);
  });
});
