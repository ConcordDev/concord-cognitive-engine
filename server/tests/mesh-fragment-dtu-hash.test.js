// server/tests/mesh-fragment-dtu-hash.test.js
//
// Q25 (B#17): every fragment's mesh header must carry the WHOLE
// DTU's hash — the header field exists for deduplication/grouping.
// Before the fix the headers carried per-chunk hashes: fragments of
// one DTU shared no identity, none matched the DTU's own packet hash,
// and two different DTUs with an identical chunk collided. Pins the
// shared whole-DTU hash, the cross-DTU separation, unchanged
// per-packet integrity fields, and a reassembly round-trip.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createMeshPacket, fragmentDTU, reassembleFragments } from "../lib/concord-mesh.js";

const wholeHash8 = (content) => createHash("sha256").update(content, "utf8").digest("hex").slice(0, 8);

describe("mesh fragment dtuHash (Q25)", () => {
  it("every fragment header carries the whole DTU's hash", () => {
    const content = "alpha-".repeat(900); // fragments at 512 payload bytes
    const frags = fragmentDTU(content, 512);
    assert.ok(frags.length > 3, `expected several fragments, got ${frags.length}`);
    const expected = wholeHash8(content);
    for (const f of frags) {
      assert.equal(f.header.hash, expected, "header identifies the DTU, not the chunk");
    }
    // Per-packet integrity is unchanged: payloadHash/fragmentHash still describe the chunk.
    assert.equal(frags[0].payloadHash, createHash("sha256").update(frags[0].payload, "utf8").digest("hex"));
    assert.equal(frags[0].fragmentHash, frags[0].payloadHash);
    // And the shared header hash equals what the unfragmented packet carries.
    const whole = createMeshPacket(content, null, {});
    assert.equal(whole.header.hash, expected);
  });

  it("two DTUs sharing an identical first chunk no longer collide in the header", () => {
    const shared = "S".repeat(600);
    // maxPayloadBytes 664 − TOTAL_OVERHEAD 64 = a 600-byte chunk, so
    // chunk 0 is exactly the shared prefix for both DTUs.
    const a = fragmentDTU(shared + "A".repeat(2000), 664);
    const b = fragmentDTU(shared + "B".repeat(2000), 664);
    assert.equal(a[0].payload, b[0].payload, "first chunks are byte-identical (the old collision)");
    assert.notEqual(a[0].header.hash, b[0].header.hash, "headers separate the two DTUs");
    assert.equal(a[0].header.hash, wholeHash8(shared + "A".repeat(2000)));
    assert.equal(b[0].header.hash, wholeHash8(shared + "B".repeat(2000)));
  });

  it("an unfragmented packet is unchanged, and fragments reassemble to the original", () => {
    const small = "hello mesh";
    const [only] = fragmentDTU(small, 512);
    assert.equal(only.header.hash, wholeHash8(small));
    assert.equal(only.header.hash, only.payloadHash.slice(0, 8));

    const content = "round-trip-".repeat(400);
    const frags = fragmentDTU(content, 512);
    assert.equal(reassembleFragments(frags), content);
  });
});
