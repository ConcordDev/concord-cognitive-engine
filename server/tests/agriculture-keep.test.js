// tests/agriculture-keep.test.js — REAL end-to-end proof for the Agriculture
// lens keep-and-draft workflow. Mirrors the established pattern:
// create a real field via `field-create`, read it back via `field-list`,
// save it as a private DTU via `dtu.create`, read that DTU back via
// `dtu.get`, then draft it in Thread via `thread.thread-draft` citing
// that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("agriculture keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("agriculture-keep-proof"); });

  it("creates a real field, reads it back, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Create a real field via the agriculture domain field-create macro.
    const fieldR = await lensRun("agriculture", "field-create", {
      params: {
        name: "Proof Field",
        acreage: 40,
        lat: 40.0,
        lng: -100.0,
        soilType: "loam",
        currentCrop: "corn",
      },
    }, ctx);
    assert.equal(fieldR.ok, true, "field-create should succeed");
    const field = fieldR.result.field;
    assert.ok(field.id, "field should have an id");
    assert.equal(field.name, "Proof Field");
    assert.equal(field.acreage, 40);
    assert.equal(field.lat, 40.0);
    assert.equal(field.lng, -100.0);
    assert.equal(field.soilType, "loam");
    assert.equal(field.currentCrop, "corn");

    // 2. Read the real field back via field-list (the same macro the UI uses).
    const listR = await lensRun("agriculture", "field-list", {}, ctx);
    assert.equal(listR.ok, true, "field-list should succeed");
    const fields = listR.result.fields || [];
    const found = fields.find((f) => f.id === field.id);
    assert.ok(found, "field-list should include the created field");

    // 3. Save the field as a private DTU.
    const sentence = "Proof Field: 40ac, corn, loam @ 40.0000, -100.0000.";
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["agriculture", "field"],
        source: "agriculture-lens:field-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "agriculture_field_report",
          fieldId: field.id,
          name: field.name,
          acreage: field.acreage,
          lat: field.lat,
          lng: field.lng,
          soilType: field.soilType,
          currentCrop: field.currentCrop,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "agriculture" },
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
        title: "Agriculture field — Proof Field",
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

  it("refuses to create a field with no name", async () => {
    const r = await lensRun("agriculture", "field-create", { params: { name: "", acreage: 10, lat: 40, lng: -100 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/name/i.test(r.result.error), "should reject missing name");
  });

  it("refuses to create a field with non-positive acreage", async () => {
    const r = await lensRun("agriculture", "field-create", { params: { name: "Bad", acreage: 0, lat: 40, lng: -100 } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/acreage/i.test(r.result.error), "should reject non-positive acreage");
  });
});