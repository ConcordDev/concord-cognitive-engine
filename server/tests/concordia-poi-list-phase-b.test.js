// CP-W27 — Wilderness POIs (b): the per-land POI list meets the
// CONCORDIA_PLAN §4.11 targets for the Phase B (M7) footprint — the
// (b) half of the wilderness POI pair, on the emitter CP-W26 landed.
// Expected counts are literals from the plan (§4.11 densities × §4.2
// Phase B footprints), and traceability pins the list to CP-10's
// compiler manifests at Phase B id-for-id.
//
//   cd server && node --test tests/concordia-poi-list-phase-b.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  emitPoiList,
  POI_KINDS,
  POI_FLAG,
} from "../../scripts/concordia/emit-poi-list.mjs";
import {
  compileActivities,
  defaultLands,
} from "../../scripts/concordia/compile-activities.mjs";

const byName = (list, name) => list.lands.find((l) => l.land === name);

test("Phase B per-land POI counts meet §4.11 (1.5 major + 6 minor per km², halves-up)", () => {
  const list = emitPoiList({ lands: defaultLands(), phase: "B" });
  assert.equal(list.flag, POI_FLAG);
  assert.equal(list.phase, "B");
  // §4.2 Phase B footprints: eight lands at 4.0² = 16 km² (24/96/120),
  // Tunya 4.5² = 20.25 km², The Crucible 3.0² = 9 km².
  for (const name of [
    "Unburned Court",
    "The Sundering",
    "Sovereign Ruins",
    "The Grid",
    "Crime World",
    "The Frontier",
    "The Permanent Dawn",
    "Sere",
  ]) {
    assert.deepEqual(byName(list, name).counts, { majorPoi: 24, minorPoi: 96, total: 120 }, name);
  }
  assert.deepEqual(byName(list, "Tunya").counts, { majorPoi: 30, minorPoi: 122, total: 152 }); // 30.375→30, 121.5→122 halves-up
  assert.deepEqual(byName(list, "The Crucible").counts, { majorPoi: 14, minorPoi: 54, total: 68 }); // 13.5→14 halves-up
  assert.deepEqual(list.totals, { majorPoi: 236, minorPoi: 944, pois: 1180 });
  for (const land of list.lands) {
    assert.equal(land.pois.length, land.counts.total, `${land.land}: list length == counts`);
  }
});

test("the Phase B list traces to the compiler manifests id-for-id, in bounds", () => {
  const lands = defaultLands();
  const list = emitPoiList({ lands, phase: "B" });
  const compiled = compileActivities({ lands, phase: "B" });
  const seen = new Set();
  for (const landList of list.lands) {
    const manifest = compiled.lands.find((m) => m.land === landList.land);
    const expectedIds = manifest.placements
      .filter((p) => POI_KINDS.includes(p.category))
      .map((p) => p.id);
    assert.deepEqual(landList.pois.map((p) => p.id), expectedIds, `${landList.land}: ids trace to the manifest`);
    const sideMeters = Math.sqrt(landList.footprintKm2) * 1000;
    for (const poi of landList.pois) {
      assert.ok(!seen.has(poi.id), `duplicate POI id ${poi.id}`);
      seen.add(poi.id);
      assert.ok(poi.x >= 0 && poi.x <= sideMeters && poi.z >= 0 && poi.z <= sideMeters, `${poi.id}: in bounds`);
    }
  }
  assert.equal(seen.size, 1180);
});

test("deterministic at Phase B, and distinct from the Phase A list", () => {
  const a = emitPoiList({ lands: defaultLands(), phase: "B" });
  const b = emitPoiList({ lands: defaultLands(), phase: "B" });
  assert.deepEqual(a, b);
  assert.equal(a.checksum, "f0118cfb");
  const phaseA = emitPoiList({ lands: defaultLands(), phase: "A" });
  assert.notEqual(a.checksum, phaseA.checksum, "the two footprints produce different lists");
  assert.ok(a.totals.pois > phaseA.totals.pois, "Phase B is the larger footprint");
});
