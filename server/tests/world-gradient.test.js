/**
 * WS0 — world-gradient contract tests.
 * Pins the radial danger-band geometry: monotonic bands, level windows that
 * tile 1..frontier, the homeBandFor inverse, density falloff, hub anchoring
 * from world_zones, and graceful degrade with no DB.
 * Run: node --test tests/world-gradient.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";

import {
  GRADIENT_DEFAULTS,
  gradientConfigFor,
  hubAnchorFor,
  distanceFromHub,
  outwardUnit,
  dangerFraction,
  dangerBandAt,
  bandLevelRange,
  homeBandFor,
  spawnDensityFor,
  worldBoundsFor,
  gradientAt,
} from "../lib/world-gradient.js";

function dbWithZone({ cx = 0, cz = 0, r = 400 } = {}) {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE world_zones (
    id TEXT PRIMARY KEY, world_id TEXT, name TEXT, kind TEXT,
    center_x REAL, center_z REAL, radius_m REAL, rules_json TEXT, created_by TEXT
  );`);
  db.prepare(`INSERT INTO world_zones (id, world_id, name, kind, center_x, center_z, radius_m)
              VALUES ('z1','w1','Domain','sanctuary',?,?,?)`).run(cx, cz, r);
  return db;
}

describe("world-gradient geometry", () => {
  const cfg = gradientConfigFor(null);

  it("uses sane large defaults", () => {
    assert.ok(GRADIENT_DEFAULTS.worldRadiusM >= 200);
    assert.ok(GRADIENT_DEFAULTS.bandCount >= 2);
    assert.equal(cfg.worldRadiusM, GRADIENT_DEFAULTS.worldRadiusM);
  });

  it("per-world rule_modulators.gradient overrides defaults", () => {
    const c = gradientConfigFor({ rule_modulators: JSON.stringify({ gradient: { worldRadiusM: 1234, bandCount: 4 } }) });
    assert.equal(c.worldRadiusM, 1234);
    assert.equal(c.bandCount, 4);
  });

  it("danger fraction is 0 inside hub, 1 at/after frontier, monotonic", () => {
    assert.equal(dangerFraction(cfg, 0), 0);
    assert.equal(dangerFraction(cfg, cfg.hubRadiusM), 0);
    assert.equal(dangerFraction(cfg, cfg.worldRadiusM), 1);
    assert.equal(dangerFraction(cfg, cfg.worldRadiusM * 2), 1);
    const a = dangerFraction(cfg, cfg.hubRadiusM + 100);
    const b = dangerFraction(cfg, cfg.hubRadiusM + 500);
    assert.ok(b > a);
  });

  it("band index increases monotonically with distance and is clamped", () => {
    const anchor = { x: 0, z: 0, radiusM: cfg.hubRadiusM };
    let prev = -1;
    for (let d = 0; d <= cfg.worldRadiusM; d += cfg.worldRadiusM / 50) {
      const b = dangerBandAt(cfg, anchor, d, 0);
      assert.ok(b >= 0 && b < cfg.bandCount);
      assert.ok(b >= prev, `band should not decrease: ${b} < ${prev}`);
      prev = b;
    }
    // far past the rim still clamps to last band
    assert.equal(dangerBandAt(cfg, anchor, cfg.worldRadiusM * 5, 0), cfg.bandCount - 1);
  });

  it("band level windows tile from 1 up to frontierLevel without gaps", () => {
    let prevHi = 0;
    for (let b = 0; b < cfg.bandCount; b++) {
      const [lo, hi] = bandLevelRange(cfg, b);
      assert.ok(lo >= 1 && hi >= lo);
      if (b === 0) assert.equal(lo, 1);
      else assert.equal(lo, prevHi + 1, `band ${b} should start right after band ${b - 1}`);
      prevHi = hi;
    }
    assert.equal(prevHi, cfg.frontierLevel);
  });

  it("homeBandFor is the inverse of bandLevelRange and clamps veterans to the rim", () => {
    for (let b = 0; b < cfg.bandCount; b++) {
      const [lo, hi] = bandLevelRange(cfg, b);
      assert.equal(homeBandFor(cfg, lo), b);
      assert.equal(homeBandFor(cfg, hi), b);
    }
    // a grind-veteran far above the frontier window lives at the outermost band
    assert.equal(homeBandFor(cfg, cfg.frontierLevel * 100), cfg.bandCount - 1);
    assert.equal(homeBandFor(cfg, 1), 0);
  });

  it("spawn density falls from 1.0 at the hub to the frontier floor", () => {
    assert.equal(spawnDensityFor(cfg, 0), 1);
    const last = spawnDensityFor(cfg, cfg.bandCount - 1);
    assert.ok(Math.abs(last - cfg.frontierDensity) < 1e-9);
    assert.ok(spawnDensityFor(cfg, 1) < spawnDensityFor(cfg, 0));
  });

  it("outwardUnit points away from hub and is stable at the exact center", () => {
    const u = outwardUnit({ x: 0, z: 0 }, 100, 0);
    assert.ok(Math.abs(u.x - 1) < 1e-9 && Math.abs(u.z) < 1e-9);
    const c = outwardUnit({ x: 0, z: 0 }, 0, 0);
    assert.ok(Math.hypot(c.x, c.z) > 0); // non-degenerate fallback
  });

  it("world bounds enclose the radial map", () => {
    const b = worldBoundsFor(cfg, { x: 0, z: 0 });
    assert.equal(b.x1 - b.x0, cfg.worldRadiusM * 2);
  });
});

describe("world-gradient hub anchoring", () => {
  it("reads the largest sanctuary zone as the hub anchor", () => {
    const db = dbWithZone({ cx: 25, cz: -10, r: 400 });
    const cfg = gradientConfigFor(null);
    const anchor = hubAnchorFor(db, "w1", cfg);
    assert.equal(anchor.x, 25);
    assert.equal(anchor.z, -10);
    // hub disc is min(authored sanctuary, configured hub radius)
    assert.equal(anchor.radiusM, Math.min(400, cfg.hubRadiusM));
  });

  it("degrades to origin anchor with no DB / no table", () => {
    const anchor = hubAnchorFor(null, "w1");
    assert.equal(anchor.x, 0);
    assert.equal(anchor.z, 0);
    const db = new Database(":memory:");
    const a2 = hubAnchorFor(db, "w1");
    assert.equal(a2.x, 0);
  });

  it("gradientAt composes everything for a point", () => {
    const db = dbWithZone({ r: 200 });
    const g = gradientAt(db, "w1", 0, 0);
    assert.equal(g.band, 0);
    assert.ok(g.inHub);
    assert.equal(g.minLevel, 1);
    const far = gradientAt(db, { id: "w1", rule_modulators: { gradient: { worldRadiusM: 1000 } } }, 999, 0);
    assert.equal(far.band, far.config.bandCount - 1);
    assert.ok(!far.inHub);
    assert.ok(far.distance > 0);
  });
});
