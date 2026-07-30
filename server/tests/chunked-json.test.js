// server/tests/chunked-json.test.js
//
// Pins stringifyChunked's BYTE-IDENTITY with JSON.stringify (2026-07-28).
//
// This is a durability property, not a nicety: the output is what gets written
// to `state_snapshots` and read back at boot. If chunked output diverges from
// atomic output in ANY way — key order, escaping, dropped keys, number
// formatting — the server silently persists a subtly different snapshot on the
// debounced path than on the shutdown path, and the difference would only
// surface as corrupted state after a restart.
//
// Context: the chunked path exists because a single JSON.stringify of the
// ~19MB snapshot blocks the event loop for up to 934ms under load, tripping
// request-admission's 300ms shed bar and 503-ing live requests. Chunking does
// not reduce total work; it caps the longest uninterrupted block.
//
// Run: node --test server/tests/chunked-json.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stringifyChunked } from "../lib/chunked-json.js";

// Deterministic synchronous scheduler so tests don't wait on real setImmediate
// ticks. The yield MECHANISM is asserted separately below.
const now = (fn) => fn();

describe("stringifyChunked — byte-identical to JSON.stringify", () => {
  const cases = {
    "empty object": {},
    "flat primitives": { a: 1, b: "two", c: true, d: null },
    "nested objects": { outer: { inner: { deep: [1, 2, { x: "y" }] } } },
    "arrays of objects": { rows: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    "empty collections": { arr: [], obj: {}, s: "" },
    "unicode + escaping": { s: 'quote " backslash \\ newline \n tab \t emoji 🌍 ünïcø∂e' },
    "keys needing escapes": { 'has "quotes"': 1, "has\\backslash": 2, "has\nnewline": 3 },
    "numbers": { zero: 0, neg: -1, float: 1.5, exp: 1e21, small: 5e-7, max: Number.MAX_SAFE_INTEGER },
    "colon/comma in values": { a: "a:b,c", b: "}{][" },
    "nested nulls": { a: null, b: [null, null], c: { d: null } },
  };

  for (const [label, obj] of Object.entries(cases)) {
    it(label, async () => {
      assert.equal(await stringifyChunked(obj, now), JSON.stringify(obj));
    });
  }

  it("drops keys that serialize to undefined, exactly as JSON.stringify does", async () => {
    // The subtle one. `JSON.stringify({a:1,b:undefined,c:2})` yields
    // '{"a":1,"c":2}'. Emitting `"b":undefined` would be invalid JSON and the
    // snapshot would fail to parse at boot.
    const obj = { a: 1, b: undefined, fn: () => {}, sym: Symbol("s"), c: 2 };
    const out = await stringifyChunked(obj, now);
    assert.equal(out, JSON.stringify(obj));
    assert.equal(out, '{"a":1,"c":2}');
    JSON.parse(out); // must be parseable
  });

  it("preserves key insertion order", async () => {
    const obj = { z: 1, a: 2, m: 3, b: 4 };
    assert.equal(await stringifyChunked(obj, now), JSON.stringify(obj));
    assert.equal(await stringifyChunked(obj, now), '{"z":1,"a":2,"m":3,"b":4}');
  });

  it("honours toJSON on nested values", async () => {
    const obj = { when: new Date("2026-07-28T12:00:00.000Z"), n: 1 };
    assert.equal(await stringifyChunked(obj, now), JSON.stringify(obj));
  });

  it("round-trips a snapshot-shaped object through JSON.parse", async () => {
    const snapshot = {
      version: "4.0.0", savedAt: "2026-07-28T00:00:00.000Z",
      lensArtifacts: [{ id: "a1", domain: "code", data: { body: "x".repeat(500) } }],
      dtus: [{ id: "d1", human: "summary" }],
      queues: { pending: [] }, logs: [],
    };
    const out = await stringifyChunked(snapshot, now);
    assert.equal(out, JSON.stringify(snapshot));
    assert.deepEqual(JSON.parse(out), snapshot);
  });
});

describe("stringifyChunked — non-object inputs fall back safely", () => {
  for (const v of [null, 42, "str", true, [1, 2, 3]]) {
    it(`${JSON.stringify(v)} matches JSON.stringify`, async () => {
      assert.equal(await stringifyChunked(v, now), JSON.stringify(v));
    });
  }
});

describe("stringifyChunked — actually yields between keys", () => {
  it("invokes the scheduler once per emitted key", async () => {
    // The whole point is the yield; a version that produced correct output
    // without yielding would pass every test above and fix nothing.
    let yields = 0;
    const counting = (fn) => { yields++; fn(); };
    await stringifyChunked({ a: 1, b: 2, c: 3 }, counting);
    assert.equal(yields, 3);
  });

  it("does not yield for keys it drops", async () => {
    let yields = 0;
    const counting = (fn) => { yields++; fn(); };
    await stringifyChunked({ a: 1, skipped: undefined, b: 2 }, counting);
    assert.equal(yields, 2, "dropped keys must not cost a tick");
  });

  it("defaults to setImmediate — the check phase, not a microtask", async () => {
    // `await` on a resolved promise only drains microtasks and never lets the
    // poll phase run, so a microtask-based yield would leave HTTP requests
    // waiting out the entire serialize. Prove a real macrotask boundary by
    // showing a setImmediate callback queued during the run gets to interleave.
    const order = [];
    setImmediate(() => order.push("other-immediate"));
    await stringifyChunked({ a: 1, b: 2, c: 3 });
    order.push("done");
    assert.ok(
      order.indexOf("other-immediate") < order.indexOf("done"),
      "an unrelated setImmediate must run before serialization completes",
    );
  });
});
