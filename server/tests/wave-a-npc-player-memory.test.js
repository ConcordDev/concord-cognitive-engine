// server/tests/wave-a-npc-player-memory.test.js
//
// Wave A / A2 — npc_player_memories + interaction log + summary
// compiler + narrative-bridge injection.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  recordInteraction, recordSighting, getMemory, listForPlayer,
  listHighSentimentForWorld, daysSinceLastSeen, persistSummary,
  recentInteractions, pruneStaleInteractions,
} from "../lib/npc-player-memory.js";
import { runNpcPlayerMemoryCycle, _internal as cycleInternal } from "../emergent/npc-player-memory-cycle.js";

let db;

before(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE npc_player_memories (
      npc_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      summary_json TEXT,
      sentiment REAL NOT NULL DEFAULT 0,
      sightings INTEGER NOT NULL DEFAULT 0,
      interactions INTEGER NOT NULL DEFAULT 0,
      first_met_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_interaction_at INTEGER NOT NULL DEFAULT (unixepoch()),
      last_summary_compiled_at INTEGER,
      PRIMARY KEY (npc_id, player_id)
    );
    CREATE TABLE npc_player_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      world_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
});

after(() => { db?.close(); });

describe("recordInteraction / getMemory", () => {
  it("first call creates the row", () => {
    const r = recordInteraction(db, {
      npcId: "npc_a", playerId: "U1", worldId: "concordia",
      kind: "spoke", payload: { topic: "weather" }, sentimentDelta: 0.2,
    });
    assert.equal(r.ok, true);
    const m = getMemory(db, "npc_a", "U1");
    assert.ok(m);
    assert.equal(m.sightings, 1);
    assert.equal(m.interactions, 1);
    assert.ok(Math.abs(m.sentiment - 0.2) < 1e-9);
  });

  it("subsequent calls increment + clamp sentiment", () => {
    for (let i = 0; i < 10; i++) {
      recordInteraction(db, { npcId: "npc_a", playerId: "U1", worldId: "concordia", kind: "helped", sentimentDelta: 0.5 });
    }
    const m = getMemory(db, "npc_a", "U1");
    assert.equal(m.sentiment, 1.0, "clamped to +1.0");
    assert.ok(m.interactions >= 11);
  });

  it("sighting increments sightings but not interactions", () => {
    const before = getMemory(db, "npc_a", "U1");
    recordSighting(db, { npcId: "npc_a", playerId: "U1", worldId: "concordia" });
    const after = getMemory(db, "npc_a", "U1");
    assert.equal(after.sightings, before.sightings + 1);
    assert.equal(after.interactions, before.interactions);
  });

  it("rejects invalid kind", () => {
    const r = recordInteraction(db, { npcId: "n", playerId: "p", worldId: "w", kind: "nonsense" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_kind");
  });

  it("rejects missing args", () => {
    assert.equal(recordInteraction(db, {}).ok, false);
  });
});

describe("listForPlayer / listHighSentimentForWorld", () => {
  it("returns rows ordered by recency", () => {
    recordInteraction(db, { npcId: "npc_b", playerId: "U1", worldId: "concordia", kind: "spoke" });
    const rows = listForPlayer(db, "U1");
    assert.ok(rows.length >= 2);
    assert.equal(rows[0].lastInteractionAt >= rows[rows.length - 1].lastInteractionAt, true);
  });

  it("scoping by world", () => {
    recordInteraction(db, { npcId: "npc_c", playerId: "U1", worldId: "other-world", kind: "spoke" });
    const concordiaOnly = listForPlayer(db, "U1", { worldId: "concordia" });
    assert.ok(concordiaOnly.every((r) => r.worldId === "concordia"));
  });

  it("high-sentiment filter", () => {
    // npc_a has sentiment 1.0 from earlier; npc_b is small.
    const high = listHighSentimentForWorld(db, "concordia", 0.5);
    assert.ok(high.some((r) => r.npcId === "npc_a"));
    assert.ok(high.every((r) => r.sentiment >= 0.5));
  });
});

describe("daysSinceLastSeen", () => {
  it("returns 0 for fresh memory", () => {
    const m = getMemory(db, "npc_a", "U1");
    assert.equal(daysSinceLastSeen(m), 0);
  });

  it("handles null gracefully", () => {
    assert.equal(daysSinceLastSeen(null), null);
  });

  it("computes days from staleness", () => {
    const fakeMemory = { lastInteractionAt: Math.floor(Date.now() / 1000) - 5 * 86400 };
    assert.equal(daysSinceLastSeen(fakeMemory), 5);
  });
});

describe("persistSummary", () => {
  it("writes summary_json + bumps last_summary_compiled_at", () => {
    const r = persistSummary(db, "npc_a", "U1", { headline: "spoke about weather; warm" });
    assert.equal(r.ok, true);
    const m = getMemory(db, "npc_a", "U1");
    assert.ok(m.summary?.headline?.includes("weather"));
    assert.ok(m.lastSummaryCompiledAt > 0);
  });

  it("rejects null summary", () => {
    assert.equal(persistSummary(db, "npc_a", "U1", null).ok, false);
  });
});

describe("recentInteractions + pruneStaleInteractions", () => {
  it("returns recent rows newest-first", () => {
    recordInteraction(db, { npcId: "npc_p", playerId: "U1", worldId: "concordia", kind: "fought" });
    const rows = recentInteractions(db, "npc_p", "U1", 10);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0].kind, "fought");
  });

  it("prune removes old rows", () => {
    // Backdate a row 100 days ago
    db.prepare(`
      INSERT INTO npc_player_interactions (npc_id, player_id, world_id, kind, created_at)
      VALUES ('npc_old', 'U1', 'concordia', 'spoke', ?)
    `).run(Math.floor(Date.now() / 1000) - 100 * 86400);
    const r = pruneStaleInteractions(db, 90);
    assert.equal(r.ok, true);
    assert.ok(r.deleted >= 1);
  });
});

describe("memory cycle (deterministic compiler)", () => {
  it("compiles a summary for memories with enough interactions", async () => {
    // Fresh pair with enough interactions to satisfy MIN_INTERACTIONS_TO_SUMMARIZE
    for (let i = 0; i < 5; i++) {
      recordInteraction(db, {
        npcId: "npc_compile", playerId: "U1", worldId: "concordia",
        kind: "spoke", payload: { topic: "war" },
      });
    }
    const r = await runNpcPlayerMemoryCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.compiled >= 1, `at least one compile, got ${r.compiled}`);
    const m = getMemory(db, "npc_compile", "U1");
    assert.ok(m.summary?.headline);
    assert.equal(m.summary?.dominantKind, "spoke");
    assert.equal(m.summary?.lastTopic, "war");
  });

  it("respects kill switch", async () => {
    process.env.CONCORD_NPC_PLAYER_MEMORY = "0";
    try {
      const r = await runNpcPlayerMemoryCycle({ db });
      assert.equal(r.reason, "disabled");
    } finally {
      delete process.env.CONCORD_NPC_PLAYER_MEMORY;
    }
  });

  it("skips memories with too few interactions", async () => {
    // A new pair with only one interaction; should NOT be compiled.
    recordInteraction(db, { npcId: "npc_quiet", playerId: "U1", worldId: "concordia", kind: "spoke" });
    await runNpcPlayerMemoryCycle({ db });
    const m = getMemory(db, "npc_quiet", "U1");
    assert.equal(m.lastSummaryCompiledAt, null);
  });
});

describe("deterministic compose helper (pure)", () => {
  it("headline reflects sentiment + kind", () => {
    const out = cycleInternal._composeHeadline("warm", "spoke", "weather");
    assert.ok(out.includes("weather"));
    const cold = cycleInternal._composeHeadline("cold", "fought", null);
    assert.ok(cold.includes("fought"));
  });
});
