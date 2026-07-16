// tests/depth/lab-label-behavior.test.js — REAL behavioral tests for the
// `lab.label-generate` / `lab.label-list` macros (barcode/2D-barcode label
// printing for reagents + samples — closes docs/WAVE4_INVENTORY.md row 206,
// lab-capability-map.md's "Genuinely missing" item).
//
// These macros generate a deterministic, scanner-parseable barcode PAYLOAD
// STRING + structured label metadata for a REAL stored reagent or construct
// ("sample" — this domain has no separate persistent sample collection; DNA
// /plasmid constructs are the closest analog, per the code comment in
// server/domains/lab.js). No physical-printer/PDF rendering happens
// server-side (out of scope, per the capability map) — the frontend renders
// the payload into a real QR code via the `qrcode` package.
//
// NB (same convention as lab-behavior.test.js): lens.run wraps a handler's
// {ok:false,error} as {ok:true, result:{ok:false,error}} — success
// assertions read r.result.<field>; rejection assertions read
// r.result.ok === false + r.result.error.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("lab — barcode/2D-barcode label printing (label-generate / label-list)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("lab-label-crud"); });

  it("label-generate(reagent): payload encodes the real id + lot, metadata mirrors the stored reagent", async () => {
    const added = await lensRun("lab", "inventory-add", {
      params: { name: "Taq polymerase", lot: "L2024-09", catalogNumber: "M0273", vendor: "NEB", expiry: "2027-01-01", hazard: "none" },
    }, ctx);
    assert.equal(added.ok, true);
    const reagentId = added.result.item.id;

    const label = await lensRun("lab", "label-generate", { params: { recordType: "reagent", id: reagentId } }, ctx);
    assert.equal(label.ok, true);
    assert.equal(label.result.label.recordType, "reagent");
    assert.equal(label.result.label.recordId, reagentId);
    assert.equal(label.result.label.name, "Taq polymerase");
    assert.equal(label.result.label.lot, "L2024-09");
    assert.equal(label.result.label.catalogNumber, "M0273");
    assert.equal(label.result.label.vendor, "NEB");
    assert.equal(label.result.label.expiry, "2027-01-01");
    assert.equal(label.result.label.symbology, "code128");
    // the payload string round-trips to the exact record: type tag, id, lot
    assert.equal(label.result.label.payload, `LAB:REAGENT:${reagentId}:L2024-09`);
    assert.ok(label.result.label.id, "label gets its own generated id");
    assert.ok(label.result.label.generatedAt);

    const list = await lensRun("lab", "label-list", {}, ctx);
    assert.equal(list.ok, true);
    assert.ok(list.result.labels.some((l) => l.recordId === reagentId && l.payload === label.result.label.payload));
  });

  it("label-generate(reagent): a reagent with no lot still gets a valid payload (empty secondary field, not 'undefined')", async () => {
    const added = await lensRun("lab", "inventory-add", { params: { name: "DEPC water" } }, ctx);
    const reagentId = added.result.item.id;
    const label = await lensRun("lab", "label-generate", { params: { recordType: "reagent", id: reagentId } }, ctx);
    assert.equal(label.ok, true);
    assert.equal(label.result.label.payload, `LAB:REAGENT:${reagentId}:`);
    assert.equal(label.result.label.lot, null);
  });

  it("label-generate(sample): payload + metadata come from the registered construct", async () => {
    const registered = await lensRun("lab", "construct-register", {
      params: { name: "pTest-GFP", type: "plasmid", sequence: "ATGCATGCATGCATGC", resistance: "AmpR" },
    }, ctx);
    assert.equal(registered.ok, true);
    const constructId = registered.result.construct.id;

    const label = await lensRun("lab", "label-generate", { params: { recordType: "sample", id: constructId } }, ctx);
    assert.equal(label.ok, true);
    assert.equal(label.result.label.recordType, "sample");
    assert.equal(label.result.label.recordId, constructId);
    assert.equal(label.result.label.name, "pTest-GFP");
    assert.equal(label.result.label.constructType, "plasmid");
    assert.equal(label.result.label.resistance, "AmpR");
    assert.equal(label.result.label.lengthBp, 16);
    assert.equal(label.result.label.gcContent, 50);
    assert.equal(label.result.label.payload, `LAB:SAMPLE:${constructId}:plasmid`);

    const list = await lensRun("lab", "label-list", {}, ctx);
    assert.ok(list.result.labels.some((l) => l.recordId === constructId));
  });

  it("label-generate: a nonexistent reagent id is rejected honestly (no fabricated label)", async () => {
    const r = await lensRun("lab", "label-generate", { params: { recordType: "reagent", id: "rgt_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /reagent not found/);
  });

  it("label-generate: a nonexistent sample id is rejected honestly (no fabricated label)", async () => {
    const r = await lensRun("lab", "label-generate", { params: { recordType: "sample", id: "dna_does_not_exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /sample not found/);
  });

  it("label-generate: an invalid recordType is rejected", async () => {
    const r = await lensRun("lab", "label-generate", { params: { recordType: "widget", id: "anything" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /recordType must be 'reagent' or 'sample'/);
  });

  it("label-generate: a missing id is rejected", async () => {
    const r = await lensRun("lab", "label-generate", { params: { recordType: "reagent" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /record id required/);
  });

  it("label-generate: per-user isolation — one user cannot generate a label for another user's reagent", async () => {
    const ownerCtx = await depthCtx("lab-label-owner");
    const otherCtx = await depthCtx("lab-label-intruder");

    const added = await lensRun("lab", "inventory-add", { params: { name: "Owner-only reagent", lot: "OWN-1" } }, ownerCtx);
    const reagentId = added.result.item.id;

    // The owner can label it.
    const ownLabel = await lensRun("lab", "label-generate", { params: { recordType: "reagent", id: reagentId } }, ownerCtx);
    assert.equal(ownLabel.ok, true);
    assert.equal(ownLabel.result.label.recordId, reagentId);

    // A different user's per-user reagent array doesn't contain it → not found.
    const intruderAttempt = await lensRun("lab", "label-generate", { params: { recordType: "reagent", id: reagentId } }, otherCtx);
    assert.equal(intruderAttempt.result.ok, false);
    assert.match(intruderAttempt.result.error, /reagent not found/);

    // label-list is also per-user scoped: the intruder's list is empty of the owner's label.
    const intruderList = await lensRun("lab", "label-list", {}, otherCtx);
    assert.ok(!intruderList.result.labels.some((l) => l.recordId === reagentId));
  });
});
