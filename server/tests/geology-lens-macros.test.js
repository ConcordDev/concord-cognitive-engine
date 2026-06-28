// Behavioral macro tests for server/domains/geology.js — the rock/mineral/
// seismic/field-geology substrate the /lenses/geology lens drives (rock
// classify, mineral ID, stratigraphic column, seismic risk, plus the
// STATE-backed field journal: observations, structural strike/dip
// measurements, sample photos, specimen collection, and field-trip itineraries).
//
// This file mirrors the REAL LENS_ACTIONS dispatch: every geology handler is
// registered via `registerLensAction(domain, action, handler)` and invoked as
// `handler(ctx, virtualArtifact, input)` — the 3-ARG convention with
// `virtualArtifact.data === input`. The dispatch ALSO peels exactly one
// redundant `{ artifact: { data } }` wrapper (lens-input-normalize.js); we peel
// the same way before calling so the harness is byte-identical to production.
//
// These are NOT shape-only assertions. They pin ACTUAL computed values for
// KNOWN inputs → KNOWN outputs (rock durability bands, mineral confidence score,
// cumulative stratigraphic depth, seismic amplification, right-hand-rule dip
// direction, circular-mean strike), CRUD round-trips through real STATE, the
// EXACT field names each lens component renders (so a dead-surface regression
// surfaces here), validation-rejection, graceful degradation, and a fail-CLOSED
// poisoned-numeric contract: Infinity/NaN/1e999 inputs are clamped/rejected and
// NEVER leak Infinity/NaN (serialized null) into the result, and NEVER throw.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGeologyActions from "../domains/geology.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "geology", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}

// Mirror the live dispatch exactly: peel one redundant artifact wrapper, then
// handler(ctx, virtualArtifact, input) with virtualArtifact.data = input.
function call(name, ctx, rawInput = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`geology.${name} not registered`);
  const input = peelRedundantArtifactWrapper(rawInput);
  const virtualArtifact = { id: null, title: rawInput?.title ?? null, domain: "geology", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerGeologyActions(registerLensAction); });

beforeEach(() => {
  // No boot, no network. Any handler that reaches for the network in a test is
  // a leak — these pure-compute + STATE macros never should.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "geo_user_a" }, userId: "geo_user_a" };
const ctxB = { actor: { userId: "geo_user_b" }, userId: "geo_user_b" };

// Assert no value in the (possibly nested) object is a non-finite number.
function assertNoNonFinite(obj, path = "root") {
  if (obj == null) return;
  if (typeof obj === "number") {
    assert.ok(Number.isFinite(obj), `non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertNoNonFinite(v, `${path}[${i}]`)); return; }
  if (typeof obj === "object") { for (const k of Object.keys(obj)) assertNoNonFinite(obj[k], `${path}.${k}`); }
}

// ── registration: every lens-driven macro is present ───────────────────────
describe("geology — registration (every lens-driven macro present)", () => {
  it("registers the pure-compute macros", () => {
    for (const m of ["rockClassify", "seismicRisk", "mineralId", "stratigraphicColumn"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing geology.${m}`);
    }
  });
  it("registers the field-journal + structural + collection + trip macros the components call", () => {
    for (const m of [
      "observation-log", "observation-list", "observation-update", "observation-delete", "field-dashboard",
      "measurement-record", "measurement-list", "measurement-delete",
      "photo-attach", "photo-list", "photo-delete",
      "collection-add", "collection-list", "collection-toggle", "collection-remove",
      "fieldtrip-create", "fieldtrip-list", "fieldtrip-add-stop",
      "fieldtrip-reorder-stops", "fieldtrip-update-stop", "fieldtrip-delete",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing geology.${m}`);
    }
  });
});

// ── rockClassify — texture→type + durability/uses bands ────────────────────
describe("geology.rockClassify — classification + durability the panel renders", () => {
  it("classifies a foliated, hard specimen → metamorphic + highly-durable", () => {
    const r = call("rockClassify", ctxA, { name: "Gneiss", mohsHardness: 7, luster: "Vitreous", color: "gray", texture: "foliated" });
    assert.equal(r.ok, true);
    assert.equal(r.result.specimen, "Gneiss");
    assert.equal(r.result.rockType, "metamorphic");
    assert.equal(r.result.mohsHardness, 7);
    assert.equal(r.result.durability, "highly-durable");
    assert.deepEqual(r.result.commonUses, ["construction", "countertops", "monuments"]);
  });

  it("vesicular → igneous; clastic → sedimentary; unknown → unclassified", () => {
    assert.equal(call("rockClassify", ctxA, { texture: "vesicular" }).result.rockType, "igneous");
    assert.equal(call("rockClassify", ctxA, { texture: "clastic" }).result.rockType, "sedimentary");
    assert.equal(call("rockClassify", ctxA, { texture: "smooth" }).result.rockType, "unclassified");
  });

  it("durability bands: 5 → moderate, 2 → soft", () => {
    assert.equal(call("rockClassify", ctxA, { mohsHardness: 5 }).result.durability, "moderate");
    assert.equal(call("rockClassify", ctxA, { mohsHardness: 2 }).result.durability, "soft");
  });

  it("fail-CLOSED: a poisoned Infinity/1e999 hardness is clamped, never leaks Infinity", () => {
    const inf = call("rockClassify", ctxA, { mohsHardness: Infinity, texture: "foliated" });
    assert.equal(inf.ok, true);
    assert.ok(Number.isFinite(inf.result.mohsHardness));
    assert.ok(inf.result.mohsHardness <= 10);
    assertNoNonFinite(inf.result);
    const str = call("rockClassify", ctxA, { mohsHardness: "1e999" });
    assert.ok(Number.isFinite(str.result.mohsHardness));
    const nan = call("rockClassify", ctxA, { mohsHardness: "not-a-number" });
    assert.equal(nan.result.mohsHardness, 0);
    assertNoNonFinite(nan.result);
  });
});

// ── seismicRisk — amplification + clamped coordinates ──────────────────────
describe("geology.seismicRisk — amplification, risk level + coordinate clamp", () => {
  it("computes amplified risk for a Bay-Area soft-soil site (high risk)", () => {
    const r = call("seismicRisk", ctxA, { latitude: 37.77, longitude: -122.42, soilType: "soft-soil" });
    assert.equal(r.ok, true);
    assert.equal(r.result.amplificationFactor, 1.6);
    // base 0.8 × 1.6 = 1.28 → clamped to 1.0 (100%).
    assert.equal(r.result.adjustedRisk, 100);
    assert.equal(r.result.riskLevel, "high");
    assert.ok(Array.isArray(r.result.recommendations) && r.result.recommendations.length >= 3);
    assertNoNonFinite(r.result);
  });

  it("rock site far from a fault → low risk, standard codes", () => {
    const r = call("seismicRisk", ctxA, { latitude: 5, longitude: 5, soilType: "rock" });
    assert.equal(r.result.amplificationFactor, 1.0);
    assert.equal(r.result.riskLevel, "low");
    assert.deepEqual(r.result.recommendations, ["Standard building codes sufficient"]);
  });

  it("fail-CLOSED: poisoned Infinity/NaN coords fall back + clamp; location never leaks null", () => {
    const r = call("seismicRisk", ctxA, { latitude: Infinity, longitude: "NaN", soilType: "rock" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.location.lat));
    assert.ok(Number.isFinite(r.result.location.lon));
    assert.ok(r.result.location.lat >= -90 && r.result.location.lat <= 90);
    assert.ok(r.result.location.lon >= -180 && r.result.location.lon <= 180);
    assertNoNonFinite(r.result);
  });
});

// ── mineralId — confidence scoring + classification ────────────────────────
describe("geology.mineralId — confidence score + property clamp", () => {
  it("scores a fully-tested specimen and classifies by hardness", () => {
    const r = call("mineralId", ctxA, { name: "Quartz", hardness: 7, streak: "white", cleavage: "none", specificGravity: 2.65, color: "clear" });
    assert.equal(r.ok, true);
    // 25 (hardness>0) + 20 (streak) + 20 (cleavage) + 20 (sg>0) + 15 (color) = 100.
    assert.equal(r.result.identificationConfidence, 100);
    assert.equal(r.result.classification, "silicate-likely");
    assert.equal(r.result.properties.hardness, 7);
    assert.equal(r.result.properties.specific_gravity, 2.65);
    assertNoNonFinite(r.result);
  });

  it("a sparsely-tested specimen scores low and recommends more tests", () => {
    const r = call("mineralId", ctxA, { name: "Unknown", hardness: 3 });
    assert.equal(r.result.identificationConfidence, 25);
    assert.equal(r.result.classification, "carbonate-or-sulfate");
    assert.ok(Array.isArray(r.result.testsRecommended));
  });

  it("fail-CLOSED: poisoned hardness/SG are clamped, never leak Infinity/NaN", () => {
    const r = call("mineralId", ctxA, { name: "Bad", hardness: Infinity, specificGravity: "1e999" });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.properties.hardness));
    assert.ok(Number.isFinite(r.result.properties.specific_gravity));
    assert.ok(r.result.properties.hardness <= 10);
    assertNoNonFinite(r.result);
  });
});

// ── stratigraphicColumn — cumulative depth from layer thicknesses ──────────
describe("geology.stratigraphicColumn — cumulative depth + ordering", () => {
  it("builds the column with correct depthTop/depthBottom and totals", () => {
    const r = call("stratigraphicColumn", ctxA, { layers: [
      { name: "Topsoil", thickness: 2, age: "recent", fossils: [] },
      { name: "Sandstone", thickness: 8, lithology: "sandstone", fossils: ["ammonite"] },
      { name: "Limestone", thickness: 10, fossils: [] },
    ] });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalThickness, 20);
    assert.equal(r.result.layerCount, 3);
    assert.equal(r.result.layers[0].depthTop, 0);
    assert.equal(r.result.layers[0].depthBottom, 2);
    assert.equal(r.result.layers[1].depthTop, 2);
    assert.equal(r.result.layers[1].depthBottom, 10);
    assert.equal(r.result.layers[2].depthBottom, 20);
    assert.equal(r.result.youngestFormation, "Topsoil");
    assert.equal(r.result.oldestFormation, "Limestone");
    assert.equal(r.result.fossiliferous, 1);
    assertNoNonFinite(r.result);
  });

  it("degrade-graceful: no layers → guidance message, not a crash", () => {
    const r = call("stratigraphicColumn", ctxA, { layers: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add geological layers/i);
  });

  it("fail-CLOSED: a poisoned Infinity/NaN thickness never inverts the depth axis or leaks Infinity", () => {
    const r = call("stratigraphicColumn", ctxA, { layers: [
      { name: "A", thickness: Infinity },
      { name: "B", thickness: "1e999" },
      { name: "C", thickness: -5 },
    ] });
    assert.equal(r.ok, true);
    assert.ok(Number.isFinite(r.result.totalThickness));
    for (const l of r.result.layers) {
      assert.ok(Number.isFinite(l.thickness) && l.thickness >= 0, `thickness ${l.thickness}`);
      assert.ok(l.depthBottom >= l.depthTop, "depth axis never inverts");
    }
    assertNoNonFinite(r.result);
  });
});

// ── observation journal — CRUD round-trip + dashboard ──────────────────────
describe("geology.observation-* — field-log round-trip + dashboard aggregation", () => {
  it("logs an observation, lists it back, and the dashboard counts it", () => {
    const logged = call("observation-log", ctxA, { name: "Roadcut shale", kind: "outcrop", locationName: "Hwy 9", formation: "Marcellus", lat: 42.1, lon: -76.2, tags: ["Shale", "marine"] });
    assert.equal(logged.ok, true);
    const obs = logged.result.observation;
    assert.equal(obs.name, "Roadcut shale");
    assert.equal(obs.kind, "outcrop");
    assert.equal(obs.formation, "Marcellus");
    assert.deepEqual(obs.tags, ["shale", "marine"]); // lowercased

    const list = call("observation-list", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.observations[0].id, obs.id);

    const dash = call("field-dashboard", ctxA, {});
    assert.equal(dash.result.totalObservations, 1);
    assert.equal(dash.result.byKind.outcrop, 1);
    assert.equal(dash.result.geotagged, 1);
    assert.equal(dash.result.formations, 1);
  });

  it("filters by kind and is per-user isolated", () => {
    call("observation-log", ctxA, { name: "Granite boulder", kind: "rock" });
    call("observation-log", ctxA, { name: "Trilobite", kind: "fossil" });
    const rocks = call("observation-list", ctxA, { kind: "rock" });
    assert.ok(rocks.result.observations.every((o) => o.kind === "rock"));
    // Another user sees none of user A's rows.
    assert.equal(call("observation-list", ctxB, {}).result.count, 0);
  });

  it("validation-rejection: an empty name is rejected", () => {
    const r = call("observation-log", ctxA, { name: "   " });
    assert.equal(r.ok, false);
    assert.match(r.error, /name required/i);
  });

  it("update + delete round-trip", () => {
    const o = call("observation-log", ctxA, { name: "Vein quartz", kind: "mineral" }).result.observation;
    const up = call("observation-update", ctxA, { id: o.id, notes: "milky", kind: "rock" });
    assert.equal(up.result.observation.notes, "milky");
    assert.equal(up.result.observation.kind, "rock");
    const del = call("observation-delete", ctxA, { id: o.id });
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, o.id);
    assert.ok(!call("observation-list", ctxA, {}).result.observations.some((x) => x.id === o.id));
  });
});

// ── structural compass — strike/dip + dip-direction + circular mean ────────
describe("geology.measurement-* — strike/dip right-hand-rule + stereonet mean", () => {
  it("records a measurement with the correct right-hand-rule dip direction", () => {
    const r = call("measurement-record", ctxA, { planeKind: "bedding", strike: 30, dip: 45, locationName: "Quarry wall" });
    assert.equal(r.ok, true);
    const m = r.result.measurement;
    assert.equal(m.strike, 30);
    assert.equal(m.dip, 45);
    assert.equal(m.dipDirection, 120); // strike + 90, RHR
    assert.equal(m.planeKind, "bedding");
  });

  it("normalizes an over-360 strike and computes a circular mean over the list", () => {
    // wipe by using a fresh user.
    const ctx = { actor: { userId: "geo_strike_u" }, userId: "geo_strike_u" };
    call("measurement-record", ctx, { strike: 10, dip: 20 });
    call("measurement-record", ctx, { strike: 350, dip: 20 });
    const list = call("measurement-list", ctx, {});
    assert.equal(list.result.count, 2);
    // circular mean of 10° and 350° is 0° (≈360), NOT the naive arithmetic 180°.
    assert.ok(list.result.meanStrike <= 1 || list.result.meanStrike >= 359, `meanStrike ${list.result.meanStrike}`);
    assert.equal(list.result.byKind.bedding, 2);
    // over-360 input normalized.
    const norm = call("measurement-record", ctx, { strike: 370, dip: 5 });
    assert.equal(norm.result.measurement.strike, 10);
  });

  it("validation-rejection: missing strike/dip and out-of-range dip", () => {
    assert.match(call("measurement-record", ctxA, { strike: 30 }).error, /strike \+ dip required/i);
    assert.match(call("measurement-record", ctxA, { strike: 30, dip: 120 }).error, /dip must be 0-90/i);
  });

  it("fail-CLOSED: a poisoned Infinity/NaN strike is rejected (never NaN dipDirection)", () => {
    const r = call("measurement-record", ctxA, { strike: Infinity, dip: 45 });
    assert.equal(r.ok, false);
    assert.match(r.error, /strike \+ dip required/i);
    const r2 = call("measurement-record", ctxA, { strike: "1e999", dip: 45 });
    assert.equal(r2.ok, false);
  });
});

// ── specimen collection — dedupe count + identified toggle ─────────────────
describe("geology.collection-* — life-list dedupe + stats", () => {
  it("adds a new specimen then re-adds (count increments, not duplicated)", () => {
    const ctx = { actor: { userId: "geo_collect_u" }, userId: "geo_collect_u" };
    const first = call("collection-add", ctx, { name: "Pyrite", kind: "mineral", locality: "Spain" });
    assert.equal(first.result.isNew, true);
    assert.equal(first.result.entry.count, 1);
    const again = call("collection-add", ctx, { name: "pyrite", kind: "mineral" }); // case-insensitive
    assert.equal(again.result.isNew, false);
    assert.equal(again.result.entry.count, 2);

    const list = call("collection-list", ctx, {});
    assert.equal(list.result.uniqueCount, 1);
    assert.equal(list.result.totalSpecimens, 2);
    assert.equal(list.result.byKind.mineral, 1);
    assert.equal(list.result.identifiedCount, 1);
  });

  it("toggle flips identified; remove deletes", () => {
    const ctx = { actor: { userId: "geo_collect_u2" }, userId: "geo_collect_u2" };
    const e = call("collection-add", ctx, { name: "Galena", kind: "mineral" }).result.entry;
    assert.equal(e.identified, true);
    assert.equal(call("collection-toggle", ctx, { id: e.id }).result.entry.identified, false);
    assert.equal(call("collection-remove", ctx, { id: e.id }).result.removed, e.id);
    assert.equal(call("collection-list", ctx, {}).result.uniqueCount, 0);
  });

  it("validation-rejection: empty name", () => {
    assert.match(call("collection-add", ctxA, { name: "" }).error, /name required/i);
  });
});

// ── photo attach — observation linkage + EXIF backfill ─────────────────────
describe("geology.photo-* — attach to observation + EXIF geotag backfill", () => {
  it("attaches a geotagged photo and backfills the observation coords", () => {
    const ctx = { actor: { userId: "geo_photo_u" }, userId: "geo_photo_u" };
    const obs = call("observation-log", ctx, { name: "Cliff face", kind: "outcrop" }).result.observation;
    assert.equal(obs.lat, null);
    const tinyJpeg = "data:image/jpeg;base64,/9j/AA==";
    const ph = call("photo-attach", ctx, { observationId: obs.id, dataUrl: tinyJpeg, caption: "north wall", exifLat: 36.1, exifLon: -112.1, cameraModel: "Pixel 8" });
    assert.equal(ph.ok, true);
    assert.equal(ph.result.photo.observationId, obs.id);
    assert.equal(ph.result.photo.exifLat, 36.1);
    // observation backfilled from EXIF.
    const back = call("observation-list", ctx, {}).result.observations.find((o) => o.id === obs.id);
    assert.equal(back.lat, 36.1);
    assert.equal(back.lon, -112.1);
    const list = call("photo-list", ctx, { observationId: obs.id });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.geotagged, 1);
  });

  it("validation-rejection: bad dataUrl + missing observation", () => {
    const ctx = { actor: { userId: "geo_photo_u2" }, userId: "geo_photo_u2" };
    assert.match(call("photo-attach", ctx, { observationId: "x", dataUrl: "not-an-image" }).error, /valid image dataUrl/i);
    assert.match(call("photo-attach", ctx, { observationId: "missing", dataUrl: "data:image/png;base64,AA" }).error, /observation not found/i);
  });
});

// ── field trips — create, add stops, reorder ───────────────────────────────
describe("geology.fieldtrip-* — itinerary build + reorder", () => {
  it("creates a trip, adds ordered stops, and reorders them", () => {
    const ctx = { actor: { userId: "geo_trip_u" }, userId: "geo_trip_u" };
    const trip = call("fieldtrip-create", ctx, { name: "Sierra transect", area: "CA" }).result.fieldTrip;
    assert.equal(trip.stops.length, 0);
    const s1 = call("fieldtrip-add-stop", ctx, { tripId: trip.id, name: "Stop 1", lithology: "granite" }).result.stop;
    const s2 = call("fieldtrip-add-stop", ctx, { tripId: trip.id, name: "Stop 2" }).result.stop;
    assert.equal(s1.order, 1);
    assert.equal(s2.order, 2);

    const re = call("fieldtrip-reorder-stops", ctx, { tripId: trip.id, stopIds: [s2.id, s1.id] });
    assert.equal(re.ok, true);
    assert.equal(re.result.fieldTrip.stops[0].id, s2.id);
    assert.equal(re.result.fieldTrip.stops[0].order, 1);

    const list = call("fieldtrip-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.totalStops, 2);
  });

  it("validation-rejection: empty trip name; stop on missing trip; bad reorder", () => {
    const ctx = { actor: { userId: "geo_trip_u2" }, userId: "geo_trip_u2" };
    assert.match(call("fieldtrip-create", ctx, { name: "" }).error, /name required/i);
    assert.match(call("fieldtrip-add-stop", ctx, { tripId: "nope", name: "x" }).error, /not found/i);
    const trip = call("fieldtrip-create", ctx, { name: "T" }).result.fieldTrip;
    call("fieldtrip-add-stop", ctx, { tripId: trip.id, name: "only" });
    const bad = call("fieldtrip-reorder-stops", ctx, { tripId: trip.id, stopIds: ["a", "b"] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /every stop exactly once/i);
  });
});

// ── double-wrap dispatch parity — the dead-surface bug class ────────────────
describe("geology — { artifact:{ data } } double-wrap is peeled like production", () => {
  it("rockClassify reads through a sole-key artifact wrapper identically to flat input", () => {
    const wrapped = call("rockClassify", ctxA, { artifact: { data: { name: "Basalt", texture: "vesicular", mohsHardness: 6 } } });
    const flat = call("rockClassify", ctxA, { name: "Basalt", texture: "vesicular", mohsHardness: 6 });
    assert.equal(wrapped.result.rockType, "igneous");
    assert.deepEqual(wrapped.result, flat.result);
  });

  it("stratigraphicColumn reads through the wrapper (the historical blank-calc bug)", () => {
    const wrapped = call("stratigraphicColumn", ctxA, { artifact: { data: { layers: [{ name: "X", thickness: 4 }] } } });
    assert.equal(wrapped.ok, true);
    assert.equal(wrapped.result.totalThickness, 4);
  });
});
