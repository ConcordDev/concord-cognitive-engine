// #1715 S1 — typed DTU relations (lib/dtu-relations.js).
//
// Pins: relations live on the DTU record as metadata (sibling of
// lineage, outside the integrity-hashed layers); one relation per
// (to, type) pair; validation refuses the malformed shapes; the
// GRAPH_INDEX projection keys typed edges `#type` so they never
// overwrite lineage edges between the same pair.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addRelation, removeRelation, relationsOf, relationEdges,
} from "../lib/dtu-relations.js";

const dtu = (over = {}) => ({ id: "dtu_a", title: "A", ...over });

describe("dtu-relations — add", () => {
  it("creates the relations array and stamps source/at", () => {
    const d = dtu();
    const r = addRelation(d, { to: "dtu_b", type: "cites", at: 123 });
    assert.equal(r.ok, true);
    assert.equal(r.replaced, false);
    assert.deepEqual(d.relations, [
      { to: "dtu_b", type: "cites", source: "manual", at: 123 },
    ]);
  });

  it("keeps attributes, shallow-copied from the caller", () => {
    const d = dtu();
    const attrs = { weight: { value: 2, source: "workbench", at: 1 } };
    addRelation(d, { to: "dtu_b", type: "part-of", attributes: attrs, source: "workbench", at: 5 });
    attrs.weight = "mutated";
    assert.deepEqual(d.relations[0].attributes, { weight: { value: 2, source: "workbench", at: 1 } });
    assert.equal(d.relations[0].source, "workbench");
  });

  it("re-adding the same (to, type) replaces instead of stacking", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_b", type: "cites", attributes: { n: 1 }, at: 1 });
    const r = addRelation(d, { to: "dtu_b", type: "cites", attributes: { n: 2 }, at: 2 });
    assert.equal(r.replaced, true);
    assert.equal(d.relations.length, 1);
    assert.deepEqual(d.relations[0].attributes, { n: 2 });
    assert.equal(d.relations[0].at, 2);
  });

  it("distinct types to the same target coexist", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_b", type: "cites" });
    addRelation(d, { to: "dtu_b", type: "contradicts" });
    assert.equal(d.relations.length, 2);
  });

  it("refuses the malformed shapes, leaving the record untouched", () => {
    const d = dtu();
    assert.equal(addRelation(null, { to: "x", type: "cites" }).error, "dtu_required");
    assert.equal(addRelation({}, { to: "x", type: "cites" }).error, "dtu_id_required");
    assert.equal(addRelation(d, { to: " ", type: "cites" }).error, "relation_target_required");
    assert.equal(addRelation(d, { to: "dtu_a", type: "cites" }).error, "relation_self");
    assert.equal(addRelation(d, { to: "dtu_b", type: "" }).error, "relation_type_invalid");
    assert.equal(addRelation(d, { to: "dtu_b", type: "9lives" }).error, "relation_type_invalid");
    assert.equal(addRelation(d, { to: "dtu_b", type: "has space" }).error, "relation_type_invalid");
    assert.equal(addRelation(d, { to: "dtu_b", type: "x".repeat(41) }).error, "relation_type_invalid");
    assert.equal(d.relations, undefined);
  });
});

describe("dtu-relations — remove + read", () => {
  it("removes exactly the named pair", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_b", type: "cites" });
    addRelation(d, { to: "dtu_b", type: "part-of" });
    assert.deepEqual(removeRelation(d, "dtu_b", "cites"), { ok: true, removed: true });
    assert.deepEqual(relationsOf(d).map((r) => r.type), ["part-of"]);
    assert.deepEqual(removeRelation(d, "dtu_b", "cites"), { ok: true, removed: false });
    assert.deepEqual(removeRelation(dtu(), "dtu_b", "cites"), { ok: true, removed: false });
  });

  it("relationsOf normalises: malformed entries drop, absence reads empty", () => {
    const d = dtu({ relations: [null, { to: 5, type: "x" }, { to: "b", type: "cites" }, { to: "c" }] });
    assert.deepEqual(relationsOf(d), [{ to: "b", type: "cites" }]);
    assert.deepEqual(relationsOf(dtu()), []);
    assert.deepEqual(relationsOf(null), []);
  });
});

describe("dtu-relations — index projection", () => {
  it("projects typed edges keyed `${id}->${to}#${type}`", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_b", type: "cites", at: 1 });
    assert.deepEqual(relationEdges(d), [
      { id: "dtu_a->dtu_b#cites", source: "dtu_a", target: "dtu_b", type: "cites", relation: true },
    ]);
  });

  it("a typed edge never collides with the lineage key for the same pair", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_b", type: "child" });
    const [edge] = relationEdges(d);
    assert.notEqual(edge.id, "dtu_a->dtu_b", "lineage child edges key `${id}->${childId}`");
    assert.equal(edge.id, "dtu_a->dtu_b#child");
  });

  it("dangling targets project too (readers tolerate them, as lineage does)", () => {
    const d = dtu();
    addRelation(d, { to: "dtu_gone", type: "cites" });
    assert.equal(relationEdges(d)[0].target, "dtu_gone");
  });
});
