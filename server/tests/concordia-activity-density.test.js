// CP-10 — Activity density compiler: per-land counts meet CONCORDIA_PLAN
// §4.11 for the active footprint, counted from the placement manifests
// (the GATE-7 shape). Expected counts below are literals taken from the
// plan (§4.11 targets table + §4.2 footprints), not from the module.
//
//   cd server && node --test tests/concordia-activity-density.test.js

import test from "node:test";
import assert from "node:assert/strict";
import {
  compileActivities,
  defaultLands,
  DENSITY_TARGETS,
} from "../../scripts/concordia/compile-activities.mjs";

const byName = (result, name) => result.lands.find((m) => m.land === name);

test("§4.11 targets are the plan's, verbatim", () => {
  assert.deepEqual(
    { ...DENSITY_TARGETS },
    {
      majorPoi: 1.5,
      minorPoi: 6,
      encounterGroups: 10,
      gatherableNodes: 40,
      questTouchpoints: 3,
    },
  );
});

test("Phase A: the Hub at 16 km² meets §4.11's own per-16 km² column exactly", () => {
  const result = compileActivities({ lands: defaultLands(), phase: "A" });
  const hub = byName(result, "Unburned Court");
  assert.equal(hub.footprintKm2, 16);
  assert.deepEqual(hub.counts, {
    majorPoi: 24,
    minorPoi: 96,
    encounterGroups: 160,
    gatherableNodes: 640,
    questTouchpoints: 48,
  });
});

test("Phase A: every land's counts equal round(target × footprint) with plan literals", () => {
  const result = compileActivities({ lands: defaultLands(), phase: "A" });
  // §4.2 Phase A footprints: 4×4 Hub · 2×2 the seven mid lands · 2.5×2.5
  // Tunya (6.25 km²) · 1.5×1.5 The Crucible (2.25 km²).
  assert.deepEqual(byName(result, "The Sundering").counts, {
    majorPoi: 6,
    minorPoi: 24,
    encounterGroups: 40,
    gatherableNodes: 160,
    questTouchpoints: 12,
  });
  assert.deepEqual(byName(result, "Tunya").counts, {
    majorPoi: 9, // round(1.5 × 6.25 = 9.375)
    minorPoi: 38, // round(6 × 6.25 = 37.5), halves up
    encounterGroups: 63, // round(10 × 6.25 = 62.5), halves up
    gatherableNodes: 250,
    questTouchpoints: 19, // round(3 × 6.25 = 18.75)
  });
  assert.deepEqual(byName(result, "The Crucible").counts, {
    majorPoi: 3, // round(1.5 × 2.25 = 3.375)
    minorPoi: 14, // round(6 × 2.25 = 13.5), halves up
    encounterGroups: 23, // round(10 × 2.25 = 22.5), halves up
    gatherableNodes: 90,
    questTouchpoints: 7, // round(3 × 2.25 = 6.75)
  });
  assert.equal(result.lands.length, 10);
});

test("manifests carry the placements GATE-7 counts: lengths, ids, bounds", () => {
  const result = compileActivities({ lands: defaultLands(), phase: "A" });
  for (const m of result.lands) {
    const countSum = Object.values(m.counts).reduce((a, b) => a + b, 0);
    assert.equal(m.placements.length, countSum, `${m.land} placement total`);
    const ids = new Set(m.placements.map((p) => p.id));
    assert.equal(ids.size, m.placements.length, `${m.land} placement ids unique`);
    for (const category of Object.keys(m.counts)) {
      assert.equal(
        m.placements.filter((p) => p.category === category).length,
        m.counts[category],
        `${m.land} ${category} placements == count`,
      );
    }
    const sideMeters = m.sideKm * 1000;
    for (const p of m.placements) {
      assert.ok(p.x >= 0 && p.x < sideMeters, `${p.id} x in frame`);
      assert.ok(p.z >= 0 && p.z < sideMeters, `${p.id} z in frame`);
    }
    assert.match(m.checksum, /^[0-9a-f]{8}$/);
  }
  const placedTotal = result.lands.reduce((s, m) => s + m.placements.length, 0);
  assert.equal(result.totals.placements, placedTotal);
});

test("compilation is deterministic: same input, same manifest, byte for byte", () => {
  const a = compileActivities({ lands: defaultLands(), phase: "A" });
  const b = compileActivities({ lands: defaultLands(), phase: "A" });
  assert.deepEqual(a, b);
  assert.equal(
    a.lands.map((m) => m.checksum).join(","),
    b.lands.map((m) => m.checksum).join(","),
  );
});

test("Phase B: Tunya at 20.25 km² meets §4.11 under the same rule", () => {
  const result = compileActivities({ lands: defaultLands(), phase: "B" });
  const tunya = byName(result, "Tunya");
  assert.equal(tunya.footprintKm2, 20.25);
  assert.deepEqual(tunya.counts, {
    majorPoi: 30, // round(1.5 × 20.25 = 30.375)
    minorPoi: 122, // round(6 × 20.25 = 121.5), halves up
    encounterGroups: 203, // round(10 × 20.25 = 202.5), halves up
    gatherableNodes: 810,
    questTouchpoints: 61, // round(3 × 20.25 = 60.75)
  });
});

function throwsCode(fn, code) {
  assert.throws(fn, (err) => err.code === code && err.message.includes(code));
}

test("adversarial: refused inputs name their error, never a silent count", () => {
  const good = { name: "Testland", sideKm: { A: 2, B: 2 } };
  throwsCode(() => compileActivities({ lands: [], phase: "A" }), "ERR_NO_LANDS");
  throwsCode(() => compileActivities({ lands: null, phase: "A" }), "ERR_NO_LANDS");
  throwsCode(() => compileActivities({ lands: [good], phase: "C" }), "ERR_UNKNOWN_PHASE");
  throwsCode(
    () => compileActivities({ lands: [{ sideKm: { A: 2, B: 2 } }], phase: "A" }),
    "ERR_LAND_SHAPE",
  );
  throwsCode(
    () => compileActivities({ lands: [good, { ...good }], phase: "A" }),
    "ERR_DUPLICATE_LAND",
  );
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: NaN, B: 2 } }], phase: "A" }),
    "ERR_SIDE_NOT_FINITE",
  );
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: Infinity, B: 2 } }], phase: "A" }),
    "ERR_SIDE_NOT_FINITE",
  );
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: "2", B: 2 } }], phase: "A" }),
    "ERR_SIDE_NOT_FINITE",
  );
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: 0, B: 2 } }], phase: "A" }),
    "ERR_SIDE_NOT_POSITIVE",
  );
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: -2, B: 2 } }], phase: "A" }),
    "ERR_SIDE_NOT_POSITIVE",
  );
  // A phase the land does not carry is a finite-check refusal, not a NaN count.
  throwsCode(
    () => compileActivities({ lands: [{ name: "X", sideKm: { A: 2 } }], phase: "B" }),
    "ERR_SIDE_NOT_FINITE",
  );
});
