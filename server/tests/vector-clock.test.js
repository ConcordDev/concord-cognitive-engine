// W2-C — vector clock contract tests.
//
// Pins: increment is monotone; merge is pointwise max; compare correctly
// classifies before/after/concurrent/equal — including GENUINELY concurrent
// histories built from two independent branches off a shared ancestor, not
// just a sequential chain (a chain trivially yields before/after; the real
// test of a vector clock is catching the concurrent case a wall clock gets
// wrong).

import { test } from "node:test";
import assert from "node:assert/strict";
import { create, increment, merge, compare } from "../lib/consensus/vector-clock.js";

test("create() with no argument is an empty clock", () => {
  assert.deepStrictEqual(create(), {});
});

test("create(nodeId) seeds that node at 0", () => {
  assert.deepStrictEqual(create("a"), { a: 0 });
});

test("increment bumps only the named node's counter", () => {
  const vc0 = create("a");
  const vc1 = increment(vc0, "a");
  assert.strictEqual(vc1.a, 1);
  const vc2 = increment(vc1, "b");
  assert.deepStrictEqual(vc2, { a: 1, b: 1 });
});

test("increment is immutable — never mutates its input", () => {
  const vc0 = { a: 3 };
  const vc1 = increment(vc0, "a");
  assert.deepStrictEqual(vc0, { a: 3 }, "input clock must be untouched");
  assert.strictEqual(vc1.a, 4);
  assert.notStrictEqual(vc0, vc1);
});

test("increment is monotone across repeated calls", () => {
  let vc = {};
  const seen = [];
  for (let i = 0; i < 10; i++) {
    vc = increment(vc, "node-x");
    seen.push(vc["node-x"]);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] > seen[i - 1], `counter must strictly increase: ${seen[i - 1]} -> ${seen[i]}`);
  }
  assert.deepStrictEqual(seen, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test("increment requires a nodeId", () => {
  assert.throws(() => increment({}, ""), /nodeId/);
  assert.throws(() => increment({}, undefined), /nodeId/);
});

test("merge is the pointwise max across the union of keys", () => {
  const a = { x: 2, y: 1 };
  const b = { x: 1, y: 3, z: 1 };
  const merged = merge(a, b);
  assert.deepStrictEqual(merged, { x: 2, y: 3, z: 1 });
});

test("merge does not mutate either input", () => {
  const a = { x: 2 };
  const b = { x: 5 };
  const merged = merge(a, b);
  assert.deepStrictEqual(a, { x: 2 });
  assert.deepStrictEqual(b, { x: 5 });
  assert.deepStrictEqual(merged, { x: 5 });
});

test("merge is commutative and idempotent", () => {
  const a = { p: 4, q: 1 };
  const b = { p: 1, q: 7, r: 2 };
  assert.deepStrictEqual(merge(a, b), merge(b, a));
  assert.deepStrictEqual(merge(a, a), a);
});

test("compare: identical clocks are equal", () => {
  const a = { x: 1, y: 2 };
  const b = { x: 1, y: 2 };
  assert.strictEqual(compare(a, b), "equal");
  assert.strictEqual(compare(a, a), "equal");
});

test("compare: two empty clocks are equal", () => {
  assert.strictEqual(compare({}, {}), "equal");
});

test("compare: a strict causal chain is before/after, not concurrent", () => {
  const vc0 = create("n1"); // {n1: 0}
  const vc1 = increment(vc0, "n1"); // {n1: 1}
  const vc2 = increment(vc1, "n1"); // {n1: 2}
  assert.strictEqual(compare(vc1, vc2), "before");
  assert.strictEqual(compare(vc2, vc1), "after");
});

test("compare: descendant across multiple nodes is after all its ancestors", () => {
  // n1 does one update, n2 does one update, then a third replica observes
  // both and does its own update — that update causally follows both.
  const fromN1 = increment({}, "n1"); // {n1:1}
  const fromN2 = increment({}, "n2"); // {n2:1}
  const observedBoth = merge(fromN1, fromN2); // {n1:1, n2:1}
  const n3Update = increment(observedBoth, "n3"); // {n1:1, n2:1, n3:1}

  assert.strictEqual(compare(fromN1, n3Update), "before");
  assert.strictEqual(compare(fromN2, n3Update), "before");
  assert.strictEqual(compare(n3Update, fromN1), "after");
  assert.strictEqual(compare(n3Update, fromN2), "after");
});

test("compare: GENUINELY CONCURRENT — two branches off the same empty ancestor with no causal path between them", () => {
  // Two nodes independently increment their own counter starting from the
  // same {} ancestor, without ever observing each other. Neither vector
  // clock dominates the other — this is the case a wall-clock last-write-wins
  // scheme gets arbitrarily/wrongly ordered, but a vector clock correctly
  // reports as unordered.
  const branchA = increment({}, "node-a"); // {node-a: 1}
  const branchB = increment({}, "node-b"); // {node-b: 1}
  assert.strictEqual(compare(branchA, branchB), "concurrent");
  assert.strictEqual(compare(branchB, branchA), "concurrent");
});

test("compare: concurrent branches stay concurrent even after further independent increments", () => {
  const base = merge(increment({}, "n1"), increment({}, "n2")); // {n1:1, n2:1} — common ancestor both branches saw
  const branchA = increment(base, "n1"); // {n1:2, n2:1} — n1 advances alone
  const branchB = increment(base, "n2"); // {n1:1, n2:2} — n2 advances alone
  assert.strictEqual(compare(branchA, branchB), "concurrent");
  assert.strictEqual(compare(branchB, branchA), "concurrent");
  // But both still causally follow the shared base.
  assert.strictEqual(compare(base, branchA), "before");
  assert.strictEqual(compare(base, branchB), "before");
});

test("compare: partial overlap with a wholly-different key set is concurrent, not equal-length coincidence", () => {
  const a = { x: 1 };
  const b = { y: 1 };
  assert.strictEqual(compare(a, b), "concurrent");
});

test("compare treats a missing key as an implicit 0", () => {
  const a = { x: 1 };
  const b = { x: 1, y: 0 };
  // y is explicitly 0 in b and implicitly 0 in a — these must compare equal.
  assert.strictEqual(compare(a, b), "equal");
});
