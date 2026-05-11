// server/tests/expert-mode.test.js
//
// Sprint 10B+C acceptance — expert mode + revolving-door DTU pull.
//
// Acceptance shape:
//   1. gatherSourcesForQuery pulls public/global DTUs even when the
//      caller is a free-tier user who didn't mint them.
//   2. A frontier-tier-minted DTU (anthropic/claude-opus-4-7) appears
//      in a free-tier user's search results when relevant. THIS IS
//      THE REVOLVING DOOR.
//   3. The user's own private DTUs are included when includeUserPrivate.
//   4. Strangers' private DTUs are NEVER surfaced.
//   5. extractCitationIndices parses [1] [2, 3] [4,5,6] correctly.
//   6. composeExpertMessages includes provenance hints in the source
//      block (so the brain can mention "minted by Claude 4.5" if it
//      chooses to).

import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  gatherSourcesForQuery, composeExpertMessages,
  extractCitationIndices, EXPERT_MODE_CONSTANTS,
} from "../lib/expert-mode.js";

import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";

function setup() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      creator_id TEXT,
      scope TEXT NOT NULL DEFAULT 'personal',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  upMig170(db); // adds minted_by_provider + minted_by_model columns
  return db;
}

function insertDtu(db, row) {
  db.prepare(`
    INSERT INTO dtus
      (id, title, content, creator_id, scope, minted_by_provider, minted_by_model)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.title, row.content,
    row.creator_id || null,
    row.scope || "personal",
    row.minted_by_provider || null,
    row.minted_by_model || null,
  );
}

test("revolving door — frontier-tier-minted public DTUs surface to free-tier users", () => {
  const db = setup();
  // Power user "claudia" with Claude API key minted a high-quality public DTU.
  insertDtu(db, {
    id: "dtu_claude_minted",
    title: "Refractory steel alloy melt-cycle calibration",
    content: "Detailed analysis of steel refractory melt cycles, calibration tables.",
    creator_id: "claudia",
    scope: "public",
    minted_by_provider: "anthropic",
    minted_by_model: "claude-opus-4-7",
  });
  // Free-tier user "bob" asks about steel calibration.
  const sources = gatherSourcesForQuery(db, {
    query: "How does steel refractory calibration work?",
    userId: "bob",
  });
  assert.ok(sources.length >= 1, "should find at least 1 source");
  const claudeMinted = sources.find(s => s.id === "dtu_claude_minted");
  assert.ok(claudeMinted, "Claude-minted public DTU must appear in free-tier user's results");
  assert.equal(claudeMinted.minted_by_provider, "anthropic");
  assert.equal(claudeMinted.minted_by_model, "claude-opus-4-7");
});

test("revolving door — strangers' PRIVATE DTUs are NEVER surfaced", () => {
  const db = setup();
  insertDtu(db, {
    id: "dtu_alice_private",
    title: "Refractory steel alloy melt cycle",
    content: "alice's private notes on steel",
    creator_id: "alice",
    scope: "personal",
  });
  const sources = gatherSourcesForQuery(db, {
    query: "Refractory steel alloy melt cycle",
    userId: "bob",
  });
  assert.equal(sources.length, 0, "bob must NOT see alice's private DTU");
});

test("user's OWN private DTUs are surfaced when includeUserPrivate=true (default)", () => {
  const db = setup();
  insertDtu(db, {
    id: "dtu_bob_private",
    title: "Refractory steel alloy melt cycle",
    content: "bob's own private steel notes",
    creator_id: "bob",
    scope: "personal",
  });
  const sources = gatherSourcesForQuery(db, {
    query: "Refractory steel alloy",
    userId: "bob",
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].id, "dtu_bob_private");
});

test("includeUserPrivate=false suppresses even the user's own DTUs", () => {
  const db = setup();
  insertDtu(db, {
    id: "dtu_bob_private",
    title: "Refractory steel",
    content: "bob's notes",
    creator_id: "bob",
    scope: "personal",
  });
  const sources = gatherSourcesForQuery(db, {
    query: "Refractory steel",
    userId: "bob",
    includeUserPrivate: false,
  });
  assert.equal(sources.length, 0);
});

test("ranking — higher term overlap ranks ahead", () => {
  const db = setup();
  insertDtu(db, {
    id: "dtu_high_match",
    title: "Steel refractory melt cycle calibration",
    content: "Steel refractory melt cycle calibration content matching all 4 terms",
    creator_id: "x", scope: "public",
  });
  insertDtu(db, {
    id: "dtu_low_match",
    title: "Steel alloy basics",
    content: "Steel alloy",
    creator_id: "y", scope: "public",
  });
  const sources = gatherSourcesForQuery(db, {
    query: "Steel refractory melt calibration",
    limit: 8,
  });
  assert.equal(sources.length, 2);
  assert.equal(sources[0].id, "dtu_high_match", "higher-term-overlap row must rank first");
});

test("limit param caps result count", () => {
  const db = setup();
  for (let i = 0; i < 10; i++) {
    insertDtu(db, {
      id: `dtu_${i}`, title: `Steel refractory ${i}`, content: "steel refractory",
      creator_id: "x", scope: "public",
    });
  }
  const sources = gatherSourcesForQuery(db, { query: "Steel refractory", limit: 3 });
  assert.equal(sources.length, 3);
});

test("extractCitationIndices parses [1] and [2, 3] and dedupes", () => {
  const t = "First claim [1]. Second [2, 3]. Third [3] and [4,5,6].";
  const idx = extractCitationIndices(t);
  assert.deepEqual(idx, [1, 2, 3, 4, 5, 6]);
});

test("extractCitationIndices is empty for no markers", () => {
  assert.deepEqual(extractCitationIndices("No citations here"), []);
  assert.deepEqual(extractCitationIndices(""), []);
  assert.deepEqual(extractCitationIndices(null), []);
});

test("composeExpertMessages encodes provenance for non-default mints", () => {
  const sources = [
    { id: "dtu1", title: "First", snippet: "snippet 1", creator_id: "claudia",
      minted_by_provider: "anthropic", minted_by_model: "claude-opus-4-7", scope: "public" },
    { id: "dtu2", title: "Second", snippet: "snippet 2", creator_id: "bob",
      minted_by_provider: "concord_default", minted_by_model: "ollama", scope: "public" },
  ];
  const msgs = composeExpertMessages("test question", sources);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, "system");
  assert.equal(msgs[1].role, "user");
  // The user-prompt should mention the Claude provenance.
  assert.ok(msgs[1].content.includes("claude-opus-4-7"));
  // It should NOT clutter Ollama-minted rows with a provenance tag.
  assert.ok(!msgs[1].content.includes("concord_default"));
  assert.ok(msgs[1].content.includes("[1]"));
  assert.ok(msgs[1].content.includes("[2]"));
});

test("composeExpertMessages handles empty source list gracefully", () => {
  const msgs = composeExpertMessages("test", []);
  assert.ok(msgs[1].content.includes("no sources retrieved"));
});

test("EXPERT_SYSTEM_PROMPT enforces citation discipline", () => {
  const prompt = EXPERT_MODE_CONSTANTS.EXPERT_SYSTEM_PROMPT;
  assert.ok(prompt.includes("citation"));
  assert.ok(prompt.includes("[1]"));
  assert.ok(prompt.includes("Do NOT invent facts"));
});

test("missing db / query handled gracefully", () => {
  assert.deepEqual(gatherSourcesForQuery(null, { query: "x" }), []);
  assert.deepEqual(gatherSourcesForQuery(setup(), { query: "" }), []);
  assert.deepEqual(gatherSourcesForQuery(setup(), {}), []);
});

test("short query (no 3+ char terms) returns empty without throwing", () => {
  const db = setup();
  const sources = gatherSourcesForQuery(db, { query: "a b c" });
  assert.deepEqual(sources, []);
});

test("dtus table without provenance columns falls through gracefully", () => {
  // Some test fixtures don't run mig 170; ensure gatherSourcesForQuery
  // doesn't crash on missing columns.
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE dtus (id TEXT PRIMARY KEY, title TEXT, content TEXT, creator_id TEXT, scope TEXT, created_at INTEGER)`);
  db.prepare(`INSERT INTO dtus (id, title, content, creator_id, scope) VALUES (?, ?, ?, ?, ?)`)
    .run("a", "Refractory steel", "Refractory steel content", "x", "public");
  // Should return empty (column missing) but not throw.
  const sources = gatherSourcesForQuery(db, { query: "Refractory steel" });
  assert.equal(Array.isArray(sources), true);
});
