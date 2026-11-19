// CP-W26 — Wilderness POIs (a): the per-land POI list meets the
// CONCORDIA_PLAN §4.11 targets for the Phase A footprint. The list is a
// view of CP-10's compiler manifests: every expected count below is a
// literal from the plan (§4.11 densities × §4.2 footprints), and the
// traceability test pins the list to the manifests id-for-id, so the
// two can never drift apart silently.
//
//   cd server && node --test tests/concordia-poi-list.test.js

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

test("the POI kinds and flag are the spec's", () => {
  assert.deepEqual([...POI_KINDS], ["majorPoi", "minorPoi"]);
  assert.equal(POI_FLAG, "cf.world.pois");
});

test("Phase A per-land POI counts meet §4.11 (1.5 major + 6 minor per km², halves-up)", () => {
  const list = emitPoiList({ lands: defaultLands(), phase: "A" });
  // §4.2 Phase A footprints: Unburned Court 4.0² = 16 km²; The Crucible
  // 1.5² = 2.25 km²; every other land 2.0² = 4 km² except Tunya 2.5² = 6.25.
  assert.deepEqual(byName(list, "Unburned Court").counts, { majorPoi: 24, minorPoi: 96, total: 120 });
  assert.deepEqual(byName(list, "The Sundering").counts, { majorPoi: 6, minorPoi: 24, total: 30 });
  assert.deepEqual(byName(list, "Sovereign Ruins").counts, { majorPoi: 6, minorPoi: 24, total: 30 });
  assert.deepEqual(byName(list, "Tunya").counts, { majorPoi: 9, minorPoi: 38, total: 47 }); // 9.375→9, 37.5→38 halves-up
  assert.deepEqual(byName(list, "The Crucible").counts, { majorPoi: 3, minorPoi: 14, total: 17 }); // 3.375→3, 13.5→14
  for (const land of list.lands) {
    assert.equal(land.pois.length, land.counts.total, `${land.land}: list length == counts`);
    assert.equal(
      land.counts.total,
      Math.round(1.5 * land.footprintKm2) + Math.round(6 * land.footprintKm2),
      `${land.land}: counts derive from the §4.11 densities`,
    );
  }
  assert.equal(list.totals.pois, list.lands.reduce((s, l) => s + l.counts.total, 0));
  assert.equal(list.totals.majorPoi + list.totals.minorPoi, list.totals.pois);
});

test("the list traces to the compiler manifests id-for-id, in bounds", () => {
  const lands = defaultLands();
  const list = emitPoiList({ lands, phase: "A" });
  const compiled = compileActivities({ lands, phase: "A" });
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
      assert.ok(POI_KINDS.includes(poi.kind), `${poi.id}: kind is a POI kind`);
      assert.ok(poi.x >= 0 && poi.x <= sideMeters && poi.z >= 0 && poi.z <= sideMeters, `${poi.id}: in bounds`);
    }
  }
});

test("deterministic: two emits are identical, checksum included", () => {
  const a = emitPoiList({ lands: defaultLands(), phase: "A" });
  const b = emitPoiList({ lands: defaultLands(), phase: "A" });
  assert.deepEqual(a, b);
  assert.match(a.checksum, /^[0-9a-f]{8}$/);
});

test("named refusals ride the compiler's convention", () => {
  assert.throws(() => emitPoiList({ lands: defaultLands(), phase: "C" }), /ERR_UNKNOWN_PHASE/);
  assert.throws(() => emitPoiList({ lands: [], phase: "A" }), /ERR_NO_LANDS/);
  assert.throws(
    () => emitPoiList({ lands: [{ name: "X", sideKm: { A: -1, B: 1 } }], phase: "A" }),
    /ERR_SIDE_NOT_POSITIVE/,
  );
  assert.throws(
    () =>
      emitPoiList({
        lands: [
          { name: "X", sideKm: { A: 1, B: 1 } },
          { name: "X", sideKm: { A: 1, B: 1 } },
        ],
        phase: "A",
      }),
    /ERR_DUPLICATE_LAND/,
  );
});
