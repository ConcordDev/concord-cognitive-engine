// Regression pinning: computeCascadeTree (server/lib/creator-dashboard.js)
// used to return ONLY aggregated per-generation counts, discarding which
// individual DTUs were actually found at each depth and which specific
// ancestor(s) each one cited. That made a real node-link tree/graph
// impossible to render — the `creator` lens's Cascade tab could only ever
// show a bar-per-generation chart, not an actual lineage tree (see
// audit/LENS_DESIGN_UPGRADE_PLAN.md #54, flagged HIGH PRIORITY). Fixed by
// additionally returning a real `nodes` array — one entry per DTU actually
// walked, with its real parentIds — alongside the pre-existing `generations`
// shape (unchanged, so no existing caller is affected).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeCascadeTree } from "../lib/creator-dashboard.js";

function makeDtu(id, title, parents = [], domain = "test") {
  return { id, title, domain, lineage: { parents } };
}

describe("computeCascadeTree — real per-node lineage graph", () => {
  it("returns a nodes array with the root plus every downstream DTU and its real parent edges", () => {
    const dtus = new Map();
    dtus.set("root", makeDtu("root", "Root DTU"));
    dtus.set("childA", makeDtu("childA", "Child A", ["root"]));
    dtus.set("childB", makeDtu("childB", "Child B", ["root"]));
    dtus.set("grandchild", makeDtu("grandchild", "Grandchild", ["childA"]));
    dtus.set("unrelated", makeDtu("unrelated", "Unrelated DTU", []));

    const r = computeCascadeTree("root", { dtus });

    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.nodes));
    const byId = Object.fromEntries(r.nodes.map((n) => [n.id, n]));

    assert.ok(byId.root, "root node present");
    assert.equal(byId.root.depth, 0);
    assert.deepEqual(byId.root.parentIds, []);

    assert.ok(byId.childA, "childA present");
    assert.equal(byId.childA.depth, 1);
    assert.deepEqual(byId.childA.parentIds, ["root"]);
    assert.equal(byId.childA.title, "Child A");

    assert.ok(byId.grandchild, "grandchild present");
    assert.equal(byId.grandchild.depth, 2);
    assert.deepEqual(byId.grandchild.parentIds, ["childA"]);

    assert.ok(!byId.unrelated, "a DTU with no lineage link to root must not appear");

    // Pre-existing aggregated shape must be untouched.
    assert.equal(r.totalDownstream, 3);
    assert.equal(r.generations.length, 2);
    assert.equal(r.generations[0].count, 2);
    assert.equal(r.generations[1].count, 1);
  });

  it("caps node records per generation without under-reporting the real aggregated count", () => {
    const dtus = new Map();
    dtus.set("root", makeDtu("root", "Root"));
    for (let i = 0; i < 100; i++) {
      dtus.set(`c${i}`, makeDtu(`c${i}`, `Child ${i}`, ["root"]));
    }

    const r = computeCascadeTree("root", { dtus });
    const depth1Nodes = r.nodes.filter((n) => n.depth === 1);

    assert.ok(depth1Nodes.length <= 60, "node list is capped per generation");
    assert.equal(r.generations[0].count, 100, "aggregated count stays the real, uncapped total");
  });

  it("honest empty shape still includes an empty nodes array", () => {
    const r = computeCascadeTree("root", { dtus: null });
    assert.equal(r.ok, true);
    assert.deepEqual(r.nodes, []);
  });
});
