// server/tests/agent-marathon-turn-compaction.test.js
//
// Bounds agent-marathon.js's turn-history growth (grounding-audit gap,
// 2026-07-24, migration 387). tickMarathon used to feed EVERY prior turn in
// agent_marathon_turns into the brain call with no cap — a session running
// hundreds of turns over days would blow the model's context window well
// before hitting max_turns. This mirrors conversation-memory.js's rolling-
// window pattern: once raw turn count crosses MARATHON_HISTORY_THRESHOLD,
// the oldest MARATHON_COMPRESSION_BATCH turns fold into one deterministic
// rolling checkpoint turn, leaving a fixed-size verbatim tail.
//
// Run: node --test server/tests/agent-marathon-turn-compaction.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upMig171 } from "../migrations/171_agent_marathon_sessions.js";
import { up as upMig379 } from "../migrations/379_agent_marathon_governance.js";
import { up as upMig387 } from "../migrations/387_agent_marathon_turn_compaction.js";
import {
  startMarathon, tickMarathon, getMarathon,
  buildMarathonHistory, compressMarathonHistory,
  MARATHON_HISTORY_THRESHOLD, MARATHON_COMPRESSION_BATCH,
  MAX_CHECKPOINT_EXCERPTS,
} from "../lib/agent-marathon.js";

function setup() {
  const db = new Database(":memory:");
  upMig171(db);
  upMig379(db);
  upMig387(db);
  return db;
}

/** Insert `count` alternating assistant/user turns directly, with
 *  distinguishable, greppable content so tests can prove compaction is
 *  derived from REAL turn content, not fabricated. Turn indices continue
 *  from `startIndex`. Returns the list of inserted { turn_index, role,
 *  content } rows in order. */
function seedTurns(db, sessionId, count, startIndex) {
  const rows = [];
  for (let i = 0; i < count; i++) {
    const turnIndex = startIndex + i;
    const role = i % 2 === 0 ? "assistant" : "user";
    const content = `turn-${turnIndex}-${role}-uniquemarker${turnIndex}`;
    db.prepare(`
      INSERT INTO agent_marathon_turns (session_id, turn_index, role, content)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, turnIndex, role, content);
    rows.push({ turn_index: turnIndex, role, content });
  }
  return rows;
}

function noopHarvest(real) {
  return async (domain, name, input, ctx) => {
    if (domain === "chat" && name === "harvest") return { ok: true, dtus: [] };
    return real(domain, name, input, ctx);
  };
}

describe("migration 387 — is_checkpoint column", () => {
  it("adds is_checkpoint (default 0) without disturbing existing columns", () => {
    const db = setup();
    const cols = db.prepare(`PRAGMA table_info(agent_marathon_turns)`).all();
    const col = cols.find((c) => c.name === "is_checkpoint");
    assert.ok(col, "is_checkpoint column missing");
    assert.equal(col.notnull, 1);
    assert.equal(col.dflt_value, "0");
  });

  it("up() is idempotent (safe to run twice)", () => {
    const db = setup();
    assert.doesNotThrow(() => upMig387(db));
  });

  it("up() no-ops gracefully on a minimal build without the marathon table", () => {
    const db = new Database(":memory:");
    assert.doesNotThrow(() => upMig387(db));
  });
});

describe("(a) below-threshold sessions are untouched — byte-identical history", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("buildMarathonHistory matches the old raw 'every prior turn' query when under threshold", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    // startMarathon already seeded turn_index 0. Add turns 1..29 (30 total, well under 50).
    seedTurns(db, sessionId, 29, 1);

    const oldStyleRows = db.prepare(`
      SELECT role, content FROM agent_marathon_turns
      WHERE session_id = ? AND role IN ('user','assistant')
      ORDER BY turn_index ASC
    `).all(sessionId);
    const expectedHistory = oldStyleRows.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
    const expectedLastMessage = oldStyleRows[oldStyleRows.length - 1].content;

    const { history, lastMessage } = buildMarathonHistory(db, sessionId, "fallback");

    assert.deepEqual(history, expectedHistory);
    assert.equal(lastMessage, expectedLastMessage);

    // No checkpoint was created.
    const checkpointCount = db.prepare(`
      SELECT COUNT(*) AS n FROM agent_marathon_turns WHERE session_id = ? AND is_checkpoint = 1
    `).get(sessionId).n;
    assert.equal(checkpointCount, 0);
  });

  it("compressMarathonHistory reports below_threshold and does nothing", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal" });
    seedTurns(db, sessionId, 10, 1);
    const r = compressMarathonHistory(db, sessionId);
    assert.equal(r.ok, true);
    assert.equal(r.compressed, false);
    assert.equal(r.reason, "below_threshold");
  });

  it("exactly AT the threshold (not exceeding it) does not compress", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal" });
    // 1 (goal turn) + 49 = 50 total user/assistant turns == threshold exactly.
    seedTurns(db, sessionId, MARATHON_HISTORY_THRESHOLD - 1, 1);
    const r = compressMarathonHistory(db, sessionId);
    assert.equal(r.compressed, false);
  });
});

describe("(b) above-threshold sessions compress — real content, not fabricated", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("folds the oldest batch into one checkpoint turn once uncovered count exceeds threshold", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    // Total raw turns after seeding: 1 (goal) + 60 = 61, well above 50.
    seedTurns(db, sessionId, 60, 1);

    const r = compressMarathonHistory(db, sessionId);
    assert.equal(r.ok, true);
    assert.equal(r.compressed, true);
    assert.equal(r.turnsCompacted, MARATHON_COMPRESSION_BATCH);

    // Exactly one checkpoint row exists.
    const checkpoints = db.prepare(`
      SELECT * FROM agent_marathon_turns WHERE session_id = ? AND is_checkpoint = 1
    `).all(sessionId);
    assert.equal(checkpoints.length, 1);

    // The checkpoint's rendered content is built from REAL compacted turn
    // content, not invented — the goal turn (turn_index 0) and the first
    // few seeded turns' unique markers must appear verbatim in the excerpts.
    const cp = checkpoints[0];
    assert.match(cp.content, /goal turn zero/);
    assert.match(cp.content, /uniquemarker1\b/);

    // The state JSON is well-formed and internally consistent.
    const state = JSON.parse(cp.tool_calls_json);
    assert.equal(state.checkpoint, true);
    assert.equal(state.totalTurnsCompacted, MARATHON_COMPRESSION_BATCH);
    // Covers through the last compacted turn: goal(0) + 19 more raw turns = turn_index 19.
    assert.equal(state.coversThroughTurnIndex, 19);

    // None of the checkpoint's excerpts contain content from turns that were
    // NOT part of the compacted batch (e.g. the last seeded turn, index 60).
    assert.doesNotMatch(cp.content, /uniquemarker60\b/);
  });

  it("buildMarathonHistory returns far fewer entries than the raw turn count, with the checkpoint first", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    seedTurns(db, sessionId, 60, 1);

    const rawCount = db.prepare(`
      SELECT COUNT(*) AS n FROM agent_marathon_turns WHERE session_id = ? AND role IN ('user','assistant')
    `).get(sessionId).n;

    const { history, lastMessage } = buildMarathonHistory(db, sessionId, "fallback");

    // history + the 1 lastMessage turn should be MUCH smaller than rawCount.
    assert.ok(history.length + 1 < rawCount, `expected compaction to shrink turn count (history=${history.length}, raw=${rawCount})`);
    assert.equal(history[0].role, "system");
    assert.match(history[0].content, /Marathon checkpoint/);
    // turn_index 60 is the 60th seeded turn (i=59, odd) → role 'user'.
    assert.equal(lastMessage, `turn-60-user-uniquemarker60`);
  });
});

describe("(c) the most recent turns always stay verbatim in the tail", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("every raw turn after the compacted batch is present, in order, byte-for-byte", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    const seeded = seedTurns(db, sessionId, 60, 1);

    const { history } = buildMarathonHistory(db, sessionId, "fallback");
    // history = [checkpoint, ...tail-minus-last]. The raw tail turns are
    // seeded[19..] (turn_index 20..60), i.e. everything after coversThroughTurnIndex=19.
    const expectedTail = seeded.slice(19); // turn_index 20..60
    const tailInHistoryPlusLast = history.slice(1); // drop the checkpoint entry
    // buildMarathonHistory's `history` excludes the very last turn (used as
    // lastMessage separately), so compare against expectedTail minus its last entry.
    const expectedTailInHistory = expectedTail.slice(0, -1).map((t) => ({ role: t.role, content: t.content }));
    assert.deepEqual(tailInHistoryPlusLast, expectedTailInHistory);
  });

  it("a second compaction pass advances coverage and keeps exactly one checkpoint row (bounded growth)", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    seedTurns(db, sessionId, 60, 1);
    compressMarathonHistory(db, sessionId); // first pass: covers through turn 19

    // Age more turns past the threshold again.
    seedTurns(db, sessionId, 60, 61); // turn_index 61..120
    const r2 = compressMarathonHistory(db, sessionId);
    assert.equal(r2.compressed, true);
    assert.equal(r2.coversThroughTurnIndex, 39); // 19 + 20 more

    const checkpoints = db.prepare(`
      SELECT * FROM agent_marathon_turns WHERE session_id = ? AND is_checkpoint = 1
    `).all(sessionId);
    assert.equal(checkpoints.length, 1, "re-compaction must UPDATE the single checkpoint row, never insert a second one");

    const state = JSON.parse(checkpoints[0].tool_calls_json);
    assert.equal(state.totalTurnsCompacted, MARATHON_COMPRESSION_BATCH * 2);
    // Excerpts never grow past the hard cap no matter how many passes run.
    assert.ok(state.excerpts.length <= MAX_CHECKPOINT_EXCERPTS);
  });

  it("many repeated compaction passes never let the checkpoint's own size grow unbounded", () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    let nextIndex = 1;
    for (let pass = 0; pass < 10; pass++) {
      seedTurns(db, sessionId, 60, nextIndex);
      nextIndex += 60;
      compressMarathonHistory(db, sessionId);
    }
    const cp = db.prepare(`
      SELECT * FROM agent_marathon_turns WHERE session_id = ? AND is_checkpoint = 1
    `).get(sessionId);
    assert.ok(cp, "checkpoint must exist after repeated compaction");
    const state = JSON.parse(cp.tool_calls_json);
    assert.ok(state.excerpts.length <= MAX_CHECKPOINT_EXCERPTS, "excerpts must stay bounded across many passes");
    assert.ok(cp.content.length <= 4000, "rendered checkpoint content must stay bounded across many passes");
    // Still exactly one checkpoint row — never a second, unbounded log of them.
    const count = db.prepare(`SELECT COUNT(*) AS n FROM agent_marathon_turns WHERE session_id = ? AND is_checkpoint = 1`).get(sessionId).n;
    assert.equal(count, 1);
  });
});

describe("end-to-end through tickMarathon — the brain call itself receives bounded history", () => {
  let db;
  beforeEach(() => { db = setup(); });
  afterEach(() => { db.close(); });

  it("a long-running session's tick sends a bounded message array to the brain, not the full raw transcript", async () => {
    const { sessionId } = startMarathon(db, "alice", { goal: "goal turn zero" });
    seedTurns(db, sessionId, 70, 1); // well above threshold

    const rawTurnCount = db.prepare(`
      SELECT COUNT(*) AS n FROM agent_marathon_turns WHERE session_id = ? AND role IN ('user','assistant')
    `).get(sessionId).n;

    let capturedMessages = null;
    const brain = async ({ messages }) => {
      capturedMessages = messages;
      return { ok: true, text: "done.", provider: "test", model: "test", tokensIn: 1, tokensOut: 1 };
    };
    const runMacro = noopHarvest(async () => ({ ok: true }));

    const r = await tickMarathon({
      db, sessionId, runMacro, lensActions: new Map(),
      opts: { brainChat: brain, tickTurns: 5 },
    });

    assert.equal(r.ok, true);
    assert.ok(capturedMessages, "brain must have been called");
    // messages = [system tool-schema prompt, ...history, {role:'user', last message}]
    assert.ok(capturedMessages.length < rawTurnCount + 2, `expected bounded messages (got ${capturedMessages.length} vs raw ${rawTurnCount})`);
    assert.ok(capturedMessages.some((m) => m.role === "system" && /Marathon checkpoint/.test(m.content)));
  });
});

describe("(d) governance envelope (mig 379) is completely unaffected by compaction", () => {
  it("a marathon with an allowlist + budget cap still enforces both after many turns are compacted", async () => {
    const db = setup();
    // "tools" is web_search's resolved domain (domainForToolCall) — allow it
    // so this test exercises the BUDGET gate specifically, not the domain gate.
    const { sessionId } = startMarathon(db, "alice", { goal: "goal", allowedDomains: ["tools"], budgetCap: 1 });
    seedTurns(db, sessionId, 60, 1); // force compaction to have already happened by tick time

    let realCalls = 0;
    const runMacro = noopHarvest(async () => { realCalls++; return { ok: true, summary: "result" }; });
    const brain = async () => ({
      ok: true,
      text: [
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"a"}}]`,
        `[TOOL_CALL: {"tool":"web_search","params":{"query":"b"}}]`,
      ].join("\n"),
      provider: "test", model: "test", tokensIn: 1, tokensOut: 1,
    });

    const r = await tickMarathon({ db, sessionId, runMacro, lensActions: new Map(), opts: { brainChat: brain, tickTurns: 5 } });
    assert.equal(r.ok, true);
    assert.equal(r.halted, true);
    assert.equal(r.haltReason, "budget_exhausted");
    assert.equal(realCalls, 1, "budget cap of 1 still allows exactly one real call, unaffected by history compaction");
    assert.equal(getMarathon(db, sessionId).budget_spent, 1);
    db.close();
  });
});
