// server/tests/inc-142-research-report-body.test.js
//
// INC-142 regression: (1) reportBody must drop a leading "Progress notes:" label
// and agent narration when the model labels its final answer that way, collapse
// repeated "Final report:" labels, and still keep notes-only answers. (2)
// claimCheck must not append " (unverified)" inside a markdown link URL,
// autolink, or bare URL.
//
// Run:
//   cd server && NODE_ENV=test nice -n 10 node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/inc-142-research-report-body.test.js

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import { up as upMig394 } from "../migrations/394_agent_marathon_tool_log.js";
import { startLongTask } from "../lib/long-task.js";
import { reportBody, claimCheck, createResearchReport } from "../lib/research-mode.js";

const REPORT_TITLE = "# Best Budget 3D Printers Under $300";
const COMPARISON = "| Printer | Price |\n|---|---|\n| Ender-3 V3 SE | $300 |\n| Anycubic Kobra 2 | $270 |";
const RECOMMENDATION = "For most buyers, the Ender-3 V3 SE is the best balance of price, community support, and print quality.";
const SOURCES = "- [All3DP guide](https://example.com/3dp-guide)";

function mislabeledReportAnswer() {
  return [
    "Progress notes: I have identified and verified the best budget 3D printers under $300 thoroughly. I now manually construct a comparison table.",
    "",
    "Final report:",
    REPORT_TITLE,
    "",
    "## Comparison",
    "",
    COMPARISON,
    "",
    "Final report:",
    "## Recommendation",
    "",
    RECOMMENDATION,
    "",
    "Final report:",
    "## Sources",
    SOURCES,
    "",
    "Progress notes:",
    "- All subgoals complete.",
    "",
    "[TASK_COMPLETE]",
  ].join("\n");
}

describe("INC-142 reportBody cleans mislabeled final answers", () => {
  it("strips a leading 'Progress notes:' label and agent narration before the real report", () => {
    const body = reportBody(mislabeledReportAnswer());
    assert.doesNotMatch(body, /Progress notes/i);
    assert.doesNotMatch(body, /I have identified and verified/i);
    assert.doesNotMatch(body, /I now manually construct/i);
    assert.ok(body.includes(REPORT_TITLE), "report title kept");
    assert.ok(body.includes(COMPARISON), "comparison table kept");
    assert.ok(body.includes(RECOMMENDATION), "recommendation kept");
    assert.ok(body.includes(SOURCES), "sources kept");
  });

  it("collapses repeated 'Final report:' labels", () => {
    const body = reportBody(mislabeledReportAnswer());
    assert.doesNotMatch(body, /Final report/i);
  });

  it("keeps a notes-only answer (job stopped early)", () => {
    const t = "Progress notes:\n- found LFP cycle life data\n- left: NMC pricing";
    assert.equal(reportBody(t), t);
  });

  it("still drops a leading notes block separated by --- from the report", () => {
    const long = "# Report\n" + "MG996R is the pick. ".repeat(30);
    assert.equal(reportBody(`Progress notes: stuff\n---\n${long}\n[TASK_COMPLETE]`), long.trim());
  });

  it("handles a 'Final report:' label without a preceding progress-notes block", () => {
    const t = ["Final report:", REPORT_TITLE, "", COMPARISON, "", RECOMMENDATION].join("\n");
    const body = reportBody(t);
    assert.doesNotMatch(body, /Final report/i);
    assert.ok(body.includes(REPORT_TITLE));
    assert.ok(body.includes(COMPARISON));
  });
});

describe("INC-142 claimCheck never hedges inside links", () => {
  it("skips a spec inside a markdown link URL", () => {
    // A URL token like "3g" used to become "3g (unverified)", breaking the link.
    const body = "Read more at [Example](https://example.com/articles/CBMiY3g1QVg3).";
    const result = claimCheck(body, []);
    assert.doesNotMatch(result.text, /unverified/);
    assert.equal(result.checked, 0);
    assert.ok(result.text.includes("https://example.com/articles/CBMiY3g1QVg3"), "URL stays intact");
  });

  it("skips a spec inside an autolink", () => {
    const body = "See <https://example.com/path/5kg/end>.";
    const result = claimCheck(body, []);
    assert.doesNotMatch(result.text, /unverified/);
    assert.ok(result.text.includes("https://example.com/path/5kg/end"), "autolink stays intact");
  });

  it("skips a spec inside a bare URL", () => {
    const body = "Source: https://example.com/review/250W/printers";
    const result = claimCheck(body, []);
    assert.doesNotMatch(result.text, /unverified/);
    assert.ok(result.text.includes("https://example.com/review/250W/printers"), "bare URL stays intact");
  });

  it("still hedges an unsupported claim outside of a link", () => {
    const body = "It weighs 5 kg. Source: [specs](https://example.com/specs).";
    const result = claimCheck(body, []);
    assert.match(result.text, /5 kg \(unverified\)/);
    assert.ok(result.text.includes("[specs](https://example.com/specs)"), "link stays intact");
  });

  it("does not tag a source list line", () => {
    const body = "1. [All3DP](https://example.com/3dp-250W)";
    const result = claimCheck(body, []);
    assert.doesNotMatch(result.text, /unverified/);
  });
});

function setupDb() {
  const db = new Database(":memory:");
  upMig171(db); upMig379(db); upMig387(db); upMig394(db);
  db.exec(`CREATE TABLE chat_sessions (session_id TEXT PRIMARY KEY, owner_id TEXT, title TEXT, last_lens TEXT, created_at INTEGER, updated_at INTEGER, msg_count INTEGER DEFAULT 0)`);
  db.exec(`CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, role TEXT, content TEXT, ts INTEGER, meta_json TEXT)`);
  db.exec(`CREATE TABLE goal_nodes (id TEXT PRIMARY KEY, tree_id TEXT, parent_id TEXT, title TEXT, status TEXT)`);
  return db;
}

describe("INC-142 createResearchReport saves a clean report", () => {
  it("writes the document body without progress notes or final-report labels", async () => {
    const db = setupDb();
    const job = startLongTask(db, { userId: "u1", goal: "Research the best budget 3D printers under $300 thoroughly and write me a short report." });
    const meta = JSON.parse(db.prepare(`SELECT meta_json FROM agent_marathon_sessions WHERE id=?`).get(job.jobId).meta_json);
    meta.citations = [{ id: "dtu_p", url: "https://example.com/3dp-guide", title: "Best budget 3D printers under $300", kind: "page", text: "Ender-3 V3 SE $300. Anycubic Kobra 2 $270." }];
    db.prepare(`UPDATE agent_marathon_sessions SET meta_json=?, status='completed' WHERE id=?`).run(JSON.stringify(meta), job.jobId);
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 5, 'assistant', ?)`).run(job.jobId, mislabeledReportAnswer());
    const docs = [];
    const runMacro = async (domain, name, input) => {
      if (domain === "document" && name === "create") { docs.push(input); return { ok: true, dtuId: "dtu_doc_inc142", filename: "r.md", downloadUrl: "/api/artifact/dtu_doc_inc142/download", sizeBytes: input.body.length }; }
      return { ok: true };
    };
    const rep = await createResearchReport(db, job.jobId, runMacro);
    assert.ok(rep, "report created");
    assert.equal(docs.length, 1);
    const body = docs[0].body;
    assert.doesNotMatch(body, /Progress notes/i);
    assert.doesNotMatch(body, /Final report/i);
    assert.doesNotMatch(body, /I now manually construct/i);
    assert.ok(body.includes(REPORT_TITLE));
    assert.ok(body.includes(COMPARISON));
    assert.ok(body.includes(RECOMMENDATION));
    assert.ok(body.includes("## Sources (pages read)"));
  });
});
