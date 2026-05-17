/**
 * Tier-2 contract test for crypto-live REAL_FREE wires
 * (Phase 4 seventh wave — CryptoCompare basic).
 *
 * Pins:
 *   - registers crypto.live_top + crypto.live_price
 *   - each has a note
 *   - input validation (tsym/fsyms regex)
 *
 * Live external fetches not exercised.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import registerCryptoLiveMacros from "../domains/crypto-live.js";

function makeRegistry() {
  const map = new Map();
  const register = (domain, name, handler, meta) => {
    map.set(`${domain}.${name}`, { handler, meta });
  };
  return { register, map };
}

describe("crypto-live registration", () => {
  it("registers crypto.live_top + crypto.live_price with notes", () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    assert.ok(r.map.has("crypto.live_top"));
    assert.ok(r.map.has("crypto.live_price"));
    assert.ok(r.map.get("crypto.live_top").meta?.note);
    assert.ok(r.map.get("crypto.live_price").meta?.note);
  });
});

describe("live_top validation", () => {
  it("rejects invalid tsym", async () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    const res = await r.map.get("crypto.live_top").handler({}, { tsym: "not-a-symbol" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_tsym");
  });

  it("permits default tsym=USD", () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    // Callable without throwing.
    const result = r.map.get("crypto.live_top").handler({}, {});
    assert.ok(typeof result.then === "function");
  });
});

describe("live_price validation", () => {
  it("rejects invalid fsyms (lowercase / special chars)", async () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    const res = await r.map.get("crypto.live_price").handler({}, { fsyms: "btc,eth!" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_fsyms");
  });

  it("rejects invalid tsyms", async () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    const res = await r.map.get("crypto.live_price").handler({}, { fsyms: "BTC", tsyms: "DOLLAR" });
    assert.equal(res.ok, false);
    assert.equal(res.reason, "invalid_tsyms");
  });

  it("permits canonical fsyms/tsyms", () => {
    const r = makeRegistry();
    registerCryptoLiveMacros(r.register);
    const result = r.map.get("crypto.live_price").handler({}, { fsyms: "BTC,ETH", tsyms: "USD,EUR" });
    assert.ok(typeof result.then === "function");
  });
});
