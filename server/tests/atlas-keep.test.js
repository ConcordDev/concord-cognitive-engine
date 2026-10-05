// tests/atlas-keep.test.js — REAL end-to-end proof for the Atlas lens
// keep-and-draft workflow. Mirrors the established pattern:
// save a real place via `places-save`, read it back via `places-list`,
// save it as a private DTU via `dtu.create`, read that DTU back via
// `dtu.get`, then draft it in Thread via `thread.thread-draft` citing
// that exact DTU id.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("atlas keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("atlas-keep-proof"); });

  it("saves a real place, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Save a real place via places-save.
    const placeR = await lensRun("atlas", "places-save", {
      params: { name: "Proof Tower", lat: 48.8584, lng: 2.2945, category: "attraction", address: "Paris", notes: "iconic" },
    }, ctx);
    assert.equal(placeR.ok, true, "places-save should succeed");
    const place = placeR.result.place;
    assert.ok(place.id, "place should have an id");
    assert.ok(place.number, "place should have a number");
    assert.equal(place.name, "Proof Tower");
    assert.equal(place.lat, 48.8584);
    assert.equal(place.lng, 2.2945);
    assert.equal(place.category, "attraction");

    // 2. Read the real place back via places-list.
    const listR = await lensRun("atlas", "places-list", {}, ctx);
    assert.equal(listR.ok, true, "places-list should succeed");
    const places = listR.result.places || [];
    const found = places.find((p) => p.id === place.id);
    assert.ok(found, "places-list should include the created place");

    // 3. Save the place as a private DTU.
    const sentence = "Proof Tower (attraction) @ 48.8584, 2.2945.";
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["atlas", "place"],
        source: "atlas-lens:place-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "atlas_place_report",
          placeId: place.id,
          number: place.number,
          name: place.name,
          lat: place.lat,
          lng: place.lng,
          category: place.category,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "atlas" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Atlas place — Proof Tower",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to save a place with no name", async () => {
    const r = await lensRun("atlas", "places-save", { params: { name: "", lat: 40, lng: -100 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/name/i.test(r.result.error), "should reject missing name");
  });
});