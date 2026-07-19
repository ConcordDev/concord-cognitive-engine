// Behavioral tests for the travel document binary-attachment macros
// (travel-doc-attachment-upload / -list / -download / -delete).
//
// Closes docs/WAVE4_INVENTORY.md line 323 / travel-capability-map.md
// item 8: "No binary attachment support on travel documents." These
// macros are a structural clone of server/domains/projects.js's
// "[M] Binary file attachments" pair (attachment-upload /
// attachment-download, ~projects.js:1456-1502) scoped to a travel
// document instead of a project task.
//
// Covers: upload success, oversized rejection, malformed-base64
// rejection, ownership isolation (another user can't download/delete
// your attachment), and a byte-identical upload -> download round trip.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerTravelActions from "../../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  assert.ok(fn, `travel.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function makeDoc(ctx = ctxA, over = {}) {
  return call("travel-doc-add", ctx, {
    title: "Passport", kind: "passport", number: "X1234567", expiryDate: "2030-01-01", ...over,
  }).result.document;
}

const SMALL_B64 = Buffer.from("hello concord traveler", "utf8").toString("base64");

describe("travel.travel-doc-attachment-upload", () => {
  it("uploads successfully against an owned document, strips the data blob from the response", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, {
      docId: doc.id, fileName: "boarding-pass.pdf", mimeType: "application/pdf", data: SMALL_B64,
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachment.docId, doc.id);
    assert.equal(r.result.attachment.kind, "binary");
    assert.equal(r.result.attachment.fileName, "boarding-pass.pdf");
    assert.equal(r.result.attachment.mimeType, "application/pdf");
    assert.ok(Number.isInteger(r.result.attachment.bytes) && r.result.attachment.bytes > 0);
    assert.equal("data" in r.result.attachment, false, "list/upload responses must never carry the raw blob");
  });

  it("accepts a data: URI prefix and strips it before validating", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, {
      docId: doc.id, fileName: "photo.png", mimeType: "image/png",
      data: `data:image/png;base64,${SMALL_B64}`,
    });
    assert.equal(r.ok, true);
    // The handler computes `bytes` as Math.floor(b64.length * 3 / 4) on the
    // payload AFTER stripping the "data:...;base64," prefix (it does not
    // correct for base64 '=' padding, so this is an approximation, not the
    // true decoded length — mirror that exact formula on the bare
    // SMALL_B64 to prove the prefix was actually stripped before the byte
    // math ran). If the prefix had leaked into the calculation the count
    // would come out much larger (floor(55*3/4)=41 vs the correct 24).
    const expectedBytes = Math.floor((SMALL_B64.length * 3) / 4);
    assert.equal(r.result.attachment.bytes, expectedBytes);
    // Round-trip via download to confirm the STORED data has no residual
    // "data:" prefix — proof the stripping happened before persistence,
    // not just before the length calculation.
    const dl = call("travel-doc-attachment-download", ctxA, { id: r.result.attachment.id });
    assert.equal(dl.ok, true);
    assert.equal(dl.result.data.startsWith("data:"), false);
    assert.equal(dl.result.data, SMALL_B64);
    assert.ok(Buffer.from(dl.result.data, "base64").equals(Buffer.from(SMALL_B64, "base64")));
  });

  it("defaults mimeType to application/octet-stream when omitted", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "scan.bin", data: SMALL_B64 });
    assert.equal(r.ok, true);
    assert.equal(r.result.attachment.mimeType, "application/octet-stream");
  });

  it("rejects an unknown / missing docId", () => {
    const r = call("travel-doc-attachment-upload", ctxA, { docId: "nope", fileName: "x.pdf", data: SMALL_B64 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("rejects a docId belonging to a different user (ownership at upload time)", () => {
    const doc = makeDoc(ctxA);
    const r = call("travel-doc-attachment-upload", ctxB, { docId: doc.id, fileName: "x.pdf", data: SMALL_B64 });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("rejects a missing fileName", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, data: SMALL_B64 });
    assert.equal(r.ok, false);
    // Exact text from server/domains/travel.js's travel-doc-attachment-upload handler.
    assert.match(r.error, /^fileName required$/);
  });

  it("rejects missing file data", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "x.pdf" });
    assert.equal(r.ok, false);
    assert.match(r.error, /data/);
  });

  it("rejects malformed base64 (illegal charset) — honest failure, never a silent garbage store", () => {
    const doc = makeDoc();
    const r = call("travel-doc-attachment-upload", ctxA, {
      docId: doc.id, fileName: "evil.pdf", data: "not-valid-base64!!! <<script>>",
    });
    assert.equal(r.ok, false);
    assert.match(r.error, /base64/);
    // Confirm nothing was actually stored.
    assert.equal(call("travel-doc-attachment-list", ctxA, { docId: doc.id }).result.count, 0);
  });

  it("rejects a file over the 5 MB cap", () => {
    const doc = makeDoc();
    // 6 MB of raw bytes, base64-encoded (~8 MB string) — comfortably over the cap.
    const big = Buffer.alloc(6 * 1024 * 1024, 65).toString("base64");
    const r = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "huge.bin", data: big });
    assert.equal(r.ok, false);
    assert.match(r.error, /5 MB/);
    assert.equal(call("travel-doc-attachment-list", ctxA, { docId: doc.id }).result.count, 0);
  });

  it("accepts a file right at the boundary just under the cap", () => {
    const doc = makeDoc();
    // ~4.9 MB of raw bytes — under the 5 MB cap.
    const rawSize = Math.floor(4.9 * 1024 * 1024);
    const okSize = Buffer.alloc(rawSize, 65).toString("base64");
    const r = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "ok.bin", data: okSize });
    assert.equal(r.ok, true);
    // The handler's byte count is derived from the base64 length
    // (Math.floor(b64.length * 3 / 4)), which for a full (unpadded-length)
    // buffer reconstructs the exact original byte count — assert it
    // matches the raw buffer size we actually allocated, not just >0.
    assert.equal(r.result.attachment.bytes, rawSize);
    // Round-trip through the doc-scoped list call to confirm the same
    // exact byte count is what's actually persisted, not just what the
    // upload response happened to echo back.
    const listed = call("travel-doc-attachment-list", ctxA, { docId: doc.id })
      .result.attachments.find((a) => a.id === r.result.attachment.id);
    assert.ok(listed, "uploaded attachment must appear in the doc-scoped list");
    assert.equal(listed.bytes, rawSize);
  });
});

describe("travel.travel-doc-attachment-list + travel-doc-list embedding", () => {
  it("lists attachment metadata for a document, scoped to that doc only", () => {
    const docA = makeDoc(ctxA, { title: "Passport" });
    const docB = makeDoc(ctxA, { title: "Visa" });
    call("travel-doc-attachment-upload", ctxA, { docId: docA.id, fileName: "p1.pdf", data: SMALL_B64 });
    call("travel-doc-attachment-upload", ctxA, { docId: docA.id, fileName: "p2.pdf", data: SMALL_B64 });
    call("travel-doc-attachment-upload", ctxA, { docId: docB.id, fileName: "v1.pdf", data: SMALL_B64 });

    const listA = call("travel-doc-attachment-list", ctxA, { docId: docA.id });
    assert.equal(listA.ok, true);
    assert.equal(listA.result.count, 2);
    assert.deepEqual(listA.result.attachments.map((a) => a.fileName).sort(), ["p1.pdf", "p2.pdf"]);
    assert.ok(listA.result.attachments.every((a) => !("data" in a)));

    const listB = call("travel-doc-attachment-list", ctxA, { docId: docB.id });
    assert.equal(listB.result.count, 1);
  });

  it("rejects listing attachments for an unowned/unknown docId", () => {
    const doc = makeDoc(ctxA);
    // Exact text from travel-doc-attachment-list: the lookup is scoped to
    // the caller's own per-user doc bucket, so a foreign user's docId
    // lookup fails with the identical "not found" reason as a genuinely
    // unknown docId — there's no separate "forbidden" branch.
    const foreign = call("travel-doc-attachment-list", ctxB, { docId: doc.id });
    assert.equal(foreign.ok, false);
    assert.match(foreign.error, /^travel document not found$/);

    const unknown = call("travel-doc-attachment-list", ctxA, { docId: "nope" });
    assert.equal(unknown.ok, false);
    assert.match(unknown.error, /^travel document not found$/);
  });

  it("travel-doc-list embeds attachment metadata + count per document, without the blob", () => {
    const doc = makeDoc(ctxA, { title: "Passport" });
    call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "scan.pdf", mimeType: "application/pdf", data: SMALL_B64 });
    const docs = call("travel-doc-list", ctxA, {}).result.documents;
    const found = docs.find((d) => d.id === doc.id);
    assert.equal(found.attachmentCount, 1);
    assert.equal(found.attachments[0].fileName, "scan.pdf");
    assert.equal("data" in found.attachments[0], false);
  });
});

describe("travel.travel-doc-attachment-download — round trip + ownership isolation", () => {
  it("downloads byte-identical data to what was uploaded", () => {
    const doc = makeDoc();
    const up = call("travel-doc-attachment-upload", ctxA, {
      docId: doc.id, fileName: "itinerary.pdf", mimeType: "application/pdf", data: SMALL_B64,
    });
    const dl = call("travel-doc-attachment-download", ctxA, { id: up.result.attachment.id });
    assert.equal(dl.ok, true);
    assert.equal(dl.result.fileName, "itinerary.pdf");
    assert.equal(dl.result.mimeType, "application/pdf");
    // Byte-identical round trip: decode both sides and compare raw bytes.
    const original = Buffer.from(SMALL_B64, "base64");
    const roundTripped = Buffer.from(dl.result.data, "base64");
    assert.ok(original.equals(roundTripped), "downloaded bytes must exactly match the uploaded bytes");
  });

  it("rejects downloading an unknown attachment id", () => {
    const r = call("travel-doc-attachment-download", ctxA, { id: "nope" });
    assert.equal(r.ok, false);
    // Exact text from travel-doc-attachment-download's lookup-miss branch.
    assert.match(r.error, /^attachment not found$/);
  });

  it("a different user cannot download another user's attachment", () => {
    const doc = makeDoc(ctxA);
    const up = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "secret.pdf", data: SMALL_B64 });
    const r = call("travel-doc-attachment-download", ctxB, { id: up.result.attachment.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /not found/);
  });

  it("a different user cannot delete another user's attachment, owner can", () => {
    const doc = makeDoc(ctxA);
    const up = call("travel-doc-attachment-upload", ctxA, { docId: doc.id, fileName: "secret.pdf", data: SMALL_B64 });
    const attId = up.result.attachment.id;

    const foreignDelete = call("travel-doc-attachment-delete", ctxB, { id: attId });
    assert.equal(foreignDelete.ok, false);
    // Still downloadable by the real owner — the foreign delete attempt was a no-op.
    assert.equal(call("travel-doc-attachment-download", ctxA, { id: attId }).ok, true);

    const ownerDelete = call("travel-doc-attachment-delete", ctxA, { id: attId });
    assert.equal(ownerDelete.ok, true);
    assert.equal(call("travel-doc-attachment-download", ctxA, { id: attId }).ok, false);
    assert.equal(call("travel-doc-attachment-list", ctxA, { docId: doc.id }).result.count, 0);
  });
});
