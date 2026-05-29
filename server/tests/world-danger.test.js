/**
 * WS6 — world-danger tell mapping.
 * Run: node --test tests/world-danger.test.js
 */
import { describe, it } from "node:test";
import assert from "node:assert";
import { dangerLabel, DANGER_TELLS } from "../lib/world-danger.js";

describe("dangerLabel", () => {
  it("maps level delta to escalating tells", () => {
    assert.equal(dangerLabel(-50).label, "trivial");
    assert.equal(dangerLabel(-5).label, "easy");
    assert.equal(dangerLabel(0).label, "even");
    assert.equal(dangerLabel(5).label, "tough");
    assert.equal(dangerLabel(12).label, "dangerous");
    assert.equal(dangerLabel(40).label, "deadly");
  });
  it("severity is monotonic and bounded 0..5", () => {
    let prev = -1;
    for (const d of [-50, -5, 0, 5, 12, 40]) {
      const s = dangerLabel(d).severity;
      assert.ok(s >= prev);
      assert.ok(s >= 0 && s <= 5);
      prev = s;
    }
    assert.equal(DANGER_TELLS.length, 6);
  });
});
