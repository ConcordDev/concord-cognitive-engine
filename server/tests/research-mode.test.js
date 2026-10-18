// server/tests/research-mode.test.js
//
// Research long tasks: sources → citation DTUs, finished job → report file.
// In-memory DB, scripted brain, fake macros (no network).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { tickMarathon } from "../lib/agent-marathon.js";
import { startLongTask, longTaskStatus, formatLongTaskStatus } from "../lib/long-task.js";
import { citationsFromToolCalls, saveCitationDtus, reportBody, cleanExcerpt } from "../lib/research-mode.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT, created_at INTEGER, updated_at INTEGER, msg_count INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  db.exec(`CREATE TABLE initiatives (id TEXT PRIMARY KEY, user_id TEXT, trigger_type TEXT, priority TEXT, message TEXT, status TEXT, metadata_json TEXT, created_at INTEGER)`);
  return db;
}

const PAGE = "Skip to content\nMenu\nThe MG996R is a metal-gear servo with 11 kg-cm of stall torque at 6 V and 0.14 s/60 degrees.\nIt weighs 55 g and is the usual pick for the shoulder of small robot arms that lift under 300 g.\nFooter";
const SEARCH = JSON.stringify({ results: [
  { title: "MG90S review", url: "https://example.com/mg90s?utm_source=x", snippet: "MG90S micro servo: 2.2 kg-cm at 4.8 V, metal gears, 13.4 g." },
  { title: "No snippet", url: "https://example.com/empty", snippet: "" },
] });

function fakeMacros() {
  const dtus = [];
  const docs = [];
  const fn = async (domain, name, input, ctx) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    if (domain === "dtu" && name === "create") { dtus.push({ input, ctx }); return { ok: true, id: `dtu_c${dtus.length}` }; }
    if (domain === "document" && name === "create") { docs.push({ input, ctx }); return { ok: true, dtuId: "dtu_doc_1", filename: "research-report.md", downloadUrl: "/api/artifact/dtu_doc_1/download", sizeBytes: input.body.length }; }
    if (domain === "expert_mode" && name === "web_search") return { ok: true, query: input.query, results: JSON.parse(SEARCH).results };
    return { ok: true };
  };
  fn.dtus = dtus; fn.docs = docs;
  return fn;
}

describe("research-mode helpers", () => {
  it("pulls page and search sources out of tool calls", () => {
    const c = citationsFromToolCalls([
      { tool: "browse_url", ok: true, url: "https://components101.com/mg996r#specs", title: "MG996R datasheet", text: PAGE },
      { tool: "web_search", ok: true, result: SEARCH },
      { tool: "browse_url", ok: false, url: "https://x.com/fail" },
    ]);
    assert.equal(c.length, 2);
    assert.equal(c[0].url, "https://components101.com/mg996r");
    assert.match(c[0].excerpt, /11 kg-cm/);
    assert.doesNotMatch(c[0].excerpt, /Skip to content/);
    assert.equal(c[1].url, "https://example.com/mg90s");
    assert.equal(cleanExcerpt("short\nnav"), "");
  });

  it("reportBody keeps the deliverable after a notes block", () => {
    const long = "# Report\n" + "MG996R is the pick. ".repeat(30);
    assert.equal(reportBody(`Progress notes: stuff\n---\n${long}\n[TASK_COMPLETE]`), long.trim());
    assert.equal(reportBody("Short answer.\n[TASK_COMPLETE]"), "Short answer.");
  });

  it("saves each source once, privately, owned by the job's user", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: "research servos and write me a report" });
    const session = db.prepare(`SELECT * FROM agent_marathon_sessions WHERE id=?`).get(job.jobId);
    const m = fakeMacros();
    const calls = [{ tool: "browse_url", ok: true, url: "https://components101.com/mg996r", title: "MG996R datasheet", text: PAGE }, { tool: "web_search", ok: true, result: SEARCH }];
    const a = await saveCitationDtus(db, session, calls, m);
    const b = await saveCitationDtus(db, session, calls, m);
    assert.equal(a.length, 2);
    assert.equal(b.length, 0, "deduped by URL");
    assert.equal(m.dtus[0].input.visibility, "private");
    assert.equal(m.dtus[0].ctx.actor.userId, "u1");
    assert.ok(m.dtus[0].input.tags.includes("citation"));
    assert.equal(m.dtus[0].input.meta.url, "https://components101.com/mg996r");
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    assert.deepEqual(meta.citationDtuIds, ["dtu_c1", "dtu_c2"]);
  });
});

describe("a research job end to end (scripted)", () => {
  it("saves citations while it runs, then makes a report and posts it to the chat", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: "research the best small hobby servos for a robot arm and write me a report", origin: { surface: "chat", sessionId: "chat-1" } });
    const m = fakeMacros();
    const replies = [
      `[TOOL_CALL: {"tool":"web_search","params":{"query":"MG90S servo review"}}]`,
      `Progress notes: MG90S is 2.2 kg-cm (https://example.com/mg90s). Left: shoulder servo.`,
      `Progress notes: done.\n---\n# Best small hobby servos for a robot arm\n\n${"MG996R for the shoulder, MG90S for the wrist (https://example.com/mg90s). ".repeat(10)}\n[TASK_COMPLETE]`,
    ];
    const brainChat = async () => ({ ok: true, text: replies.shift() ?? "Progress notes: idle.", provider: "t", model: "t" });
    await tickMarathon({ db, sessionId: job.jobId, runMacro: m, lensActions: new Map(), opts: { tickTurns: 2, brainChat } });
    let meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    assert.equal(meta.citationDtuIds?.length, 1, "the search hit with a snippet became a citation");
    await tickMarathon({ db, sessionId: job.jobId, runMacro: m, lensActions: new Map(), opts: { tickTurns: 2, brainChat } });
    const s = db.prepare(`SELECT status FROM agent_marathon_sessions WHERE id=?`).get(job.jobId);
    assert.equal(s.status, "completed");
    assert.equal(m.docs.length, 1);
    assert.equal(m.docs[0].input.format, "md");
    assert.match(m.docs[0].input.body, /# Best small hobby servos/);
    // The search hit is saved as a lead but never cited: no page was read.
    assert.match(m.docs[0].input.body, /## Sources\n\nNo web pages were successfully read/);
    assert.doesNotMatch(m.docs[0].input.body, /citation DTU dtu_c1/);
    assert.doesNotMatch(m.docs[0].input.body, /Progress notes/);
    meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    assert.equal(meta.report.downloadUrl, "/api/artifact/dtu_doc_1/download");
    const posted = db.prepare(`SELECT content FROM chat_messages WHERE session_id='chat-1'`).all();
    assert.equal(posted.length, 1);
    assert.match(posted[0].content, /Report: research-report\.md \/api\/artifact\/dtu_doc_1\/download/);
    assert.match(posted[0].content, /Saved 1 citation DTU/);
    assert.match(formatLongTaskStatus(longTaskStatus(db, "u1", job.jobId)), /1 citation DTU/);
  });
});
