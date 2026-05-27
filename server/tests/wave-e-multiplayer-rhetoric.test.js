// server/tests/wave-e-multiplayer-rhetoric.test.js
//
// Wave E — multiplayer simulation (E1), gift offering (E2), rhetoric route (E3a).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  sampleNotableEvents, drainShadowQueue, markConsumed,
} from "../lib/cross-world-shadow.js";
import { runCrossWorldPulseCycle } from "../emergent/cross-world-pulse-cycle.js";
import { runGiftOfferingCycle } from "../emergent/gift-offering-cycle.js";
import createRhetoricRouter from "../routes/rhetoric.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_legends (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT,
      sentiment REAL NOT NULL DEFAULT 0,
      severity INTEGER NOT NULL DEFAULT 5,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE world_visits (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL,
      arrived_at INTEGER NOT NULL DEFAULT (unixepoch()),
      departed_at INTEGER, total_time_minutes REAL
    );
    CREATE TABLE world_quests (
      id TEXT PRIMARY KEY, world_id TEXT, giver_npc_id TEXT, title TEXT,
      description TEXT, status TEXT DEFAULT 'available', reward TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      x REAL DEFAULT 0, z REAL DEFAULT 0,
      is_dead INTEGER DEFAULT 0,
      archetype TEXT, faction TEXT, name TEXT
    );
    CREATE TABLE world_markers (
      id TEXT PRIMARY KEY, world_id TEXT, kind TEXT,
      x REAL, y REAL, z REAL,
      label TEXT, body TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE user_player_profiles (
      user_id TEXT PRIMARY KEY,
      dialogue_signature TEXT, lineage_summary TEXT,
      playstyle_json TEXT, gift_preferences_json TEXT,
      last_compiled_at INTEGER, activity_signature TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE npc_player_memories (
      npc_id TEXT NOT NULL, player_id TEXT NOT NULL, world_id TEXT NOT NULL,
      summary_json TEXT, sentiment REAL DEFAULT 0,
      sightings INTEGER DEFAULT 0, interactions INTEGER DEFAULT 0,
      first_met_at INTEGER DEFAULT (unixepoch()),
      last_interaction_at INTEGER DEFAULT (unixepoch()),
      last_summary_compiled_at INTEGER,
      PRIMARY KEY (npc_id, player_id)
    );
    CREATE TABLE npc_player_interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, npc_id TEXT, player_id TEXT,
      world_id TEXT, kind TEXT, payload_json TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL DEFAULT 0,
      kind TEXT DEFAULT 'neutral', top_reason TEXT,
      last_event_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
    CREATE TABLE npc_schemes (
      id TEXT PRIMARY KEY, plotter_kind TEXT, plotter_id TEXT,
      target_kind TEXT, target_id TEXT, kind TEXT, phase TEXT DEFAULT 'planning',
      world_id TEXT, accomplice_count INTEGER DEFAULT 0,
      evidence_count INTEGER DEFAULT 0, success_pct REAL DEFAULT 50,
      discovery_pct REAL DEFAULT 0, next_tick_at INTEGER DEFAULT (unixepoch()),
      resolved_at INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE affect_state (
      entity_id TEXT PRIMARY KEY, world_id TEXT,
      v REAL DEFAULT 0, a REAL DEFAULT 0, s REAL DEFAULT 0,
      c REAL DEFAULT 0, g REAL DEFAULT 0, t REAL DEFAULT 0, f REAL DEFAULT 0,
      ts INTEGER, momentum_json TEXT
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);

  // Seed notable legends to sample.
  db.prepare(`INSERT INTO world_legends (id, world_id, subject_kind, subject_id, title, body, sentiment, severity) VALUES
    ('lg_villain', 'concordia', 'user', 'U_villain', 'The Slaughter at Aelar', 'A grim deed', -0.9, 10),
    ('lg_hero',    'concordia', 'user', 'U_hero',    'The Triumph at Goldfield', 'A noble act', 0.8, 8),
    ('lg_minor',   'concordia', 'user', 'U_other',   'Minor squabble', 'meh', 0.1, 3)
  `).run();

  // Active world visits so the cycle has destinations.
  db.prepare(`INSERT INTO world_visits (id, user_id, world_id, departed_at)
    VALUES ('v1', 'U_listener', 'concordia', NULL),
           ('v2', 'U_listener', 'sovereign-ruins', NULL)
  `).run();

  // Gift-offering setup
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype, name) VALUES
    ('npc_friend', 'concordia', 100, 100, 'merchant', 'Tess'),
    ('npc_target', 'concordia', 50, 50, 'guard', 'Marek'),
    ('npc_for_rhetoric', 'concordia', 0, 0, 'scholar', 'Sage')
  `).run();
  db.prepare(`INSERT INTO npc_player_memories
    (npc_id, player_id, world_id, sentiment, interactions, last_interaction_at, last_summary_compiled_at)
    VALUES ('npc_friend', 'U_player', 'concordia', 0.85, 10, ?, NULL)
  `).run(Math.floor(Date.now() / 1000) - 86400); // last seen 1 day ago
  db.prepare(`INSERT INTO user_player_profiles
    (user_id, dialogue_signature, lineage_summary, playstyle_json, gift_preferences_json)
    VALUES ('U_player', 'frost-mage', 'ice-aligned',
      '{"topSkills":[],"dominantElement":"ice","weaponClassTop":"staff"}',
      '{"preferredElements":["ice"],"preferredCategories":["focus"],"preferredRarity":"rare"}'
    )
  `).run();
});

after(() => { db?.close(); });

describe("Wave E1 — cross-world shadow", () => {
  it("sampleNotableEvents picks high-severity legends", () => {
    const r = sampleNotableEvents(db);
    assert.equal(r.ok, true);
    assert.ok(r.recorded >= 2, "lg_villain + lg_hero (severity ≥ 6); lg_minor excluded");
  });

  it("drainShadowQueue returns the recorded items unconsumed", () => {
    const rows = drainShadowQueue(db, { limit: 10 });
    assert.ok(rows.length >= 2);
    for (const r of rows) {
      assert.equal(r.consumed_at, null);
      assert.ok(r.detail?.legendId);
    }
  });

  it("pulse cycle spawns echo quests in active worlds", async () => {
    let emits = 0;
    globalThis._concordRealtimeEmit = (event) => { if (event === "world:echo-quest-spawned") emits++; };
    const r = await runCrossWorldPulseCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.echoesSpawned >= 1, `expected echoes, got ${r.echoesSpawned}`);
    const echoQuests = db.prepare(`SELECT * FROM world_quests WHERE title LIKE 'Echo:%'`).all();
    assert.ok(echoQuests.length >= 1);
    assert.ok(emits >= 1);
    delete globalThis._concordRealtimeEmit;
  });

  it("markConsumed flips consumed_at", () => {
    const rows = drainShadowQueue(db, { limit: 1 });
    if (rows.length === 0) return; // already drained
    markConsumed(db, rows[0].id);
    const row = db.prepare(`SELECT consumed_at FROM cross_world_shadow_queue WHERE id = ?`).get(rows[0].id);
    assert.ok(row.consumed_at);
  });
});

describe("Wave E2 — gift offering", () => {
  it("high-loyalty NPC drops a gift matching player preferences", async () => {
    const r = await runGiftOfferingCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.gifted >= 1, `expected ≥1 gift, got ${r.gifted}`);
    const gift = db.prepare(`SELECT * FROM world_markers WHERE kind = 'gift' LIMIT 1`).get();
    assert.ok(gift);
    // ice + focus preference → "Frost Crystal" naming.
    assert.ok(gift.label.includes("Frost"));
  });

  it("cooldown prevents immediate re-gift", async () => {
    const r = await runGiftOfferingCycle({ db });
    assert.equal(r.gifted, 0, "no re-gift inside cooldown window");
  });

  it("kill switch", async () => {
    process.env.CONCORD_GIFT_OFFERING = "0";
    try {
      const r = await runGiftOfferingCycle({ db });
      assert.equal(r.reason, "disabled");
    } finally { delete process.env.CONCORD_GIFT_OFFERING; }
  });
});

describe("Wave E3a — rhetoric route (deterministic fallback)", () => {
  let router;
  before(() => {
    router = createRhetoricRouter({
      db,
      requireAuth: (req, _res, next) => { req.user = { id: "U_player" }; next(); },
    });
  });

  function invoke(path, body = {}) {
    return new Promise((resolve) => {
      let status = 200, json = null;
      const req = {
        method: "POST", url: path, headers: {}, params: {}, body,
        app: { locals: { io: { to: () => ({ emit: () => {} }) } } },
      };
      const res = {
        status(c) { status = c; return this; },
        json(b)   { json = b; resolve({ status, body: b }); },
      };
      router.handle(req, res, () => resolve({ status: 404, body: null }));
    });
  }

  it("rejects missing args", async () => {
    const r = await invoke("/persuade", {});
    assert.equal(r.status, 400);
  });

  it("scores an argument deterministically when LLM unavailable", async () => {
    const r = await invoke("/persuade", {
      targetNpcId: "npc_for_rhetoric",
      argument: "Please help me, I am desperate. Together we can rebuild what was lost. Hope demands action.",
      intent: "aid",
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.ok(["persuaded", "unmoved", "offended"].includes(r.body.verdict));
    assert.ok(r.body.scores.logic >= 0);
  });

  it("insult triggers offended verdict", async () => {
    const r = await invoke("/persuade", {
      targetNpcId: "npc_for_rhetoric",
      argument: "You wretch, you coward — give me what I want.",
      intent: "demand",
    });
    assert.equal(r.body.verdict, "offended");
    assert.ok(r.body.opinionDelta < 0);
  });

  it("rate limits after 3 attempts per hour", async () => {
    // The previous two test calls already used 2 attempts on npc_for_rhetoric.
    // One more pushes to 3, fourth should fail.
    const r1 = await invoke("/persuade", { targetNpcId: "npc_for_rhetoric", argument: "third attempt" });
    assert.equal(r1.status, 200);
    const r2 = await invoke("/persuade", { targetNpcId: "npc_for_rhetoric", argument: "fourth attempt" });
    assert.equal(r2.status, 429);
    assert.equal(r2.body.error, "rate_limited");
  });
});
