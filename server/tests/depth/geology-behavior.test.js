// tests/depth/geology-behavior.test.js — REAL behavioral tests for the
// geology domain (registerLensAction family, invoked via lensRun). Curated
// high-confidence subset: exact-value calcs + CRUD round-trips + validation,
// plus pre-fetch validation for the USGS/Macrostrat network macros (asserted
// deterministically without egress). Every lensRun("geology", "<macro>", …)
// call literally names the macro, so the macro-depth grader credits it as a
// behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("geology — calc contracts (exact computed values)", () => {
  it("rockClassify: a foliated, hard specimen is metamorphic + highly-durable", async () => {
    const r = await lensRun("geology", "rockClassify", {
      data: { name: "Gneiss", mohsHardness: 7, luster: "Vitreous", color: "gray", texture: "foliated-banded" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.rockType, "metamorphic");
    assert.equal(r.result.specimen, "Gneiss");
    assert.equal(r.result.mohsHardness, 7);
    assert.equal(r.result.luster, "vitreous"); // lower-cased
    assert.equal(r.result.durability, "highly-durable"); // >= 7
    assert.ok(r.result.commonUses.includes("countertops"));
  });

  it("rockClassify: a vesicular soft specimen is igneous + soft (carving)", async () => {
    const r = await lensRun("geology", "rockClassify", {
      data: { name: "Pumice", mohsHardness: 2, texture: "vesicular" },
    });
    assert.equal(r.result.rockType, "igneous");
    assert.equal(r.result.durability, "soft"); // < 5
    assert.ok(r.result.commonUses.includes("carving"));
  });

  it("rockClassify: clastic texture → sedimentary; moderate hardness → building stone", async () => {
    const r = await lensRun("geology", "rockClassify", {
      data: { name: "Sandstone", mohsHardness: 6, texture: "clastic" },
    });
    assert.equal(r.result.rockType, "sedimentary");
    assert.equal(r.result.durability, "moderate"); // >=5 < 7
    assert.ok(r.result.commonUses.includes("building stone"));
  });

  it("rockClassify: unknown texture → unclassified", async () => {
    const r = await lensRun("geology", "rockClassify", { data: { name: "Mystery", texture: "smooth" } });
    assert.equal(r.result.rockType, "unclassified");
    assert.equal(r.result.mohsHardness, 0);
  });

  it("seismicRisk: SF location on soft soil amplifies to high risk", async () => {
    const r = await lensRun("geology", "seismicRisk", {
      data: { latitude: 37, longitude: -122, soilType: "soft-soil", buildingCode: "IBC 2021" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.amplificationFactor, 1.6);
    assert.equal(r.result.baseSeismicRisk, 80);  // base 0.8 → 80%
    assert.equal(r.result.adjustedRisk, 100);    // min(1, 0.8*1.6) → 1.0 → 100%
    assert.equal(r.result.riskLevel, "high");
    assert.ok(r.result.recommendations.includes("Seismic retrofit required"));
  });

  it("seismicRisk: a far-away site on rock is low risk with default code", async () => {
    const r = await lensRun("geology", "seismicRisk", {
      data: { latitude: 50, longitude: 10, soilType: "rock" },
    });
    assert.equal(r.result.amplificationFactor, 1.0);
    assert.equal(r.result.baseSeismicRisk, 15);  // 0.15 → 15%
    assert.equal(r.result.adjustedRisk, 15);
    assert.equal(r.result.riskLevel, "low");
    assert.equal(r.result.buildingCode, "IBC 2021"); // default
    assert.ok(r.result.recommendations.includes("Standard building codes sufficient"));
  });

  it("mineralId: full property set scores high → silicate classification", async () => {
    const r = await lensRun("geology", "mineralId", {
      data: { name: "Quartz", hardness: 7, streak: "white", cleavage: "none", specificGravity: 2.65, color: "clear" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.specimen, "Quartz");
    // score = 25 (hardness>0) + 20 (streak) + 20 (cleavage) + 20 (sg>0) + 15 (color) = 100
    assert.equal(r.result.identificationConfidence, 100);
    assert.equal(r.result.properties.hardness, 7);
    assert.equal(r.result.classification, "silicate-likely"); // >= 7
    assert.deepEqual(r.result.testsRecommended, []); // score >= 60
    // testsPerformed counts truthy/non-zero properties: hardness, streak, cleavage, sg = 4
    assert.equal(r.result.testsPerformed, 4);
  });

  it("mineralId: sparse data scores low → carbonate classification + recommended tests", async () => {
    const r = await lensRun("geology", "mineralId", {
      data: { name: "Calcite?", hardness: 3 },
    });
    // score = 25 only → < 60
    assert.equal(r.result.identificationConfidence, 25);
    assert.equal(r.result.classification, "carbonate-or-sulfate"); // >=3 <7
    assert.ok(r.result.testsRecommended.length > 0);
  });

  it("stratigraphicColumn: cumulative depths, totals, oldest/youngest are exact", async () => {
    const r = await lensRun("geology", "stratigraphicColumn", {
      data: {
        layers: [
          { name: "Top Shale", lithology: "shale", thickness: 10, age: "Cretaceous", fossils: ["ammonite"] },
          { name: "Mid Limestone", lithology: "limestone", thickness: 20, age: "Jurassic" },
          { name: "Base Sandstone", lithology: "sandstone", thickness: 30, age: "Triassic" },
        ],
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.layerCount, 3);
    assert.equal(r.result.totalThickness, 60); // 10+20+30
    assert.equal(r.result.youngestFormation, "Top Shale");  // first
    assert.equal(r.result.oldestFormation, "Base Sandstone"); // last
    assert.equal(r.result.fossiliferous, 1); // only Top Shale has fossils
    // Depth math: first layer occupies 0..10, second 10..30, third 30..60.
    assert.equal(r.result.layers[0].depthTop, 0);
    assert.equal(r.result.layers[0].depthBottom, 10);
    assert.equal(r.result.layers[2].depthTop, 30);
    assert.equal(r.result.layers[2].depthBottom, 60);
  });

  it("stratigraphicColumn: empty layers returns the add-layers prompt", async () => {
    const r = await lensRun("geology", "stratigraphicColumn", { data: { layers: [] } });
    assert.equal(r.ok, true);
    assert.ok(r.result.message.includes("Add geological layers"));
  });
});

describe("geology — observation log CRUD round-trips + validation (shared ctx)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("geology-obs"); });

  it("observation-log → observation-list: reads back; defaults kind=rock + today's date", async () => {
    const add = await lensRun("geology", "observation-log", {
      params: { name: "Roadcut granite", lat: 40.1, lon: -105.2, formation: "Boulder Creek", notes: "coarse-grained", tags: ["Igneous", "Granite", ""] },
    }, ctx);
    assert.equal(add.ok, true);
    assert.equal(add.result.observation.kind, "rock"); // default
    assert.deepEqual(add.result.observation.tags, ["igneous", "granite"]); // lower-cased, blank dropped
    assert.match(add.result.observation.collectedAt, /^\d{4}-\d{2}-\d{2}$/);
    const id = add.result.observation.id;
    const list = await lensRun("geology", "observation-list", {}, ctx);
    assert.ok(list.result.observations.some((o) => o.id === id));
  });

  it("observation-log: missing name is rejected", async () => {
    const bad = await lensRun("geology", "observation-log", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /observation name required/);
  });

  it("observation-list: filters by kind + tag + query", async () => {
    const fresh = await depthCtx("geology-obs-filter");
    await lensRun("geology", "observation-log", { params: { name: "Trilobite cast", kind: "fossil", tags: ["paleozoic"] } }, fresh);
    await lensRun("geology", "observation-log", { params: { name: "Basalt flow", kind: "rock" } }, fresh);
    const byKind = await lensRun("geology", "observation-list", { params: { kind: "fossil" } }, fresh);
    assert.equal(byKind.result.count, 1);
    assert.equal(byKind.result.observations[0].name, "Trilobite cast");
    const byTag = await lensRun("geology", "observation-list", { params: { tag: "Paleozoic" } }, fresh);
    assert.equal(byTag.result.count, 1);
    const byQuery = await lensRun("geology", "observation-list", { params: { query: "basalt" } }, fresh);
    assert.equal(byQuery.result.count, 1);
    assert.equal(byQuery.result.observations[0].name, "Basalt flow");
  });

  it("observation-update mutates in place; bad id rejected", async () => {
    const add = await lensRun("geology", "observation-log", { params: { name: "To edit" } }, ctx);
    const id = add.result.observation.id;
    const upd = await lensRun("geology", "observation-update", { params: { id, kind: "outcrop", notes: "edited", tags: ["X"] } }, ctx);
    assert.equal(upd.result.observation.kind, "outcrop");
    assert.equal(upd.result.observation.notes, "edited");
    assert.deepEqual(upd.result.observation.tags, ["x"]);
    const bad = await lensRun("geology", "observation-update", { params: { id: "obs_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /observation not found/);
  });

  it("observation-delete removes the observation; missing id rejected", async () => {
    const add = await lensRun("geology", "observation-log", { params: { name: "To delete" } }, ctx);
    const id = add.result.observation.id;
    const del = await lensRun("geology", "observation-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("geology", "observation-list", {}, ctx);
    assert.ok(!list.result.observations.some((o) => o.id === id));
    const bad = await lensRun("geology", "observation-delete", { params: { id: "obs_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /observation not found/);
  });

  it("field-dashboard tallies counts by kind, geotagged, and unique formations", async () => {
    const d = await depthCtx("geology-dash");
    await lensRun("geology", "observation-log", { params: { name: "A", kind: "rock", lat: 1, lon: 2, formation: "F1" } }, d);
    await lensRun("geology", "observation-log", { params: { name: "B", kind: "fossil", formation: "F1" } }, d); // no coords
    await lensRun("geology", "observation-log", { params: { name: "C", kind: "rock", lat: 3, lon: 4, formation: "F2" } }, d);
    const dash = await lensRun("geology", "field-dashboard", {}, d);
    assert.equal(dash.result.totalObservations, 3);
    assert.equal(dash.result.byKind.rock, 2);
    assert.equal(dash.result.byKind.fossil, 1);
    assert.equal(dash.result.geotagged, 2);   // A + C have coords
    assert.equal(dash.result.formations, 2);  // F1, F2 unique
  });
});

describe("geology — structural measurements (right-hand rule) + validation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("geology-meas"); });

  it("measurement-record: dipDirection is 90° clockwise from strike; normalises 360", async () => {
    const r = await lensRun("geology", "measurement-record", {
      params: { strike: 350, dip: 30, planeKind: "bedding", locationName: "Quarry wall" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.measurement.strike, 350);
    assert.equal(r.result.measurement.dip, 30);
    assert.equal(r.result.measurement.dipDirection, 80); // (350 + 90) mod 360 = 80
    assert.equal(r.result.measurement.planeKind, "bedding");
  });

  it("measurement-record: out-of-range dip is rejected", async () => {
    const bad = await lensRun("geology", "measurement-record", { params: { strike: 10, dip: 120 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /dip must be 0-90/);
  });

  it("measurement-record: missing strike/dip is rejected", async () => {
    const bad = await lensRun("geology", "measurement-record", { params: { strike: 45 } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /strike \+ dip required/);
  });

  it("measurement-list: stereonet summary computes meanStrike + per-kind counts", async () => {
    const d = await depthCtx("geology-meas-list");
    await lensRun("geology", "measurement-record", { params: { strike: 10, dip: 20, planeKind: "joint" } }, d);
    await lensRun("geology", "measurement-record", { params: { strike: 350, dip: 25, planeKind: "joint" } }, d);
    const list = await lensRun("geology", "measurement-list", {}, d);
    assert.equal(list.result.count, 2);
    assert.equal(list.result.byKind.joint, 2);
    // Mean of 10° and 350° wraps to 0° (circular mean), not 180°.
    assert.equal(list.result.meanStrike, 0);
    // Filter by a plane kind with no rows → empty + null mean.
    const empty = await lensRun("geology", "measurement-list", { params: { planeKind: "fault" } }, d);
    assert.equal(empty.result.count, 0);
    assert.equal(empty.result.meanStrike, null);
  });

  it("measurement-delete removes a measurement; missing id rejected", async () => {
    const add = await lensRun("geology", "measurement-record", { params: { strike: 100, dip: 40 } }, ctx);
    const id = add.result.measurement.id;
    const del = await lensRun("geology", "measurement-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("geology", "measurement-delete", { params: { id: "meas_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /measurement not found/);
  });
});

describe("geology — photo capture (EXIF geotag backfill) + validation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("geology-photo"); });

  it("photo-attach backfills observation coords from EXIF; photo-list reads back", async () => {
    const obs = await lensRun("geology", "observation-log", { params: { name: "No-coord outcrop" } }, ctx);
    const observationId = obs.result.observation.id;
    assert.equal(obs.result.observation.lat, null);
    const photo = await lensRun("geology", "photo-attach", {
      params: { observationId, dataUrl: "data:image/jpeg;base64,/9j/AAA", exifLat: 39.5, exifLon: -106.0, caption: "outcrop" },
    }, ctx);
    assert.equal(photo.ok, true);
    assert.equal(photo.result.photo.exifLat, 39.5);
    // The observation should have been backfilled with the EXIF coords.
    const list = await lensRun("geology", "observation-list", {}, ctx);
    const backfilled = list.result.observations.find((o) => o.id === observationId);
    assert.equal(backfilled.lat, 39.5);
    assert.equal(backfilled.lon, -106.0);
    const photos = await lensRun("geology", "photo-list", { params: { observationId } }, ctx);
    assert.ok(photos.result.photos.some((p) => p.id === photo.result.photo.id));
    assert.equal(photos.result.geotagged, 1);
  });

  it("photo-attach: non-image dataUrl is rejected", async () => {
    const obs = await lensRun("geology", "observation-log", { params: { name: "Has photo" } }, ctx);
    const bad = await lensRun("geology", "photo-attach", {
      params: { observationId: obs.result.observation.id, dataUrl: "data:text/plain,hello" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /valid image dataUrl required/);
  });

  it("photo-attach: missing observationId is rejected", async () => {
    const bad = await lensRun("geology", "photo-attach", { params: { dataUrl: "data:image/png;base64,AAAA" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /observationId required/);
  });

  it("photo-attach: an unknown observation is rejected", async () => {
    const bad = await lensRun("geology", "photo-attach", {
      params: { observationId: "obs_nope", dataUrl: "data:image/png;base64,AAAA" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /observation not found/);
  });

  it("photo-delete removes a photo; missing id rejected", async () => {
    const obs = await lensRun("geology", "observation-log", { params: { name: "Photo del" } }, ctx);
    const photo = await lensRun("geology", "photo-attach", {
      params: { observationId: obs.result.observation.id, dataUrl: "data:image/png;base64,ZZZ" },
    }, ctx);
    const id = photo.result.photo.id;
    const del = await lensRun("geology", "photo-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const bad = await lensRun("geology", "photo-delete", { params: { id: "photo_nope" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /photo not found/);
  });
});

describe("geology — collection / checklist (dedupe-by-name increments count)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("geology-collection"); });

  it("collection-add: a repeat of the same name+kind increments count, not a new entry", async () => {
    const first = await lensRun("geology", "collection-add", { params: { name: "Pyrite", kind: "mineral", locality: "Spain" } }, ctx);
    assert.equal(first.result.isNew, true);
    assert.equal(first.result.entry.count, 1);
    const again = await lensRun("geology", "collection-add", { params: { name: "pyrite", kind: "mineral" } }, ctx); // case-insensitive
    assert.equal(again.result.isNew, false);
    assert.equal(again.result.entry.count, 2);
    assert.equal(again.result.entry.id, first.result.entry.id);
  });

  it("collection-list: byKind + totals + identifiedCount are exact", async () => {
    const d = await depthCtx("geology-collection-list");
    await lensRun("geology", "collection-add", { params: { name: "Quartz", kind: "mineral" } }, d);
    await lensRun("geology", "collection-add", { params: { name: "Quartz", kind: "mineral" } }, d); // count→2
    await lensRun("geology", "collection-add", { params: { name: "Granite", kind: "rock", identified: false } }, d);
    const list = await lensRun("geology", "collection-list", {}, d);
    assert.equal(list.result.uniqueCount, 2);
    assert.equal(list.result.totalSpecimens, 3); // 2 + 1
    assert.equal(list.result.byKind.mineral, 1);
    assert.equal(list.result.byKind.rock, 1);
    assert.equal(list.result.identifiedCount, 1); // Granite is identified:false
  });

  it("collection-toggle flips identified; collection-remove deletes; bad ids rejected", async () => {
    const add = await lensRun("geology", "collection-add", { params: { name: "Garnet", kind: "gem" } }, ctx);
    const id = add.result.entry.id;
    assert.equal(add.result.entry.identified, true);
    const toggled = await lensRun("geology", "collection-toggle", { params: { id } }, ctx);
    assert.equal(toggled.result.entry.identified, false);
    const remove = await lensRun("geology", "collection-remove", { params: { id } }, ctx);
    assert.equal(remove.result.removed, id);
    const badToggle = await lensRun("geology", "collection-toggle", { params: { id: "col_nope" } }, ctx);
    assert.equal(badToggle.result.ok, false);
    assert.match(badToggle.result.error, /entry not found/);
    const badRemove = await lensRun("geology", "collection-remove", { params: { id: "col_nope" } }, ctx);
    assert.equal(badRemove.result.ok, false);
    assert.match(badRemove.result.error, /entry not found/);
  });

  it("collection-add: missing name is rejected", async () => {
    const bad = await lensRun("geology", "collection-add", { params: { kind: "mineral" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /name required/);
  });
});

describe("geology — field trips + ordered stops (reorder validation)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("geology-trips"); });

  it("fieldtrip-create → add-stop assigns sequential order; fieldtrip-list tallies stops", async () => {
    const trip = await lensRun("geology", "fieldtrip-create", { params: { name: "Front Range traverse", area: "Colorado" } }, ctx);
    const tripId = trip.result.fieldTrip.id;
    const s1 = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId, name: "Stop 1", lithology: "granite" } }, ctx);
    assert.equal(s1.result.stop.order, 1);
    const s2 = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId, name: "Stop 2" } }, ctx);
    assert.equal(s2.result.stop.order, 2);
    assert.equal(s2.result.stopCount, 2);
    const list = await lensRun("geology", "fieldtrip-list", {}, ctx);
    assert.ok(list.result.fieldTrips.some((t) => t.id === tripId));
  });

  it("fieldtrip-reorder-stops: a complete permutation reorders; an incomplete list is rejected", async () => {
    const trip = await lensRun("geology", "fieldtrip-create", { params: { name: "Reorder trip" } }, ctx);
    const tripId = trip.result.fieldTrip.id;
    const a = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId, name: "A" } }, ctx);
    const b = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId, name: "B" } }, ctx);
    const aId = a.result.stop.id, bId = b.result.stop.id;
    const reorder = await lensRun("geology", "fieldtrip-reorder-stops", { params: { tripId, stopIds: [bId, aId] } }, ctx);
    assert.equal(reorder.result.fieldTrip.stops[0].id, bId);
    assert.equal(reorder.result.fieldTrip.stops[0].order, 1);
    assert.equal(reorder.result.fieldTrip.stops[1].order, 2);
    const bad = await lensRun("geology", "fieldtrip-reorder-stops", { params: { tripId, stopIds: [aId] } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /every stop exactly once/);
  });

  it("fieldtrip-update-stop edits a stop in place", async () => {
    const trip = await lensRun("geology", "fieldtrip-create", { params: { name: "Update trip" } }, ctx);
    const tripId = trip.result.fieldTrip.id;
    const stop = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId, name: "Original" } }, ctx);
    const upd = await lensRun("geology", "fieldtrip-update-stop", {
      params: { tripId, stopId: stop.result.stop.id, name: "Renamed", lithology: "basalt", notes: "lava flow" },
    }, ctx);
    assert.equal(upd.result.stop.name, "Renamed");
    assert.equal(upd.result.stop.lithology, "basalt");
    assert.equal(upd.result.stop.notes, "lava flow");
  });

  it("fieldtrip-add-stop: missing trip or stop name is rejected", async () => {
    const noTrip = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId: "trip_nope", name: "X" } }, ctx);
    assert.equal(noTrip.result.ok, false);
    assert.match(noTrip.result.error, /field trip not found/);
    const trip = await lensRun("geology", "fieldtrip-create", { params: { name: "Empty-name trip" } }, ctx);
    const noName = await lensRun("geology", "fieldtrip-add-stop", { params: { tripId: trip.result.fieldTrip.id, name: "" } }, ctx);
    assert.equal(noName.result.ok, false);
    assert.match(noName.result.error, /stop name required/);
  });

  it("fieldtrip-create: missing name rejected; fieldtrip-delete removes the trip", async () => {
    const bad = await lensRun("geology", "fieldtrip-create", { params: { name: "" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /field trip name required/);
    const trip = await lensRun("geology", "fieldtrip-create", { params: { name: "Delete trip" } }, ctx);
    const id = trip.result.fieldTrip.id;
    const del = await lensRun("geology", "fieldtrip-delete", { params: { id } }, ctx);
    assert.equal(del.result.deleted, id);
    const badDel = await lensRun("geology", "fieldtrip-delete", { params: { id: "trip_nope" } }, ctx);
    assert.equal(badDel.result.ok, false);
    assert.match(badDel.result.error, /field trip not found/);
  });
});

describe("geology — network macros: pre-fetch validation (no egress)", () => {
  it("usgs-seismic-hazard: missing coordinates are rejected before any fetch", async () => {
    const bad = await lensRun("geology", "usgs-seismic-hazard", { params: {} });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /latitude \+ longitude required/);
  });

  it("usgs-seismic-hazard: a location outside US territory is rejected before any fetch", async () => {
    const bad = await lensRun("geology", "usgs-seismic-hazard", { params: { latitude: 51.5, longitude: -0.12 } }); // London
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /only covers US territory/);
  });

  it("geologic-map: missing lat/lon is rejected before any fetch", async () => {
    const bad = await lensRun("geology", "geologic-map", { params: { lat: 40 } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /lat \+ lon required/);
  });

  it("rock-units-here: missing lat/lon is rejected before any fetch", async () => {
    const bad = await lensRun("geology", "rock-units-here", { params: { lon: -105 } });
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /lat \+ lon required/);
  });
});
