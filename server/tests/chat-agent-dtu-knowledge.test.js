import { test } from "node:test";
import assert from "node:assert/strict";
import { agentHistoryWithNotes, knowledgeNote, routeHint } from "../lib/chat/agent-route.js";
import { collectRetrievedDtus } from "../lib/chat/dtu-citation-guard.js";

const hyper = { id: "dtu_004_fixed_point_attractor_law", title: "Fixed-Point Attractor Law", tier: "hyper", archived: true, body: "Population model F(N)=1.5N(1-N/100) has fixed points N*=0 and N*=66.7; N*=66.7 attracts." };

test("Chat's tool route gets the retrieved DTUs (archived hyper included) as a system note", () => {
  const out = agentHistoryWithNotes([{ role: "user", content: "hi" }], { knowledgeDtus: [hyper] });
  const sys = out.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  assert.match(sys, /CONCORD KNOWLEDGE/);
  assert.match(sys, /\[HYPER, archived\] dtu_004_fixed_point_attractor_law/);
  assert.match(sys, /N\*=66\.7/);
  assert.match(sys, /without web_search/);
});

test("no knowledge, no note; lookup hint points at the note first", () => {
  assert.equal(knowledgeNote([]), "");
  assert.match(routeHint("lookup"), /^If a CONCORD KNOWLEDGE note above answers it/);
});

test("a cited knowledge DTU counts as retrieved for the citation guard", () => {
  const acc = collectRetrievedDtus([], [hyper]);
  assert.ok(acc.ids.has(hyper.id));
});
