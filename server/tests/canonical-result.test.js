// Canonicaliser pins for Cohesive R-1 (server/lib/canonical-result.js).
//
// The mutation protocol runs in both directions:
//   - sensitivity: a perturbed CONTENT field must compare UNEQUAL —
//     the comparison can fail, or it proves nothing;
//   - specificity: a perturbed VOLATILE field (id, timestamps, version)
//     must compare EQUAL — the normaliser strips exactly the declared
//     set, no more. Content-derived fields (a DTU's hash) and
//     actor-stamping fields are NOT volatile: perturbing them must
//     also compare unequal.
//
// Pure module: no server boot, no fixtures on disk.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { VOLATILE_KEYS, canonicalize, canonicalEqual, canonicalDiff } from "../lib/canonical-result.js";

const dtu = (overrides = {}) => ({
  id: "dtu_aaa",
  title: "Equivalence fixture",
  content: "the same logical action",
  hash: "0123456789abcdef",
  ownerId: "user_1",
  tags: ["code", "equivalence"],
  createdAt: "2026-11-03T00:00:00.000Z",
  updatedAt: "2026-11-03T00:00:00.000Z",
  _version: 1,
  machine: { kind: "fixture", nested: { createdAt: "2026-11-03T00:00:00.000Z", value: 7 } },
  ...overrides,
});

describe("canonicalize", () => {
  it("is key-order independent at every depth", () => {
    const a = { b: 1, a: { d: 4, c: 3 } };
    const b = { a: { c: 3, d: 4 }, b: 1 };
    assert.equal(canonicalize(a), canonicalize(b));
  });
  it("keeps array order — order is content", () => {
    assert.notEqual(canonicalize({ t: ["a", "b"] }), canonicalize({ t: ["b", "a"] }));
  });
  it("drops undefined and volatile keys at every depth", () => {
    const out = JSON.parse(canonicalize(dtu({ extra: undefined })));
    assert.equal("id" in out, false);
    assert.equal("createdAt" in out, false);
    assert.equal("createdAt" in out.machine.nested, false);
    assert.equal("extra" in out, false);
    assert.equal(out.machine.nested.value, 7);
  });
});

describe("equivalence and the mutation protocol", () => {
  it("two executions of the same action compare equal", () => {
    const secondRun = dtu({
      id: "dtu_bbb",
      createdAt: "2026-11-03T01:00:00.000Z",
      updatedAt: "2026-11-03T01:00:00.000Z",
      _version: 3,
      machine: { kind: "fixture", nested: { createdAt: "2026-11-03T01:00:00.000Z", value: 7 } },
    });
    assert.equal(canonicalEqual(dtu(), secondRun), true);
    assert.deepEqual(canonicalDiff(dtu(), secondRun), []);
  });
  it("SENSITIVITY — a perturbed content field compares unequal, and the diff names the path", () => {
    const perturbed = dtu({ content: "a different logical action" });
    assert.equal(canonicalEqual(dtu(), perturbed), false);
    assert.deepEqual(canonicalDiff(dtu(), perturbed), ["content"]);
  });
  it("SENSITIVITY — a perturbed nested field names its full path", () => {
    const perturbed = dtu();
    perturbed.machine = { kind: "fixture", nested: { createdAt: perturbed.machine.nested.createdAt, value: 8 } };
    assert.equal(canonicalEqual(dtu(), perturbed), false);
    assert.deepEqual(canonicalDiff(dtu(), perturbed), ["machine.nested.value"]);
  });
  it("SPECIFICITY — the content-derived hash is not volatile", () => {
    assert.equal(canonicalEqual(dtu(), dtu({ hash: "fedcba9876543210" })), false);
    assert.deepEqual(canonicalDiff(dtu(), dtu({ hash: "fedcba9876543210" })), ["hash"]);
  });
  it("SPECIFICITY — actor stamping is not volatile", () => {
    assert.equal(canonicalEqual(dtu(), dtu({ ownerId: "user_2" })), false);
  });
  it("a field present on one side only is reported at its path", () => {
    const extra = dtu({ warnings: ["route-only field"] });
    assert.deepEqual(canonicalDiff(dtu(), extra), ["warnings"]);
  });
  it("the declared volatile set is the exported data a reviewer reads", () => {
    for (const key of ["id", "createdAt", "updatedAt", "_version"]) {
      assert.ok(VOLATILE_KEYS.includes(key), `${key} must be declared volatile`);
    }
    for (const key of ["hash", "ownerId", "title", "content", "tags"]) {
      assert.ok(!VOLATILE_KEYS.includes(key), `${key} must NOT be volatile`);
    }
  });
});
