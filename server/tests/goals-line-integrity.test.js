// S2 scoping (Review 5 F2) — the goals domain and the dispatch input
// layer are NOT where newlines die: key results round-trip as
// separate lines, and the dispatch peel leaves flat input untouched.
// Real imports; the defect, wherever it lives, is upstream of these.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerGoalsActions from "../domains/goals.js";
import { peelRedundantArtifactWrapper } from "../lib/lens-input-normalize.js";

const actions = new Map();
registerGoalsActions((d, a, fn) => actions.set(`${d}.${a}`, fn));
const ctx = { actor: { userId: "line-integrity-test" } };

beforeEach(() => { globalThis._concordSTATE = {}; });

test("alignmentTree stores key results as separate lines", async () => {
  const r = await actions.get("goals.alignmentTree")(ctx, null, {
    op: "upsert", title: "Parent", keyResults: ["KR Alpha", "KR Beta"],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.flat[0].keyResults, ["KR Alpha", "KR Beta"]);
  assert.equal(r.result.stats.keyResultsLinked, 2);
});

test("dispatch peel leaves flat input byte-identical", () => {
  const flat = { op: "upsert", title: "Obj", keyResults: ["KR Alpha", "KR Beta"] };
  assert.equal(peelRedundantArtifactWrapper(flat), flat);
  const withSibling = { artifact: { data: { a: 1 } }, period: "Q3" };
  assert.equal(peelRedundantArtifactWrapper(withSibling), withSibling);
});
