// server/tests/inc-140-research-report-body.test.js
//
// INC-140: a background research report kept only "Sources" plus progress
// notes. reportBody() split the final answer on "---" rules and kept only the
// last part, so a report with "---" between sections lost its summary and
// findings.
//
// Run:
//   cd server && NODE_ENV=test nice -n 10 node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/inc-140-research-report-body.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { startLongTask } from "../lib/long-task.js";
import { reportBody, createResearchReport } from "../lib/research-mode.js";

// Shape of the live INC-140 answer: sections split by --- and a trailing
// "Progress notes:" block in the same part as the sources.
const SUMMARY = "For a small e-bike, LFP is the better default: it lasts 2000+ cycles, tolerates heat, and is far less prone to thermal runaway. NMC wins only when weight and range per kilo matter most.";
const FINDINGS = "LFP cells store about 90-160 Wh/kg while NMC reaches 150-270 Wh/kg, so an NMC pack of the same capacity is lighter. LFP keeps 80% capacity after roughly 2000-4000 cycles versus 1000-2000 for NMC.";
const RECOMMEND = "Pick LFP for commuting and cargo bikes where the extra kilogram does not matter; pick NMC for a light folding bike where every gram counts.";
const ANSWER = [
  "# Research Report: Battery Chemistry for a Small E-Bike (LFP vs NMC)",
  "",
  "## Summary",
  "",
  SUMMARY,
  "",
  "---",
  "",
  "## 1. Energy density and weight",
  "",
  FINDINGS,
  "",
  "---",
  "",
  "## 4. Recommendation",
  "",
  RECOMMEND,
  "",
  "---",
  "",
  "## 5. Sources",
  "- Wikipedia contributors: *Lithium-ion battery* — [Wikipedia](https://en.wikipedia.org/wiki/Lithium-ion%20battery)",
  "",
  "Progress notes:",
  "- What was found so far: specs and tradeoffs between LFP and NMC.",
  "- What is left to do: nothing, all subgoals complete.",
  "",
  "[TASK_COMPLETE]",
].join("\n");

describe("INC-140 reportBody keeps the whole report", () => {
  it("keeps summary, findings, recommendation and sources across --- rules", () => {
    const body = reportBody(ANSWER);
    assert.match(body, /^# Research Report: Battery Chemistry/);
    assert.ok(body.includes(SUMMARY), "summary kept");
    assert.ok(body.includes(FINDINGS), "findings kept");
    assert.ok(body.includes(RECOMMEND), "recommendation kept");
    assert.match(body, /## 5\. Sources/);
  });

  it("strips progress notes and loop markers", () => {
    const body = reportBody(ANSWER);
    assert.doesNotMatch(body, /Progress notes/i);
    assert.doesNotMatch(body, /What is left to do/);
    assert.doesNotMatch(body, /TASK_COMPLETE/);
  });

  it("drops a leading notes block before the report (old contract kept)", () => {
    const long = "# Report\n" + "MG996R is the pick. ".repeat(30);
    assert.equal(reportBody(`Progress notes: stuff\n---\n${long}\n[TASK_COMPLETE]`), long.trim());
    assert.equal(reportBody(`**Progress notes:** stuff\n\n---\n\n${long}`), long.trim());
    assert.equal(reportBody("Short answer.\n[TASK_COMPLETE]"), "Short answer.");
  });

  it("cuts bold and heading notes sections too", () => {
    assert.equal(reportBody("## Findings\nLFP wins.\n\n**Progress notes:**\n- done"), "## Findings\nLFP wins.");
    assert.equal(reportBody("## Findings\nLFP wins.\n\n## Progress notes\n- done"), "## Findings\nLFP wins.");
  });

  it("does not cut prose that merely starts with the words", () => {
    const t = "## Method\nProgress notes are kept per turn by the job runner.\nLFP wins.";
    assert.equal(reportBody(t), t);
  });

  it("a notes-only answer (job stopped early) keeps the notes", () => {
    const t = "Progress notes:\n- found LFP cycle life data\n- left: NMC pricing";
    assert.equal(reportBody(t), t);
  });

  it("collapses markers-only input to empty", () => {
    assert.equal(reportBody("[TASK_COMPLETE]"), "");
    assert.equal(reportBody(""), "");
    assert.equal(reportBody(null), "");
  });
});

function setup() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT, created_at INTEGER, updated_at INTEGER, msg_count INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  db.exec(`CREATE TABLE goal_nodes (id TEXT PRIMARY KEY, tree_id TEXT, parent_id TEXT, title TEXT, status TEXT)`);
  return db;
}

describe("INC-140 createResearchReport saves the body", () => {
  it("the saved document has the summary and findings, not just sources + notes", async () => {
    const db = setup();
    const job = startLongTask(db, { userId: "u1", goal: "Write me a research report on the best battery chemistry for a small e-bike, comparing LFP and NMC with sources." });
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    meta.citations = [{ id: "dtu_p", url: "https://en.wikipedia.org/wiki/Lithium-ion%20battery", title: "Lithium-ion battery - Wikipedia", kind: "page", text: "LFP 90-160 Wh/kg. NMC 150-270 Wh/kg. 2000 cycles." }];
    db.prepare(`UPDATE agent_marathon_sessions SET meta_json=?, status='completed' WHERE id=?`).run(JSON.stringify(meta), job.jobId);
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 5, 'assistant', ?)`).run(job.jobId, ANSWER);
    const docs = [];
    const runMacro = async (domain, name, input) => {
      if (domain === "document" && name === "create") { docs.push(input); return { ok: true, dtuId: "dtu_doc_1", filename: "r.md", downloadUrl: "/api/artifact/dtu_doc_1/download", sizeBytes: input.body.length }; }
      return { ok: true };
    };
    const rep = await createResearchReport(db, job.jobId, runMacro);
    assert.ok(rep, "report created");
    assert.equal(docs.length, 1);
    const body = docs[0].body;
    assert.ok(body.includes(SUMMARY), "summary in saved report");
    assert.ok(body.includes("## 1. Energy density and weight"), "findings section in saved report");
    assert.ok(body.includes(RECOMMEND), "recommendation in saved report");
    assert.match(body, /## Sources \(pages read\)/);
    assert.doesNotMatch(body, /Progress notes/i);
    // The report body comes before the appended sources list.
    assert.ok(body.indexOf(SUMMARY) < body.indexOf("## Sources (pages read)"));
  });
});
