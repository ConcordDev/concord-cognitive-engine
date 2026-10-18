// Research quality (relevance filter, fetched-only sources, claim check,
// personal memory kept out) and plan jobs that always end with a dated plan document.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { tickMarathon, wantsPersonalMemory } from "../lib/agent-marathon.js";
import { startLongTask } from "../lib/long-task.js";
import { citationsFromToolCalls, saveCitationDtus, claimCheck, keyTerms, createResearchReport } from "../lib/research-mode.js";
import { shouldFinish, subgoalsAllDone, finalStepPrompt, finalizeText } from "../lib/long-task-finish.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT, created_at INTEGER, updated_at INTEGER, msg_count INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  db.exec(`CREATE TABLE goal_nodes (id TEXT PRIMARY KEY, tree_id TEXT, parent_id TEXT, title TEXT, status TEXT)`);
  return db;
}
function fakeMacros() {
  const dtus = [], docs = [];
  const fn = async (domain, name, input, ctx) => {
    if (domain === "dtu" && name === "create") { dtus.push({ input, ctx }); return { ok: true, id: `dtu_c${dtus.length}` }; }
    if (domain === "document" && name === "create") { docs.push({ input, ctx }); return { ok: true, dtuId: "dtu_doc_1", filename: "doc.md", downloadUrl: "/api/artifact/dtu_doc_1/download", sizeBytes: input.body.length }; }
    return { ok: true };
  };
  fn.dtus = dtus; fn.docs = docs;
  return fn;
}
const GOAL = "research the best small hobby servos for a robot arm and write me a report";
const DS = "The DS3218 is a 20 kg digital servo for robot arms. Stall torque 19 kg-cm at 5V and 21.5 kg-cm at 6.8V. Speed 0.16 sec/60° at 5V. Weight 60 g. Rotation 270°. Operating voltage 4.8-6.8 V.";

describe("citation relevance filter", () => {
  it("drops off-topic hits and unresolved Google News redirects, keeps on-topic ones", () => {
    assert.deepEqual([...keyTerms(GOAL)], ["hobby", "servo", "robot", "arm"]);
    const search = JSON.stringify({ results: [
      { title: "DS3218 servo review", url: "https://a.com/ds3218", snippet: "A 20 kg servo that is popular for robot arm shoulders." },
      { title: "Stock market today", url: "https://b.com/stocks", snippet: "Shares rose on Friday as investors weighed inflation data." },
      { title: "Servo news", url: "https://news.google.com/rss/articles/CBMi123", snippet: "Hobby servo roundup for robot builders and makers." },
    ] });
    const c = citationsFromToolCalls([
      { tool: "web_search", ok: true, result: search },
      { tool: "browse_url", ok: true, url: "https://news.google.com/rss/articles/CBMi999", title: "Servo story", text: DS + "\n" + DS },
      { tool: "browse_url", ok: true, url: "https://c.com/listing", fallback: "search-listing", title: "x", text: DS + "\n" + DS },
      { tool: "browse_url", ok: true, url: "https://d.com/cooking", title: "Pasta recipes", text: "How to cook pasta perfectly every single time with salted water and good olive oil.\nServe it with parmesan and fresh basil for a quick weeknight dinner at home." },
      { tool: "browse_url", ok: true, url: "https://e.com/ds3218", title: "DS3218 datasheet", text: DS + "\n" + DS },
    ], GOAL);
    assert.deepEqual(c.map((x) => x.url), ["https://a.com/ds3218", "https://e.com/ds3218"]);
    assert.equal(c[1].kind, "page");
  });

  it("a page read later upgrades an earlier search-hit citation", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: GOAL });
    const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id=?`).get(job.jobId);
    const m = fakeMacros();
    await saveCitationDtus(db, session, [{ tool: "web_search", ok: true, result: JSON.stringify({ results: [{ title: "DS3218", url: "https://e.com/ds3218", snippet: "DS3218 servo for a robot arm, 20 kg class." }] }) }], m);
    await saveCitationDtus(db, session, [{ tool: "browse_url", ok: true, url: "https://e.com/ds3218", title: "DS3218 datasheet", text: DS + "\n" + DS }], m);
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    assert.equal(meta.citations.length, 1);
    assert.equal(meta.citations[0].kind, "page");
    assert.match(meta.citations[0].text, /21\.5 kg-cm/);
  });
});

describe("claim check", () => {
  it("keeps specs found in the pages read and flags the rest", () => {
    const r = claimCheck("DS3218: 21.5 kg-cm at 6.8V, 0.16 sec/60°, 60 g. It costs $25 and draws 3 A.", [DS]);
    assert.equal(r.unsupported.length, 2);
    assert.match(r.text, /\$25 \(unverified\)/);
    assert.match(r.text, /3 A \(unverified\)/);
    assert.doesNotMatch(r.text, /21\.5 kg-cm \(unverified\)/);
  });

  it("research report cites only fetched pages and carries the claim check", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: GOAL });
    const m = fakeMacros();
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    meta.citations = [
      { id: "dtu_p", url: "https://e.com/ds3218", title: "DS3218 datasheet", kind: "page", text: DS },
      { id: "dtu_s", url: "https://a.com/lead", title: "A lead", kind: "search" },
    ];
    db.prepare(`UPDATE agent_marathon_sessions SET meta_json=?, status='completed' WHERE id=?`).run(JSON.stringify(meta), job.jobId);
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 2, 'assistant', ?)`).run(job.jobId, `# Servos\n${"The DS3218 gives 21.5 kg-cm at 6.8V but MG996R gives 15 kg-cm. ".repeat(6)}\n[TASK_COMPLETE]`);
    const rep = await createResearchReport(db, job.jobId, m);
    const body = m.docs[0].input.body;
    assert.match(body, /## Sources \(pages read\)\n\n1\. \[DS3218 datasheet\]/);
    assert.doesNotMatch(body, /A lead/);
    assert.match(body, /15 kg-cm \(unverified\)/);
    assert.match(body, /## Claim check/);
    assert.equal(rep.claimCheck.unsupported.length > 0, true);
  });
});

describe("personal memory stays out of research", () => {
  it("only an explicit ask opts in", () => {
    assert.equal(wantsPersonalMemory(GOAL), false);
    assert.equal(wantsPersonalMemory("research servos using my notes"), true);
    assert.equal(wantsPersonalMemory("compare what I've saved about servos"), true);
  });

  it("a research tick recalls only the job's own DTUs and turns off the substrate pull", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: GOAL });
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    meta.citationDtuIds = ["dtu_job"];
    db.prepare(`UPDATE agent_marathon_sessions SET meta_json=? WHERE id=?`).run(JSON.stringify(meta), job.jobId);
    const prev = globalThis.__concordRecallMemory;
    globalThis.__concordRecallMemory = async () => ({ dtus: [{ id: "dtu_personal", title: "My diary" }, { id: "dtu_job", title: "Source: DS3218" }], session: [] });
    let prompt = "";
    const brainChat = async ({ messages }) => { prompt = messages.map((x) => x.content).join("\n"); return { ok: true, text: "Progress notes: working." }; };
    try {
      await tickMarathon({ db, sessionId: job.jobId, runMacro: fakeMacros(), lensActions: new Map(), opts: { tickTurns: 1, brainChat } });
    } finally { globalThis.__concordRecallMemory = prev; }
    assert.match(prompt, /Source: DS3218/);
    assert.doesNotMatch(prompt, /My diary/);
  });
});

describe("plan jobs end with a dated plan document", () => {
  it("finishes when ~6 turns remain or every subgoal is done", () => {
    const db = setup();
    const meta = { longTask: true, mode: "plan", goalTreeId: "t1" };
    assert.equal(shouldFinish(db, { max_turns: 40, total_turns: 10 }, meta), null);
    assert.equal(shouldFinish(db, { max_turns: 40, total_turns: 34 }, meta), "turns_left");
    db.exec(`INSERT INTO goal_nodes VALUES ('r','t1',NULL,'root','active'),('a','t1','r','a','done'),('b','t1','r','b','done')`);
    assert.equal(subgoalsAllDone(db, "t1"), true);
    assert.equal(shouldFinish(db, { max_turns: 40, total_turns: 10 }, meta), "subgoals_done");
    assert.equal(shouldFinish(db, { max_turns: 40, total_turns: 34 }, { longTask: true, mode: "code" }), null);
    assert.equal(shouldFinish(db, { max_turns: 40, total_turns: 34 }, { ...meta, finalStepFailures: 2 }), null);
    assert.match(finalStepPrompt(meta, { planText: "  - Mon Oct 19: parts", today: new Date("2026-10-18T12:00:00Z") }), /Today is Sunday, October 18, 2026[\s\S]*Mon Oct 19: parts[\s\S]*Day-by-day/);
    assert.equal(finalizeText("plan [TOOL_CALL: {\"tool\":\"x\"}]\n[TASK_BLOCKED: no]"), "plan\n\n[TASK_COMPLETE]");
  });

  it("the final step writes the plan, completes the job and creates the document", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: "plan a 2-week build of a desktop robot arm", maxTurns: 40, origin: { surface: "chat", sessionId: "chat-9" } });
    db.prepare(`UPDATE agent_marathon_sessions SET total_turns = 35 WHERE id = ?`).run(job.jobId);
    const m = fakeMacros();
    let finalAsk = "";
    const plan = `# Desktop robot arm, 2 weeks\n${"Mon Oct 19: order MG996R x3 and SG90 x2 (approx. $40). ".repeat(10)}`;
    const brainChat = async ({ messages }) => { finalAsk = messages[messages.length - 1].content; return { ok: true, text: plan, provider: "t", model: "t" }; };
    const r = await tickMarathon({ db, sessionId: job.jobId, runMacro: m, lensActions: new Map(), opts: { tickTurns: 3, brainChat } });
    assert.equal(r.status, "completed");
    assert.equal(r.finalStep, "turns_left");
    assert.match(finalAsk, /FINAL STEP[\s\S]*Day-by-day schedule/);
    const s = db.prepare(`SELECT status, total_turns, meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId);
    assert.equal(s.status, "completed");
    assert.equal(s.total_turns, 36);
    assert.equal(m.docs.length, 1);
    assert.match(m.docs[0].input.title, /^Plan: /);
    assert.match(m.docs[0].input.body, /Written [A-Z][a-z]{2} \d+, 2026/);
    assert.match(m.docs[0].input.body, /Mon Oct 19: order MG996R/);
    assert.ok(m.docs[0].input.tags.includes("plan-document"));
    assert.equal(JSON.parse(s.meta_json).report.kind, "plan");
    const posted = db.prepare(`SELECT content FROM chat_messages WHERE session_id='chat-9'`).all();
    assert.match(posted[0].content, /Plan document: doc\.md \/api\/artifact\/dtu_doc_1\/download/);
  });

  it("a failed write-up falls back to the normal tick and counts the failure", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: "plan a 2-week build of a desktop robot arm", maxTurns: 40 });
    db.prepare(`UPDATE agent_marathon_sessions SET total_turns = 35 WHERE id = ?`).run(job.jobId);
    let n = 0;
    const brainChat = async () => { n++; return n === 1 ? { ok: true, text: "too short" } : { ok: true, text: "Progress notes: still going." }; };
    const r = await tickMarathon({ db, sessionId: job.jobId, runMacro: fakeMacros(), lensActions: new Map(), opts: { tickTurns: 1, brainChat } });
    assert.equal(r.status, "running");
    assert.equal(JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json).finalStepFailures, 1);
  });
});
