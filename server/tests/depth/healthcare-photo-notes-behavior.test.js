// tests/depth/healthcare-photo-notes-behavior.test.js — REAL behavioral
// tests for docs/WAVE4_INVENTORY.md line 188 / healthcare-capability-map.md's
// "vision (photo→LLaVA analysis) has no image-upload UI anywhere" gap-close:
// the `photo-notes-*` family (server/domains/healthcare.js) turns the
// existing real `vision` macro's LLaVA/Qwen2.5-VL call into a durable,
// per-patient chart entry instead of a one-off analysis.
//
// Honesty contract under test (CLAUDE.md "honest by construction"): a
// `photo-notes-add` call that can't reach a real vision brain must surface
// as `{ ok:false, error }` and MUST NOT write a chart entry claiming an
// analysis happened. This sandbox has no Ollama instance reachable
// (verified: `curl http://localhost:11434/api/tags` refuses/times out, and
// none of the `BRAIN_*_URL` env vars point anywhere reachable here), so the
// failure-path test below exercises the REAL `callVision()` codepath
// against a genuinely-down brain — it is not mocked. The CRUD/scoping test
// seeds fixture rows directly into the same `STATE.healthLens.photoNotes`
// bucket `photo-notes-add` writes to on a real success, to isolate the
// list/delete/per-patient-scoping plumbing from the live-brain dependency
// (which the honest-failure test already covers) — it never claims a
// vision analysis ran.
//
// Wrapping note (server.js:37452-37458, restated from
// tests/depth/healthcare-behavior.test.js): the lens.run dispatcher
// UNWRAPS a handler's `{ ok, result }` — a handler success surfaces as
// `r.result.<field>` directly, while a handler refusal `{ ok:false, error }`
// (no `result` key) surfaces verbatim as `r.result.ok === false` +
// `r.result.error`.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx, load } from "./_harness.js";

describe("healthcare — photo notes (photo-notes-add/list/delete)", () => {
  let ctx, STATE, patientA, patientB;

  before(async () => {
    ctx = await depthCtx("healthcare-photo-notes");
    ({ STATE } = await load());
    const pa = await lensRun("healthcare", "patients-create", { params: { firstName: "Grace", lastName: "Hopper", dob: "1906-12-09", sex: "F" } }, ctx);
    patientA = pa.result.patient.id;
    assert.ok(patientA, "patient A id minted");
    const pb = await lensRun("healthcare", "patients-create", { params: { firstName: "Alan", lastName: "Turing", dob: "1912-06-23", sex: "M" } }, ctx);
    patientB = pb.result.patient.id;
    assert.ok(patientB, "patient B id minted");
  });

  it("photo-notes-add: rejects when patientId is missing", async () => {
    const r = await lensRun("healthcare", "photo-notes-add", { params: { imageB64: "abc" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /patientId required/);
  });

  it("photo-notes-add: rejects when no image field is supplied", async () => {
    const r = await lensRun("healthcare", "photo-notes-add", { params: { patientId: patientA } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /imageDataUrl, imageB64, or imageUrl required/);
  });

  it("photo-notes-add: rejects a malformed imageDataUrl (not a real data: URL)", async () => {
    const r = await lensRun("healthcare", "photo-notes-add", { params: { patientId: patientA, imageDataUrl: "not-a-data-url" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid image data: URL/);
  });

  it("photo-notes-add: rejects a non-image data: URL", async () => {
    const r = await lensRun("healthcare", "photo-notes-add", { params: { patientId: patientA, imageDataUrl: "data:text/plain;base64,aGVsbG8=" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /valid image data: URL/);
  });

  it("photo-notes-add: honest failure when the vision brain is unavailable — real callVision() call, no fabricated success, nothing persisted", async () => {
    const beforeList = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientA } }, ctx);
    assert.equal(beforeList.result.photoNotes.length, 0);

    // A genuine (tiny, valid) 1x1 PNG — real image bytes, not a placeholder string.
    const tinyPngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const r = await lensRun("healthcare", "photo-notes-add", {
      params: { patientId: patientA, imageB64: tinyPngB64, bodyRegion: "left forearm", note: "new rash, 3 days" },
    }, ctx);

    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "vision analysis failed");
    assert.ok(r.result.detail, "carries the real connection-failure reason from callVision(), not a placeholder");
    assert.equal(r.result.source, "ollama_llava");

    // Honest-by-construction: the failed call must not fabricate a chart entry.
    const afterList = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientA } }, ctx);
    assert.equal(afterList.result.photoNotes.length, 0);
  });

  it("photo-notes-delete: honest not-found on an unknown id", async () => {
    const r = await lensRun("healthcare", "photo-notes-delete", { params: { id: "does-not-exist" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "photo note not found");
  });

  it("photo-notes-list: requires patientId", async () => {
    const r = await lensRun("healthcare", "photo-notes-list", { params: {} }, ctx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /patientId required/);
  });

  it("photo-notes list/delete round-trip + per-patient scoping (fixture-seeded, isolating CRUD plumbing from the live-brain dependency already covered above)", async () => {
    // Prime STATE.healthLens (any macro call lazily creates it), then seed
    // two photo notes directly in the SAME shape photo-notes-add persists
    // on a real vision success. This is fixture setup for the CRUD/scoping
    // plumbing — it is not a claim that a vision analysis ran.
    await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientA } }, ctx);
    const userId = ctx.actor.userId;
    const bucket = STATE.healthLens.photoNotes;
    if (!bucket.has(userId)) bucket.set(userId, []);
    const noteA = {
      id: "photo_fixture_a", number: "PH-90001", patientId: patientA,
      imageRef: "data:image/png;base64,xx", bodyRegion: "forearm", note: "seed A",
      analysisResult: "seeded analysis for patient A", analysisSource: "ollama_llava",
      analysisModel: "test-model", capturedAt: new Date(Date.now() - 1000).toISOString(),
    };
    const noteB = {
      id: "photo_fixture_b", number: "PH-90002", patientId: patientB,
      imageRef: "data:image/png;base64,yy", bodyRegion: "shin", note: "seed B",
      analysisResult: "seeded analysis for patient B", analysisSource: "ollama_llava",
      analysisModel: "test-model", capturedAt: new Date().toISOString(),
    };
    bucket.get(userId).push(noteA, noteB);

    const listA = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientA } }, ctx);
    assert.equal(listA.result.photoNotes.length, 1);
    assert.equal(listA.result.photoNotes[0].id, "photo_fixture_a");
    assert.equal(listA.result.photoNotes[0].analysisResult, "seeded analysis for patient A");

    const listB = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientB } }, ctx);
    assert.equal(listB.result.photoNotes.length, 1);
    assert.equal(listB.result.photoNotes[0].id, "photo_fixture_b");

    const del = await lensRun("healthcare", "photo-notes-delete", { params: { id: "photo_fixture_a" } }, ctx);
    assert.equal(del.result.deleted, true);

    const afterA = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientA } }, ctx);
    assert.equal(afterA.result.photoNotes.length, 0);
    // Deleting patient A's note must not touch patient B's.
    const afterB = await lensRun("healthcare", "photo-notes-list", { params: { patientId: patientB } }, ctx);
    assert.equal(afterB.result.photoNotes.length, 1);
  });
});
