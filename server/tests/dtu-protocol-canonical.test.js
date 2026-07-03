// Phase C contract test — dtu-protocol canonical hash
// Pins:
//   - canonicalStringify is deterministic regardless of key order
//   - computeContentHash is deterministic for equal content
//   - validate() catches missing-required-field violations
//   - protocol.createComponent() round-trips through validate() with no errors

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DTUProtocol,
  canonicalStringify,
  computeContentHash,
} from "../lib/dtu-protocol.js";

test("canonicalStringify is order-independent", () => {
  const a = canonicalStringify({ b: 1, a: 2, c: 3 });
  const b = canonicalStringify({ a: 2, c: 3, b: 1 });
  assert.strictEqual(a, b, "key order must not affect canonical string");
});

test("computeContentHash is deterministic for equal content", () => {
  const content = { name: "Beam-A", material: "steel", grade: "S355" };
  const h1 = computeContentHash(content);
  const h2 = computeContentHash({ grade: "S355", name: "Beam-A", material: "steel" });
  assert.strictEqual(h1, h2, "hash must equal regardless of key order");
  assert.match(h1, /^[a-f0-9]{64}$/, "hash must be 64-char hex (SHA-256)");
});

test("computeContentHash differs on content change", () => {
  const a = computeContentHash({ name: "Beam-A" });
  const b = computeContentHash({ name: "Beam-B" });
  assert.notStrictEqual(a, b, "different content must produce different hash");
});

test("validate flags missing envelope fields", () => {
  const p = new DTUProtocol();
  const r = p.validate({ id: "x" });
  assert.strictEqual(r.valid, false);
  assert.ok(Array.isArray(r.errors) && r.errors.length > 0, "errors[] required on invalid");
});

test("createComponent round-trips through validate", () => {
  const p = new DTUProtocol();
  const dtu = p.createComponent({
    name: "Test Beam",
    componentType: "beam",
    material: "steel",
    creator: { id: "user-test", name: "Test Author" },
  });
  const r = p.validate(dtu);
  assert.strictEqual(r.valid, true, `expected valid, got errors: ${JSON.stringify(r.errors || [])}`);
  assert.match(dtu.id, /^dtu_/);
  assert.ok(dtu.metadata?.contentHash, "contentHash must be present after create");
});

// ──────────────────────────────────────────────────────────────────────────
// S5 / P-A — provenance (C2PA-style) additions
//   - stampProvenance is deterministic on equal content + input
//   - a DTU WITHOUT provenance still validates + verifies exactly as before
//   - tamper detection: editing content after stamping flags the provenance check
//   - shape validation: missing/malformed contentSha256 fails validate()
// ──────────────────────────────────────────────────────────────────────────

test("stampProvenance is deterministic for equal content + input", () => {
  const p = new DTUProtocol();
  const provInput = {
    sourceUrl: "https://catalog.data.gov/api/3/action/package_show?id=abc",
    sourceId: "abc",
    fetchedAt: "2026-07-02T00:00:00.000Z", // pin fetchedAt so the assertion is on the hash, not the clock
    signer: null,
  };
  // Two independently created ingest DTUs with byte-identical content.
  const makeStamped = () => {
    const dtu = p.createIngest({
      name: "Record X",
      ingestKind: "open-data",
      source: { url: provInput.sourceUrl, id: "abc" },
      record: { id: "abc", title: "Record X", value: 42 },
      creator: { id: "u1", name: "Ingestor" },
    });
    return p.stampProvenance(dtu, provInput);
  };
  const a = makeStamped();
  const b = makeStamped();
  assert.strictEqual(
    a.metadata.provenance.contentSha256,
    b.metadata.provenance.contentSha256,
    "same content must yield same provenance contentSha256",
  );
  // The provenance hash must equal the canonical content hash of the DTU's own content.
  assert.strictEqual(
    a.metadata.provenance.contentSha256,
    computeContentHash(a.content),
    "provenance contentSha256 must be the canonical hash of dtu.content",
  );
  assert.match(a.metadata.provenance.contentSha256, /^[a-f0-9]{64}$/);
});

test("backward-compat: a DTU WITHOUT provenance still validates + verifies unchanged", () => {
  const p = new DTUProtocol();
  const dtu = p.createComponent({
    name: "No-Prov Beam",
    creator: { id: "u2", name: "Author" },
  });
  // No provenance stamped.
  assert.strictEqual(dtu.metadata.provenance, undefined, "no provenance should be present");

  const v = p.validate(dtu);
  assert.strictEqual(v.valid, true, `expected valid: ${JSON.stringify(v.errors || [])}`);

  const ver = p.verify(dtu);
  assert.strictEqual(ver.verified, true, "unstamped DTU must verify");
  // Return shape must be exactly the legacy shape — no `provenance` key.
  assert.strictEqual("provenance" in ver, false, "verify() on a no-provenance DTU must not add a provenance key");
  assert.strictEqual(ver.expected, ver.actual, "hashes must match");
});

test("stamped DTU validates + verifies clean when content is untouched", () => {
  const p = new DTUProtocol();
  const dtu = p.stampProvenance(
    p.createIngest({ name: "Clean", record: { a: 1 }, creator: { id: "u3", name: "A" } }),
    { sourceUrl: "https://8.8.8.8/x", sourceId: "clean-1" },
  );
  const v = p.validate(dtu);
  assert.strictEqual(v.valid, true, `expected valid: ${JSON.stringify(v.errors || [])}`);
  const ver = p.verify(dtu);
  assert.strictEqual(ver.verified, true, "clean stamped DTU must verify");
  assert.ok(ver.provenance, "provenance sub-report must be present");
  assert.strictEqual(ver.provenance.match, true, "provenance hash must match");
  assert.strictEqual(ver.provenance.checks.metadataContentHash, true);
  assert.strictEqual(ver.provenance.checks.provenanceContentHash, true);
});

test("tamper detection: mutating content after stamping flags the provenance check", () => {
  const p = new DTUProtocol();
  const dtu = p.stampProvenance(
    p.createIngest({ name: "Tamper", record: { amount: 100 }, creator: { id: "u4", name: "A" } }),
    { sourceUrl: "https://8.8.8.8/y", sourceId: "tamper-1" },
  );
  // Baseline: clean.
  assert.strictEqual(p.verify(dtu).verified, true);

  // Mutate content AFTER stamping — the provenance contentSha256 (and the
  // metadata.contentHash) now describe stale content.
  dtu.content.record.amount = 999999;

  const ver = p.verify(dtu);
  assert.strictEqual(ver.verified, false, "tampered DTU must not verify overall");
  assert.ok(ver.provenance, "provenance sub-report must be present");
  assert.strictEqual(ver.provenance.match, false, "provenance sub-check must flag the mismatch");
  assert.strictEqual(ver.provenance.checks.provenanceContentHash, false, "provenance content-hash check must fail");
  assert.notStrictEqual(ver.provenance.expected, ver.actual, "stamped hash must differ from live content hash");
});

test("shape validation: provenance missing contentSha256 fails validate()", () => {
  const p = new DTUProtocol();
  const dtu = p.createIngest({ name: "BadShape", record: { a: 1 }, creator: { id: "u5", name: "A" } });
  dtu.metadata.provenance = {
    sourceUrl: "https://8.8.8.8/z",
    sourceId: "z",
    // contentSha256 intentionally omitted
    timecode: null,
    fetchedAt: new Date().toISOString(),
    signer: null,
  };
  const v = p.validate(dtu);
  assert.strictEqual(v.valid, false, "missing contentSha256 must fail validation");
  assert.ok(
    v.errors.some((e) => /contentSha256/.test(e)),
    `expected a contentSha256 error, got: ${JSON.stringify(v.errors)}`,
  );
});

test("shape validation: malformed (non-64-hex) contentSha256 fails validate()", () => {
  const p = new DTUProtocol();
  const dtu = p.createIngest({ name: "BadHash", record: { a: 1 }, creator: { id: "u6", name: "A" } });
  dtu.metadata.provenance = {
    sourceUrl: null,
    sourceId: null,
    contentSha256: "not-a-real-hash", // wrong length + non-hex chars
    timecode: null,
    fetchedAt: new Date().toISOString(),
    signer: null,
  };
  const v = p.validate(dtu);
  assert.strictEqual(v.valid, false, "malformed contentSha256 must fail validation");
  assert.ok(
    v.errors.some((e) => /contentSha256/.test(e)),
    `expected a contentSha256 error, got: ${JSON.stringify(v.errors)}`,
  );

  // Also: a non-string provenance field (e.g. numeric sourceUrl) must be caught.
  const dtu2 = p.stampProvenance(
    p.createIngest({ name: "BadField", record: { a: 1 }, creator: { id: "u7", name: "A" } }),
    { sourceUrl: "https://8.8.8.8/q", sourceId: "q" },
  );
  dtu2.metadata.provenance.sourceUrl = 12345; // not a string-or-null
  const v2 = p.validate(dtu2);
  assert.strictEqual(v2.valid, false, "non-string provenance field must fail validation");
  assert.ok(v2.errors.some((e) => /sourceUrl/.test(e)), `expected a sourceUrl error, got: ${JSON.stringify(v2.errors)}`);
});
