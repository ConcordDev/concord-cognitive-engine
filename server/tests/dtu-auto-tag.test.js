import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dtuSkipsAutoTag } from "../lib/dtu-auto-tag.js";

describe("dtuSkipsAutoTag", () => {
  it("skips when the author set the flag on the DTU or its meta", () => {
    assert.equal(dtuSkipsAutoTag({ skipAutoTag: true, tags: ["whiteboard"] }), true);
    assert.equal(dtuSkipsAutoTag({ _skipAutoTag: true }), true);
    assert.equal(dtuSkipsAutoTag({ meta: { skipAutoTag: true } }), true);
    assert.equal(dtuSkipsAutoTag({ meta: { _skipAutoTag: true } }), true);
  });

  it("does not skip an ordinary DTU", () => {
    assert.equal(dtuSkipsAutoTag({ tags: ["whiteboard"], meta: { visibility: "private" } }), false);
    assert.equal(dtuSkipsAutoTag({ skipAutoTag: false }), false);
    assert.equal(dtuSkipsAutoTag(null), true);
  });
});
