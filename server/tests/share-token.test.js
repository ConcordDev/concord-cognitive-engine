import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { newShareToken, isStrongShareToken } from "../lib/share-token.js";

describe("share tokens", () => {
  it("new tokens are strong, unique and prefixed", () => {
    const a = newShareToken("pl"), b = newShareToken("pl");
    assert.notEqual(a, b);
    assert.ok(isStrongShareToken(a, "pl"));
    assert.equal(a.length, "pl_".length + 24);
  });
  it("legacy timestamp/Math.random tokens and wrong prefixes are refused", () => {
    assert.equal(isStrongShareToken("pl_k3j2h1abc1x2y3", "pl"), false);
    assert.equal(isStrongShareToken("shr_lq3x9k_ab12cd", "shr"), false);
    assert.equal(isStrongShareToken(newShareToken("shr"), "pl"), false);
    assert.equal(isStrongShareToken("", "pl"), false);
  });
});
