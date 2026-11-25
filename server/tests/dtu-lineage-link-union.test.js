/**
 * FIX-graph-009 (server half): the dtu lineage macro derived parents
 * only from `lineage.parents` / the array form, while the detail
 * view's Metadata tab counted the legacy top-level `parents` /
 * `children` fields — so the same DTU read 1 parent in Lineage and 0
 * in Metadata. The macro now unions all three stampings (deduped).
 * Extraction harness: the macro + its ref helper are lifted verbatim
 * from server.js and registered against stubs.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
// (Was written against vitest, which the server suite does not have, so it
// never ran; ported to node:test.)
import { readFileSync } from "node:fs";
import { compileFunction } from "node:vm";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "server.js"), "utf8");
const start = src.indexOf("function _dtuLineageRef");
const endMarker = src.indexOf("Never fabricates a chain", start);
const end = src.indexOf("});", endMarker) + 3;
if (start < 0 || endMarker < 0) throw new Error("lineage macro not found in server.js");
const macroSrc = src.slice(start, end);

function loadLineage(dtus) {
  const STATE = { dtus: new Map(dtus.map((d) => [d.id, d])) };
  let handler = null;
  const register = (domain, action, fn) => { if (domain === "dtu" && action === "lineage") handler = fn; };
  const ctxMayReadDtu = () => true;
  const _dtuLineageAncestorChain = () => [];
  const fn = compileFunction(macroSrc, ["STATE", "register", "ctxMayReadDtu", "_dtuLineageAncestorChain"]);
  fn(STATE, register, ctxMayReadDtu, _dtuLineageAncestorChain);
  if (!handler) throw new Error("lineage handler not registered");
  return handler;
}

describe("dtu lineage link union", () => {
  it("unions lineage.parents with the legacy top-level parents", () => {
    const lineage = loadLineage([
      { id: "kid", title: "Kid", lineage: { parents: ["p1"], children: [] }, parents: ["p2"], children: ["c1"] },
      { id: "p1", title: "P1" }, { id: "p2", title: "P2" }, { id: "c1", title: "C1" },
    ]);
    const r = lineage({}, { id: "kid" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.parents.map((p) => p.id).sort(), ["p1", "p2"]);
    assert.deepEqual(r.children.map((c) => c.id), ["c1"]);
  });
  it("a legacy-only record still reports its parents", () => {
    const lineage = loadLineage([
      { id: "old", title: "Old", parents: ["p9"] },
      { id: "p9", title: "P9" },
    ]);
    const r = lineage({}, { id: "old" });
    assert.deepEqual(r.parents.map((p) => p.id), ["p9"]);
  });
  it("dedupes a parent stamped in both fields", () => {
    const lineage = loadLineage([
      { id: "x", title: "X", lineage: { parents: ["p1"] }, parents: ["p1"] },
      { id: "p1", title: "P1" },
    ]);
    const r = lineage({}, { id: "x" });
    assert.equal(r.parents.length, 1);
  });
});
