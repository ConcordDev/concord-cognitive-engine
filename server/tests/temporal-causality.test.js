// Engine N10 — time/causality (temporal logic + causal ordering). Pins the LTL
// operators (eventually/always/until/next) over a forward-sim timeline (the
// prediction engine) and causal topo-order + cycle/paradox detection +
// happens-before (the time-loop mechanic).
//
// Run: node --test tests/temporal-causality.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { eventually, always, nextHolds, until, topoCausalOrder, hasCausalCycle, happensBefore } from "../lib/temporal/causality.js";

describe("LTL over a forward-sim timeline (prediction)", () => {
  // hp falls 100→0 over the timeline
  const tl = [{ hp: 100 }, { hp: 70 }, { hp: 40 }, { hp: 0 }];
  const dead = (s) => s.hp <= 0;
  const alive = (s) => s.hp > 0;

  it("◇ eventually: the entity eventually dies", () => {
    assert.equal(eventually(dead, tl), true);
    assert.equal(eventually((s) => s.hp > 200, tl), false);
  });
  it("□ always: hp is always ≥ 0", () => {
    assert.equal(always((s) => s.hp >= 0, tl), true);
    assert.equal(always(alive, tl), false); // dies at the end
  });
  it("U until: alive UNTIL dead", () => {
    assert.equal(until(alive, dead, tl), true);
  });
  it("○ next", () => {
    assert.equal(nextHolds((s) => s.hp === 70, tl, 0), true);
  });
});

describe("causal order + paradox detection (time-loop)", () => {
  it("topological order puts causes before effects", () => {
    const edges = [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]];
    const order = topoCausalOrder(edges);
    assert.ok(order);
    assert.ok(order.indexOf("a") < order.indexOf("b"));
    assert.ok(order.indexOf("b") < order.indexOf("d"));
  });

  it("a causal cycle (a→b→a) is a paradox → no order", () => {
    const edges = [["a", "b"], ["b", "a"]];
    assert.equal(topoCausalOrder(edges), null);
    assert.equal(hasCausalCycle(edges), true);
  });

  it("an acyclic graph has no paradox", () => {
    assert.equal(hasCausalCycle([["a", "b"], ["b", "c"]]), false);
  });

  it("happensBefore is transitive", () => {
    const edges = [["a", "b"], ["b", "c"]];
    assert.equal(happensBefore("a", "c", edges), true);  // a → b → c
    assert.equal(happensBefore("c", "a", edges), false); // not backwards
  });
});
