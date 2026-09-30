
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compute } from "../../lib/sample.js";
describe("sample", () => {
  it("computes", () => { assert.equal(compute(2), 3); });
});
