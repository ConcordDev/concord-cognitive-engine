// Brief D item 4: a read-only dtu_search chat tool that respects per-user
// visibility, and a citation guard that flags unknown DTU ids on every turn.
import test from "node:test";
import assert from "node:assert/strict";
import { dispatchChatDtuSearch } from "../lib/chat-tool-surface.js";
import { executeToolCall } from "../lib/chat-agent.js";
import { collectRetrievedDtus, guardDtuCitations } from "../lib/chat/dtu-citation-guard.js";

const MINE = { id: "dtu_mine_000001", title: "Beam sizing notes", tags: ["beam"], scope: "user", visibility: "private", author: "u1", content: "R10 depth" };
const THEIRS = { id: "dtu_theirs_00002", title: "Someone else's secret", scope: "user", visibility: "private", author: "u2" };
const PUBLIC = { id: "dtu_public_000003", title: "Euler buckling", visibility: "public", author: "u3", cretiHuman: "Pcr = pi^2 E I / (K L)^2" };

// A macro that (wrongly) returns everything: the tool must still hold the line.
const leakyMacro = async () => ({ ok: true, dtus: [MINE, THEIRS, PUBLIC] });
const ctxFor = (id) => ({ actor: { id } });

test("a viewer sees their own and public DTUs, never someone else's private one", async () => {
  const r = await dispatchChatDtuSearch(leakyMacro, ctxFor("u1"), { query: "beam" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.dtus.map((d) => d.id).sort(), [MINE.id, PUBLIC.id].sort());
  assert.ok(!JSON.stringify(r).includes("secret"));
});

test("an anonymous viewer gets public DTUs only", async () => {
  const r = await dispatchChatDtuSearch(leakyMacro, {}, { query: "beam" });
  assert.deepEqual(r.dtus.map((d) => d.id), [PUBLIC.id]);
});

test("empty query and macro failure are honest errors", async () => {
  assert.equal((await dispatchChatDtuSearch(leakyMacro, ctxFor("u1"), {})).ok, false);
  const bad = await dispatchChatDtuSearch(async () => ({ ok: false, error: "boom" }), ctxFor("u1"), { query: "x" });
  assert.deepEqual([bad.ok, bad.error], [false, "boom"]);
});

test("no hits tells the model not to invent", async () => {
  const r = await dispatchChatDtuSearch(async () => ({ ok: true, dtus: [] }), ctxFor("u1"), { query: "zzz" });
  assert.equal(r.total, 0);
  assert.match(r.note, /do not invent/i);
});

test("executeToolCall dispatches dtu_search through the macro router", async () => {
  let seen;
  const r = await executeToolCall(ctxFor("u1"), async (d, n, input) => { seen = [d, n, input.q]; return { ok: true, dtus: [PUBLIC] }; }, new Map(), { tool: "dtu_search", params: { query: "buckling" } });
  assert.deepEqual(seen, ["dtu", "search", "buckling"]);
  assert.equal(r.dtus[0].id, PUBLIC.id);
});

test("ids from a dtu_search result may be cited; others are flagged with a note", async () => {
  const tool = await dispatchChatDtuSearch(leakyMacro, ctxFor("u1"), { query: "beam" });
  const retrieved = collectRetrievedDtus([tool]);
  const g = guardDtuCitations(`See dtu_public_000003 and dtu_invented_77aa.`, retrieved, { prompt: "cite" });
  assert.match(g.text, /dtu_public_000003/);
  assert.match(g.text, /\[unknown DTU\]/);
  assert.match(g.text, /Removed 1 DTU reference/);
});

test("a placeholder the model wrote itself still gets the guard note", () => {
  const g = guardDtuCitations("Source: [unknown DTU].", collectRetrievedDtus([]), { prompt: "x" });
  assert.deepEqual(g.removed, ["[unknown DTU]"]);
  assert.match(g.text, /Removed 1 DTU reference/);
});

test("loose id shapes are flagged, list positions are not", () => {
  const none = collectRetrievedDtus([]);
  assert.match(guardDtuCitations("per DTU-48213 the load is 5 kN", none).text, /\[unknown DTU\]/);
  assert.equal(guardDtuCitations("DTU #3 in the list", none).removed.length, 0);
  const known = collectRetrievedDtus([{ id: "dtu_48213abc" }]);
  assert.equal(guardDtuCitations("per DTU:48213abc", known).removed.length, 0);
});

test("an id-shaped query with no exact hit says so (live harness case adv.fake-dtu-id)", async () => {
  const r = await dispatchChatDtuSearch(leakyMacro, ctxFor("u1"), { query: "DTU-48213" });
  assert.equal(r.exactIdMatch, false);
  assert.deepEqual(r.missingIds, ["DTU-48213"]);
  assert.match(r.note, /No DTU has the id DTU-48213/);
  const hit = await dispatchChatDtuSearch(async () => ({ ok: true, dtus: [{ ...PUBLIC, id: "DTU-48213" }] }), ctxFor("u1"), { query: "DTU-48213" });
  assert.equal(hit.exactIdMatch, undefined);
  assert.match(hit.note, /Cite only/);
});
