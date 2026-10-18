// Long chats: DTU-backed memory, recall over the user's DTUs, formula DTUs for the solver,
// fresh-data guard, and malformed [TOOL_CALL] repair (long-chat probe 2026-10-17).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionMemory, savedItemsFromRows, isRecallAsk, findFormulaDtus, _setFormulaCache, formulaContextBlock,
  memoryDtuDue, memoryDtuCreateInput, rankRecallDtus, loadSessionRows,
} from "../lib/chat/session-memory.js";
import { chatAgentRoute, isWordProblem, needsFreshData, agentHistoryWithNotes } from "../lib/chat/agent-route.js";
import { findToolCallSpans, repairToolCallJson } from "../lib/v6-observe-bridge.js";

function longSession() {
  const said = ["yo", "how you been", "my dog's name is biscuit btw hes a corgi lol", "what trump doing lately",
    "ok help me plan a 3 day nyc trip, budget is like $1200, im into food and music",
    "nah I meant brooklyn not manhattan, i wanna stay in brooklyn", "save a note for me: pick up film from the lab friday"];
  const rows = [];
  for (let i = 0; i < 45; i++) {
    const u = said[i] || `random ask number ${i} about pizza`;
    rows.push({ role: "user", content: u });
    if (/save a note/.test(u)) rows.push({ role: "assistant", content: 'Saved a private DTU titled "Pick up film from lab" (id: dtu_058af9596eb3511e91d9).', meta: { toolCalls: [{ tool: "create_dtu", ok: true, dtuId: "dtu_058af9596eb3511e91d9", title: "Pick up film from lab" }] } });
    else rows.push({ role: "assistant", content: `Reply ${i}.` });
  }
  return rows;
}

test("memory keeps turn-3 facts, the budget, the correction and the saved note at turn 45", () => {
  const m = buildSessionMemory(longSession());
  assert.equal(m.userTurns, 45);
  assert.match(m.text, /biscuit/);
  assert.match(m.text, /\$1200/);
  assert.match(m.text, /brooklyn not manhattan/);
  assert.match(m.text, /Pick up film from lab.*dtu_058af9596eb3511e91d9/);
  assert.ok(!/turn \d+: yo\b/.test(m.text), "small talk dropped");
  assert.ok(m.text.length < 6000, `bounded: ${m.text.length}`);
});

test("short chats get no memory block; DTU refresh cadence", () => {
  assert.equal(buildSessionMemory(longSession().slice(0, 8)).text, "");
  assert.equal(memoryDtuDue(5), false);
  assert.equal(memoryDtuDue(10), true);
  assert.equal(memoryDtuDue(13), false);
  assert.equal(memoryDtuDue(13, { evicted: true }), true);
  const inp = memoryDtuCreateInput("s1", "x");
  assert.equal(inp.visibility, "private");
  assert.ok(inp.tags.includes("chat-memory"));
  assert.equal(inp.consent.allowAiTraining, false);
});

test("saved items come from tool results and receipts, failed writes are ignored", () => {
  const items = savedItemsFromRows([
    { role: "assistant", content: "x", meta_json: JSON.stringify({ toolCalls: [{ tool: "run_lens_action", ok: true, params: { domain: "productivity", action: "task-add", params: { content: "call mom sunday" } } }] }) },
    { role: "assistant", content: "x", meta: { toolCalls: [{ tool: "run_lens_action", ok: false, params: { domain: "productivity", action: "task-add", params: { content: "nope" } } }] } },
    { role: "assistant", content: "y", meta: { artifacts: [{ type: "song", title: "Late Night Drives" }] } },
  ]);
  assert.deepEqual(items, ['productivity.task-add "call mom sunday"', 'song "Late Night Drives"']);
});

test("recall asks route to recall; DTU ranking prefers term overlap", () => {
  for (const p of ["what did i save earlier", "whats my dog's name again", "wait what did I say my budget was?"]) {
    assert.ok(isRecallAsk(p), p);
    assert.equal(chatAgentRoute(p), "recall", p);
  }
  assert.equal(chatAgentRoute("save a note for me: pick up film"), "save");
  const r = rankRecallDtus([{ id: "a", title: "Groceries", createdAt: "2026-10-18" }, { id: "b", title: "Pick up film from lab", createdAt: "2026-10-01" }], "what did i save about the film");
  assert.equal(r[0].id, "b");
});

test("word problems go to compute, travel plans and prices do not", () => {
  assert.ok(isWordProblem("if i drive 260 miles at 31 mpg and gas is 3.49 a gallon how much is gas"));
  assert.ok(isWordProblem("if i put 5000 in at 6% compounded yearly how much after 10 years"));
  assert.equal(chatAgentRoute("if i put 5000 in at 6% compounded yearly how much after 10 years"), "compute");
  assert.ok(!isWordProblem("plan a 3 day nyc trip, budget is like $1200 for 2 people"));
  assert.ok(!isWordProblem("bitcoin price rn"));
});

test("formula DTUs match by real terms and produce a solver note", () => {
  _setFormulaCache([
    { id: "grounding_fin_compound_interest", title: "Compound interest & the rule of 72", summary: "Compounding earns return on prior return.", tags: ["finance", "compounding", "interest", "growth"] },
    { id: "grounding_phys_newton", title: "Newton's laws & conservation", summary: "F=ma.", tags: ["mechanics", "newton", "momentum", "conservation"] },
  ]);
  const f = findFormulaDtus(null, "if i put 5000 in at 6% compounded yearly how much after 10 years");
  assert.equal(f[0].id, "grounding_fin_compound_interest");
  assert.equal(findFormulaDtus(null, "a 2 kg mass with 10 N force, what acceleration")[0].id, "grounding_phys_newton");
  assert.deepEqual(findFormulaDtus(null, "18% tip on 247.50"), []);
  assert.match(formulaContextBlock(f), /run_compute/);
  _setFormulaCache(null);
});

test("agent history puts memory first and DTU notes last", () => {
  const h = agentHistoryWithNotes([{ role: "user", content: "hi" }, { role: "assistant", content: "hey" }], {
    memoryBlock: "MEM", formulaDtus: [{ id: "grounding_x", title: "X", summary: "s" }], recallDtus: [{ id: "dtu_1", title: "film" }],
  });
  assert.equal(h[0].content, "MEM");
  assert.equal(h[h.length - 1].role, "system");
  assert.match(h[h.length - 1].content, /grounding_x[\s\S]*dtu_1/);
});

test("fresh-data detector covers follow-ups like 'and eth?'", () => {
  assert.ok(needsFreshData("who won the games last night"));
  assert.ok(needsFreshData("and eth?"));
  assert.ok(needsFreshData("and solana?", [{ role: "user", content: "bitcoin price rn" }]));
  assert.ok(!needsFreshData("how do i fold a fitted sheet neatly every time", [{ role: "user", content: "bitcoin price" }]));
});

test("a nested call missing one brace is repaired, junk stays junk", () => {
  const t = '[TOOL_CALL: {"tool": "run_lens_action", "params": {"domain": "travel", "action": "itinerary-create", "params": {"budget": 1200, "preferences": {"a": "b"}}}]';
  const spans = findToolCallSpans(t);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].parsed.params.action, "itinerary-create");
  assert.equal(repairToolCallJson('{"not": "a call"'), null);
  assert.equal(findToolCallSpans('[TOOL_CALL: {"tool":"web_search","params":{"query":"x"}}]')[0].parsed.tool, "web_search");
});

test("loadSessionRows is bounded and never throws", () => {
  assert.deepEqual(loadSessionRows(null, "s"), []);
  let seen = null;
  const db = { prepare: () => ({ all: (sid, lim) => { seen = lim; return [{ role: "assistant", content: "b" }, { role: "user", content: "a" }]; } }) };
  assert.deepEqual(loadSessionRows(db, "s").map((r) => r.content), ["a", "b"]);
  assert.equal(seen, 400);
  assert.deepEqual(loadSessionRows({ prepare: () => { throw new Error("x"); } }, "s"), []);
});

test("follow-ups: chat-history price recall, note recall, memory DTU refs, compute hint", async () => {
  const { memoryDtuRefs } = await import("../lib/chat/session-memory.js");
  const { routeHint } = await import("../lib/chat/agent-route.js");
  assert.ok(!needsFreshData("how much was bitcoin when i asked earlier"));
  assert.ok(isRecallAsk("how much was bitcoin when i asked earlier"));
  assert.ok(isRecallAsk("tell me what my film note says"));
  const mem = buildSessionMemory(longSession());
  assert.deepEqual(memoryDtuRefs(mem.text), [{ id: "dtu_058af9596eb3511e91d9", title: "Pick up film from lab" }]);
  assert.match(routeHint("compute"), /symbolic\.evaluate/);
});

test("task receipts are tasks, not DTUs; saved songs/tasks are citable titles", async () => {
  const { memoryDtuRefs } = await import("../lib/chat/session-memory.js");
  const rows = longSession();
  rows.push({ role: "user", content: "add a task to my tasks: call mom sunday" });
  rows.push({ role: "assistant", content: 'Saved in productivity: "call mom sunday" (id tsk_mvdaokth_yu5nxm, due 2026-10-18).' });
  rows.push({ role: "assistant", content: "x", meta: { artifacts: [{ type: "song", title: "Late Night Drives" }] } });
  const m = buildSessionMemory(rows);
  assert.match(m.text, /- task "call mom sunday" id tsk_mvdaokth_yu5nxm/);
  assert.ok(!/note \(DTU\) "call mom sunday"/.test(m.text));
  const refs = memoryDtuRefs(m.text);
  assert.ok(refs.some((r) => r.id === "dtu_058af9596eb3511e91d9"));
  assert.ok(refs.some((r) => r.title === "call mom sunday" && !r.id));
  assert.ok(refs.some((r) => r.title === "Late Night Drives"));
  const { guardDtuCitations, collectRetrievedDtus } = await import("../lib/chat/dtu-citation-guard.js");
  const g = guardDtuCitations('You saved:\n- **Note**: "Pick up film from lab" (dtu_058af9596eb3511e91d9)\n- **Note**: call mom sunday\n- Song: Late Night Drives', collectRetrievedDtus(refs), { prompt: "what did i save earlier" });
  assert.deepEqual(g.removed, []);
});
