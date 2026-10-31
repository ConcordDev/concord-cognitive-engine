// server/tests/dtu-bridge-envelope.test.js
//
// Slice 1 (DTU bridge): provenance chain math + the pack envelope.
// Pins: the hash/signature recipes against dtu-integrity's semantics,
// chain verification (valid, tampered, broken link, bad signature),
// the pack round trip (a DTU crosses intact, provenance preserved),
// and the envelope's two refusals — a record that lies about its
// content cannot be packed, and a tampered pack cannot be parsed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";

import {
  canonicalStringify,
  computeContentHash,
  makeProvenance,
  signContentHash,
  verifyChain,
} from "../lib/dtu-bridge/provenance.js";
import { buildPack, parsePack, unpackRecords } from "../lib/dtu-bridge/pack-envelope.js";

const KEY = "test-signing-key";

function dtu(id, content, extra = {}) {
  return { id, tier: "canonical", scope: "public", content, createdAt: "2026-10-28T00:00:00.000Z", ...extra };
}
function record(id, content, parentHash = null, key = null) {
  const payload = dtu(id, content);
  return { table: "dtus", id, payload, provenance: makeProvenance(payload, parentHash, key) };
}
function chainOfThree(key = null) {
  const a = record("dtu-1", "alpha", null, key);
  const b = record("dtu-1", "beta", a.provenance.contentHash, key);
  const c = record("dtu-1", "gamma", b.provenance.contentHash, key);
  return [a, b, c];
}

test("content hash mirrors dtu-integrity: sha256 over JSON of the content field", () => {
  const payload = dtu("x", { hello: "world" });
  const expected = createHash("sha256").update(JSON.stringify({ hello: "world" })).digest("hex");
  assert.equal(computeContentHash(payload), expected);
  const signed = signContentHash(expected, KEY);
  assert.equal(signed, createHmac("sha256", KEY).update(expected).digest("hex"));
});

test("canonical stringify is key-order independent (portability recipe)", () => {
  assert.equal(canonicalStringify({ b: 1, a: { d: 4, c: 3 } }), canonicalStringify({ a: { c: 3, d: 4 }, b: 1 }));
  assert.equal(canonicalStringify({ a: 1 }), '{"a":1}');
});

test("a well-formed chain verifies; roots and segments are handled", () => {
  const chain = chainOfThree();
  const res = verifyChain(chain);
  assert.equal(res.valid, true);
  assert.deepEqual(res.failures, []);
  // A mid-chain segment (root's parent is an external anchor) also verifies.
  const segment = chain.slice(1);
  assert.equal(verifyChain(segment).valid, true);
});

test("a tampered payload fails chain verification as a hash mismatch", () => {
  const chain = chainOfThree();
  chain[1] = { ...chain[1], payload: dtu("dtu-1", "FORGED") };
  const res = verifyChain(chain);
  assert.equal(res.valid, false);
  assert.ok(res.failures.some((f) => f.index === 1 && f.reason === "content_hash_mismatch"));
});

test("a reordered or spliced chain fails as a broken link", () => {
  const chain = chainOfThree();
  const res = verifyChain([chain[0], chain[2], chain[1]]);
  assert.equal(res.valid, false);
  assert.ok(res.failures.some((f) => f.reason === "broken_link"));
});

test("signatures verify under the key and fail when forged", () => {
  const chain = chainOfThree(KEY);
  assert.equal(verifyChain(chain, { key: KEY }).valid, true);
  assert.equal(verifyChain(chain, { key: KEY }).signatureChecked, true);
  const forged = chainOfThree(KEY);
  forged[2] = { ...forged[2], provenance: { ...forged[2].provenance, signature: "0".repeat(64) } };
  const res = verifyChain(forged, { key: KEY });
  assert.equal(res.valid, false);
  assert.ok(res.failures.some((f) => f.reason === "bad_signature"));
});

test("pack round trip: a DTU crosses intact with its provenance preserved", () => {
  const records = chainOfThree(KEY);
  const pack = buildPack({ sourceNode: "node-a", records });
  const wire = JSON.stringify(pack);
  const parsed = parsePack(wire);
  assert.equal(parsed.ok, true);
  assert.deepEqual(unpackRecords(parsed.pack), records);
  assert.equal(verifyChain(unpackRecords(parsed.pack), { key: KEY }).valid, true);
});

test("buildPack refuses a record whose hash lies about its payload", () => {
  const lying = record("dtu-9", "real content");
  lying.payload = dtu("dtu-9", "different content");
  assert.throws(() => buildPack({ records: [lying] }), (e) => e.code === "DTU_BRIDGE_HASH_MISMATCH");
});

test("buildPack refuses a non-substrate table", () => {
  const rec = record("dtu-1", "alpha");
  rec.table = "economy_ledger";
  assert.throws(() => buildPack({ records: [rec] }), (e) => e.code === "DTU_BRIDGE_OUT_OF_SCOPE");
});

test("parsePack refuses a tampered pack whole", () => {
  const pack = buildPack({ sourceNode: "node-a", records: chainOfThree() });
  const tampered = JSON.parse(JSON.stringify(pack));
  tampered.records[0].payload = dtu("dtu-1", "FORGED AFTER PACKING");
  const res = parsePack(tampered);
  assert.equal(res.ok, false);
  assert.equal(parsePack("not json").ok, false);
  assert.equal(parsePack({ spec: "something-else" }).reason, "wrong_spec");
});
