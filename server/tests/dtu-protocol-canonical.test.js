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
