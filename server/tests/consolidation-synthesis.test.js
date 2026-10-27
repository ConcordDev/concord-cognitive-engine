import { test } from "node:test";
import assert from "node:assert/strict";
import { isConsolidatedNode, budgetDemotions, synthesizeConsolidatedBody, memberGist, sharedThemes, absorbTarget, growConsolidatedNode } from "../lib/consolidation-synthesis.js";

const mk = (i, extra = {}) => ({ id: `r${i}`, tier: "regular", title: `Agent refusal case ${i}`, scope: "global", visibility: "public", core: { definitions: [`Multimodal agents fail to refuse harmful tool request number ${i} when acting agentically.`], claims: [`claim ${i} about refusal`] }, ...extra });

test("the tier budget never demotes consolidated megas, only usage-placed ones", () => {
  const cons = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, tier: "mega", lineage: { parents: ["a", "b", "c"] } }));
  const placed = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, tier: "mega", abstraction: { score: i } }));
  assert.deepEqual(budgetDemotions(cons, 22), [], "over budget but all consolidated: nothing demoted");
  const out = budgetDemotions([...cons, ...placed], 22);
  assert.equal(out.length, 5);
  assert.ok(out.every((d) => d.id.startsWith("p")));
  assert.equal(budgetDemotions([...placed], 3, (a, b) => b.abstraction.score - a.abstraction.score).map((d) => d.id).join(), "p1,p0");
  assert.ok(isConsolidatedNode({ tier: "hyper", meta: { promotedFrom: 3 } }));
  assert.ok(!isConsolidatedNode({ tier: "regular", lineage: { parents: ["x"] } }));
  assert.ok(!isConsolidatedNode({ tier: "mega" }));
});

test("mega body is a synthesis with the member count, themes and member gists", () => {
  const members = Array.from({ length: 6 }, (_, i) => mk(i));
  const { text, themes, gists } = synthesizeConsolidatedBody({ tier: "mega", childTier: "regular", titleSeed: "MLLMs Fail to Refuse", members, tags: ["safety"] });
  assert.match(text, /^Members: 6 regular DTUs\./);
  assert.ok(themes.includes("refuse") || themes.includes("agents"), themes.join());
  assert.equal(gists.length, 6);
  assert.match(text, /Agent refusal case 0: Multimodal agents fail to refuse/);
  assert.doesNotMatch(text, /Cluster representative for ids/);
  assert.equal(memberGist({ cretiHuman: "**What this is**: A short thing that is long enough. More." }), "A short thing that is long enough.");
  assert.deepEqual(sharedThemes([]), []);
});

test("a cluster with a live mega is absorbed into it: only new members, same envelope", () => {
  const node = { id: "M", tier: "mega", title: "MEGA — Agent refusal case 0", status: "active", scope: "global", visibility: "public", lineage: { parents: ["r0", "r1"] }, meta: { promotedFrom: 2, clusterKey: "k" }, core: { definitions: ["A compressed synthesis of 2 regular DTUs around: Agent refusal case 0."], claims: ["claim 0 about refusal"] }, cretiHuman: "Members: 2 regular DTUs.\n\n**Summary**: 2 regular DTUs on x." };
  const members = [mk(0), mk(1), mk(2), mk(3)];
  const key = (d) => `${d.scope}|${d.visibility}`;
  const t = absorbTarget(node, { targetTier: "mega", members, scopeKey: key });
  assert.deepEqual(t.members.map((m) => m.id), ["r2", "r3"]);
  assert.equal(absorbTarget(node, { targetTier: "hyper", members }), null, "wrong tier");
  assert.equal(absorbTarget({ ...node, visibility: "internal" }, { targetTier: "mega", members, scopeKey: key }), null, "different envelope (internal stays apart)");
  assert.equal(absorbTarget({ ...node, tier: "regular" }, { targetTier: "mega", members }), null, "downgraded artifact is not grown");
  const undo = growConsolidatedNode(node, t.members, { childTier: "regular", now: () => "2026-10-27T17:00:00Z" });
  assert.deepEqual(node.lineage.parents, ["r0", "r1", "r2", "r3"]);
  assert.equal(node.meta.promotedFrom, 4);
  assert.match(node.cretiHuman, /^Members: 4 regular DTUs\./);
  assert.match(node.core.definitions[0], /^A compressed synthesis of 4 regular DTUs/);
  assert.ok(node.core.claims.includes("claim 3 about refusal"));
  assert.match(node.cretiHuman, /Absorbed 2026-10-27/);
  assert.equal(node.title, "MEGA — Agent refusal case 0", "title unchanged, never nested");
  undo();
  assert.deepEqual(node.lineage.parents, ["r0", "r1"]);
  assert.equal(node.meta.promotedFrom, 2);
});
