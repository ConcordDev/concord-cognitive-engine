// server/tests/marathon-digest.test.js
//
// Contract tests for lib/marathon-digest.js — a deterministic, non-LLM
// human-legible progress digest for a marathon session (companion to
// agent-marathon.js's compressMarathonHistory, same honesty precedent: a
// pure condensation of real fields, never a fabricated summary).
//
// Pins two things:
//   (a) mechanically — the module's own source contains no reference to
//       any brain/chat client (no import of chat-agent.js/brain-config.js/
//       brain-router.js, no `ctx.llm`, no `brainChat`, no "ollama"). This
//       is a grep-testable assertion, not a comment someone can drift.
//   (b) functionally — the digest's counts/excerpts trace to real
//       agent_marathon_turns rows (tool_calls_json / artifacts_json /
//       content), not invented numbers.
//
// Run: node --test server/tests/marathon-digest.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { startMarathon } from "../lib/agent-marathon.js";
import { buildMarathonDigest } from "../lib/marathon-digest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIGEST_SRC_PATH = path.join(__dirname, "..", "lib", "marathon-digest.js");

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  return db;
}

/** Strip `//`-comment lines so the mechanical check scans only CODE, not
 *  prose. This module's own doc comments legitimately DISCUSS the no-brain-
 *  call invariant by name (e.g. "no import of chat-agent.js") — grepping
 *  raw source (comments included) would self-trip on that explanatory text,
 *  the same false-positive trap CLAUDE.md documents for the UX-polish
 *  grader (a doc comment naming a retired scaffold component retriggers the
 *  detector describing it). The real, load-bearing check is: does the
 *  EXECUTABLE code reference a brain/chat client. */
function stripLineComments(src) {
  return src
    .split("\n")
    .filter((line) => !/^\s*\/\//.test(line))
    .join("\n");
}

describe("marathon-digest.js is mechanically brain-call-free", () => {
  it("its executable code contains no reference to any brain/chat client", () => {
    const code = stripLineComments(readFileSync(DIGEST_SRC_PATH, "utf8"));
    const forbidden = [
      /chat-agent\.js/i,
      /brain-config\.js/i,
      /brain-router\.js/i,
      /runAgentLoop/,
      /brainChat/,
      /ctx\.llm/,
      /\bollama\b/i,
      /BRAIN_CONSCIOUS/,
      /BRAIN_CONFIG/,
    ];
    for (const re of forbidden) {
      assert.doesNotMatch(code, re, `found forbidden brain-related token ${re} in marathon-digest.js's executable code`);
    }
  });

  it("has no import statements at all reaching into lib/chat-agent.js or lib/brain-*", () => {
    const src = readFileSync(DIGEST_SRC_PATH, "utf8");
    const importLines = src.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      assert.doesNotMatch(line, /chat-agent|brain-config|brain-router|brain-service/i, `suspicious import: ${line}`);
    }
  });
});

describe("buildMarathonDigest — input validation", () => {
  it("returns missing_inputs when db or sessionId absent", () => {
    const db = setup();
    assert.equal(buildMarathonDigest(null, "x").ok, false);
    assert.equal(buildMarathonDigest(db, null).ok, false);
  });

  it("returns not_found for an unknown session id", () => {
    const db = setup();
    const r = buildMarathonDigest(db, "nonexistent");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_found");
  });
});

describe("buildMarathonDigest — traces only to real turn fields", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("tallies real tool_calls_json entries across turns", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "ship the feature", title: "Ship It" });
    db.prepare(`
      INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, tool_calls_json, artifacts_json)
      VALUES (?, 1, 'assistant', 'working on it', ?, '[]')
    `).run(sessionId, JSON.stringify([{ tool: "web_search", ok: true }, { tool: "create_dtu", ok: true }]));
    db.prepare(`
      INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, tool_calls_json, artifacts_json)
      VALUES (?, 2, 'assistant', 'made progress', ?, '[]')
    `).run(sessionId, JSON.stringify([{ tool: "web_search", ok: true }]));

    const r = buildMarathonDigest(db, sessionId);
    assert.equal(r.ok, true);
    assert.equal(r.digest.toolCallTotal, 3);
    const webSearch = r.digest.toolCallBreakdown.find((t) => t.tool === "web_search");
    const createDtu = r.digest.toolCallBreakdown.find((t) => t.tool === "create_dtu");
    assert.equal(webSearch.count, 2);
    assert.equal(createDtu.count, 1);
    assert.match(r.text, /web_search×2/);
    assert.match(r.text, /create_dtu×1/);
    assert.match(r.text, /Ship It/);
  });

  it("tallies real artifacts_json entries and their kinds", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "write a report" });
    db.prepare(`
      INSERT INTO agent_marathon_turns (session_id, turn_index, role, content, tool_calls_json, artifacts_json)
      VALUES (?, 1, 'assistant', 'draft one', '[]', ?)
    `).run(sessionId, JSON.stringify([{ kind: "dtu", id: "d1" }, { kind: "image", id: "i1" }]));

    const r = buildMarathonDigest(db, sessionId);
    assert.equal(r.digest.artifactTotal, 2);
    const dtuKind = r.digest.artifactBreakdown.find((a) => a.kind === "dtu");
    assert.equal(dtuKind.count, 1);
    assert.match(r.text, /dtu×1/);
    assert.match(r.text, /image×1/);
  });

  it("last assistant excerpt is the REAL most-recent assistant content, not invented text", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal text" });
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 1, 'assistant', 'first update uniquemarkerA')`).run(sessionId);
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 2, 'user', 'tool result')`).run(sessionId);
    db.prepare(`INSERT INTO agent_marathon_turns (session_id, turn_index, role, content) VALUES (?, 3, 'assistant', 'second update uniquemarkerB')`).run(sessionId);

    const r = buildMarathonDigest(db, sessionId);
    assert.equal(r.digest.lastAssistantTurnIndex, 3);
    assert.match(r.digest.lastAssistantExcerpt, /uniquemarkerB/);
    assert.doesNotMatch(r.digest.lastAssistantExcerpt, /uniquemarkerA/);
    assert.match(r.text, /uniquemarkerB/);
  });

  it("reports zero tool calls / artifacts honestly when none exist", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal" });
    const r = buildMarathonDigest(db, sessionId);
    assert.equal(r.digest.toolCallTotal, 0);
    assert.equal(r.digest.artifactTotal, 0);
    assert.match(r.text, /none recorded yet/);
  });

  it("total/max turns and status come straight from the session row", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal", maxTurns: 50 });
    const r = buildMarathonDigest(db, sessionId);
    assert.equal(r.digest.status, "pending");
    assert.equal(r.digest.maxTurns, 50);
    assert.match(r.text, /pending/);
  });
});
