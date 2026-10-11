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
  reconcileGroundedAnswer, EXPERT_SOURCE_TEXT_CAP,
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
  assert.ok(msgs[1].content.includes("do not supply an answer from memory"));
});

test("composeExpertMessages hands the brain the extract, not the search blurb", () => {
  const snippet = "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France.";
  const content = `${snippet} The tower is 330 metres (1,083 ft) tall, about the same height as an 81-storey building.`;
  const msgs = composeExpertMessages("How tall is the Eiffel Tower?", [
    {
      id: "web_eiffel",
      title: "Eiffel Tower",
      snippet,
      content,
      url: "https://en.wikipedia.org/wiki/Eiffel_Tower",
      origin: "web",
      scope: "web",
      source_name: "en.wikipedia.org",
    },
  ]);
  const user = msgs[1].content;
  assert.ok(user.includes("330 metres (1,083 ft)"));
  assert.ok(user.includes("https://en.wikipedia.org/wiki/Eiffel_Tower"));
  assert.equal(user.split("330 metres").length, 2, "the height sentence is included once, from the extract");
});

test("composeExpertMessages caps per-source text", () => {
  const marker = "UNIQUE_TAIL_MARKER_SHOULD_NOT_APPEAR";
  const content = `The tower is 330 metres tall. ${"a".repeat(EXPERT_SOURCE_TEXT_CAP)}${marker}`;
  const msgs = composeExpertMessages("height", [
    { id: "web_eiffel", title: "Eiffel Tower", snippet: "short", content, origin: "web", scope: "web" },
  ]);
  assert.ok(msgs[1].content.includes("330 metres"));
  assert.ok(!msgs[1].content.includes(marker));
  assert.ok(!msgs[1].content.includes("short"));
});

test("reconcileGroundedAnswer drops an uncited fact after a refusal", () => {
  const raw = "The provided sources do not contain information to answer this question. The capital of France is Paris.";
  const out = reconcileGroundedAnswer(raw);
  assert.match(out, /do not contain information/i);
  assert.ok(!/Paris/.test(out));
});

test("reconcileGroundedAnswer keeps a cited claim and drops the contradictory refusal", () => {
  const raw = "The sources do not address the height of the Eiffel Tower. The tower is 330 metres tall [1].";
  const out = reconcileGroundedAnswer(raw);
  assert.equal(out, "The tower is 330 metres tall [1].");
});

test("reconcileGroundedAnswer keeps an honest refusal that does not invent a fact", () => {
  const raw = "The sources do not address the boiling point of water. No factual claim can be made from the retrieved sources.";
  assert.equal(reconcileGroundedAnswer(raw), raw);
});

test("reconcileGroundedAnswer leaves a normal cited answer unchanged", () => {
  const raw = "Refractory steel calibration works as follows [1].";
  assert.equal(reconcileGroundedAnswer(raw), raw);
});

test("EXPERT_SYSTEM_PROMPT enforces citation discipline", () => {
  const prompt = EXPERT_MODE_CONSTANTS.EXPERT_SYSTEM_PROMPT;
  assert.ok(prompt.includes("citation"));
  assert.ok(prompt.includes("[1]"));
  assert.ok(prompt.includes("Do NOT invent facts"));
  assert.ok(prompt.includes("Do not supply the missing fact from memory"));
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
