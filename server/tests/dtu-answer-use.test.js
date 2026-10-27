import { test } from "node:test";
import assert from "node:assert/strict";
import { orderConsolidatedFirst, titleNamedIn, memberCount, strongDtuMatch } from "../lib/archive-retrieval.js";
import { knowledgeNote, STRONG_NOTES_LINE } from "../lib/chat/agent-route.js";
import { conkayDtuBlock } from "../routes/chat-agent-stream.js";

const mega = { id: "m", tier: "mega", title: "MEGA — MLLMs Fail to Refuse when Using Tools Agentically", lineage: { parents: Array.from({ length: 10 }, (_, i) => `p${i}`) } };
const hyper = { id: "h", tier: "hyper", title: "HYPER — MEGA — RuneScape's Position on Gen AI", meta: { promotedFrom: 5 } };
const Q = "How many regular DTUs does Concord's MEGA 'MLLMs Fail to Refuse when Using Tools Agentically' cluster? Just the number.";

test("a mega named in the question outranks an unrelated hyper", () => {
  const out = orderConsolidatedFirst([{ dtu: hyper, score: 0.9, sim: 0.45 }, { dtu: mega, score: 0.6, sim: 0.4 }], Q);
  assert.equal(out[0].dtu.id, "m");
  // No query: old order (hyper, mega, regular) holds.
  assert.equal(orderConsolidatedFirst([{ dtu: mega, score: 0.6 }, { dtu: hyper, score: 0.1 }])[0].dtu.id, "h");
  assert.ok(titleNamedIn(Q, mega));
  assert.ok(!titleNamedIn(Q, hyper));
});

test("member count comes from lineage, else promotedFrom", () => {
  assert.equal(memberCount(mega), 10);
  assert.equal(memberCount(hyper), 5);
  assert.equal(memberCount({ tier: "mega" }), 0);
});

test("strong match adds the answer-from-notes line to Chat and ConKay blocks", () => {
  assert.ok(strongDtuMatch([{ dtu: mega, sim: 0.2 }], Q));
  assert.ok(strongDtuMatch([{ dtu: hyper, sim: 0.55 }], "unrelated"));
  assert.ok(!strongDtuMatch([{ dtu: hyper, sim: 0.4 }], "unrelated"));
  const k = knowledgeNote([{ id: "m", title: mega.title, tier: "mega", body: "Members: 10 regular DTUs." }], { strong: true });
  assert.ok(k.includes(STRONG_NOTES_LINE));
  assert.ok(!knowledgeNote([{ id: "m", title: "t" }]).includes(STRONG_NOTES_LINE));
  assert.match(conkayDtuBlock("[MEGA] x: y", { strong: true }), /Answer from these notes first; only search the web if they don't contain it/);
  assert.doesNotMatch(conkayDtuBlock("[MEGA] x: y"), /Answer from these notes first/);
});
