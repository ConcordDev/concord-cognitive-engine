// server/tests/wave-d-bards-grief.test.js
//
// Wave D — bards (D1) + grief (D2).

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { composeLegend, listLegends, _internal } from "../lib/world-legends.js";
import { runBardPerformanceCycle } from "../emergent/bard-performance-cycle.js";
import { runGrievingNpcCycle } from "../emergent/grieving-npc-cycle.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE world_npcs (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      x REAL DEFAULT 0, z REAL DEFAULT 0,
      is_dead INTEGER DEFAULT 0,
      archetype TEXT, faction TEXT
    );
    CREATE TABLE world_legends (
      id TEXT PRIMARY KEY, world_id TEXT NOT NULL,
      subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
      title TEXT NOT NULL, body TEXT,
      sentiment REAL NOT NULL DEFAULT 0,
      severity INTEGER NOT NULL DEFAULT 5,
      composed_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE bard_repertoire (
      bard_npc_id TEXT NOT NULL, legend_id TEXT NOT NULL,
      performed_count INTEGER NOT NULL DEFAULT 0,
      last_performed_at INTEGER,
      learned_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (bard_npc_id, legend_id)
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_kind TEXT, target_id TEXT, score REAL DEFAULT 0,
      kind TEXT DEFAULT 'neutral', top_reason TEXT,
      last_event_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch()),
      created_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (npc_id, target_kind, target_id)
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
    CREATE TABLE npc_preoccupations (
      id TEXT PRIMARY KEY, npc_id TEXT, kind TEXT, target_kind TEXT, target_id TEXT,
      severity REAL DEFAULT 0.5, expires_at INTEGER, created_at INTEGER DEFAULT (unixepoch())
    );
  `);
}

before(() => {
  db = new Database(":memory:");
  buildSchema(db);
  // 2 bards + 4 listeners around them.
  db.prepare(`INSERT INTO world_npcs (id, world_id, x, z, archetype) VALUES
    ('bard_a',     'concordia', 10, 10, 'bard'),
    ('bard_b',     'concordia', 50, 50, 'entertainer'),
    ('listener_1', 'concordia', 15, 12, 'merchant'),
    ('listener_2', 'concordia',  8, 14, 'guard'),
    ('listener_3', 'concordia', 52, 50, 'scholar'),
    ('far_npc',    'concordia', 200, 200, 'farmer')
  `).run();
});

after(() => { db?.close(); });

describe("composeLegend", () => {
  it("writes a row + attaches to all bards", () => {
    const r = composeLegend(db, {
      worldId: "concordia",
      subjectKind: "user",
      subjectId: "U_villain",
      eventKind: "royal_kill",
      eventContext: { subjectName: "Aleph the Bloody", location: { x: 100, z: 100 } },
    });
    assert.equal(r.ok, true);
    assert.ok(r.legendId);
    assert.equal(r.severity, 9);
    assert.ok(r.sentiment < 0);
    assert.equal(r.bardsAttached, 2);

    const rep = db.prepare(`SELECT COUNT(*) AS n FROM bard_repertoire WHERE legend_id = ?`).get(r.legendId);
    assert.equal(rep.n, 2);
  });

  it("EVENT_KIND_CONFIG covers known kinds + falls back", () => {
    assert.ok(_internal.EVENT_KIND_CONFIG.royal_kill);
    assert.ok(_internal.EVENT_KIND_CONFIG.mass_atrocity);
    assert.ok(_internal.EVENT_KIND_CONFIG.default);
  });

  it("listLegends returns newest first with sentiment filtering", () => {
    composeLegend(db, {
      worldId: "concordia", subjectKind: "user", subjectId: "U_hero",
      eventKind: "legendary_victory",
      eventContext: { subjectName: "Iren the Bright" },
    });
    const all = listLegends(db, "concordia");
    assert.ok(all.length >= 2);
    assert.ok(all[0].composed_at >= all[all.length - 1].composed_at);

    const positive = listLegends(db, "concordia", { sentimentMin: 0 });
    assert.ok(positive.length >= 1);
    assert.ok(positive.every((l) => l.sentiment >= 0));

    const negative = listLegends(db, "concordia", { sentimentMax: 0 });
    assert.ok(negative.length >= 1);
    assert.ok(negative.every((l) => l.sentiment <= 0));
  });
});

describe("bard-performance-cycle", () => {
  it("each bard performs their top-severity legend + propagates opinion", async () => {
    let emits = 0;
    globalThis._concordRealtimeEmit = (event, _payload) => {
      if (event === "bard:performance") emits++;
    };

    const r = await runBardPerformanceCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.performed >= 1, `performed ${r.performed}`);
    // bard_a should have radiated opinion to listener_1 and listener_2 (within 25m).
    // Top legend is royal_kill (severity 9, sentiment -0.7).
    const opn = db.prepare(`SELECT * FROM character_opinions WHERE npc_id = 'listener_1' AND target_id = 'U_villain'`).get();
    assert.ok(opn, "listener_1 should have an opinion of the villain");
    assert.ok(opn.score < 0, `negative because legend sentiment is negative (got ${opn.score})`);
    assert.ok(emits >= 1, "bard:performance emitted");

    delete globalThis._concordRealtimeEmit;
  });

  it("repertoire row's performed_count + last_performed_at updated", () => {
    const row = db.prepare(`SELECT performed_count, last_performed_at FROM bard_repertoire LIMIT 1`).get();
    assert.ok(row.performed_count >= 1);
    assert.ok(row.last_performed_at > 0);
  });

  it("respects kill switch", async () => {
    process.env.CONCORD_BARD_PERFORMANCE = "0";
    try {
      const r = await runBardPerformanceCycle({ db });
      assert.equal(r.reason, "disabled");
    } finally { delete process.env.CONCORD_BARD_PERFORMANCE; }
  });
});

describe("grieving-npc-cycle", () => {
  it("NPCs with high-sentiment memory of an absent player get 'personal_loss' preoccupation", async () => {
    // Seed: npc_friend had sentiment 0.6 for U_gone, last seen 20 days ago.
    db.prepare(`INSERT INTO npc_player_memories (npc_id, player_id, world_id, sentiment, last_interaction_at)
      VALUES ('npc_friend', 'U_gone', 'concordia', 0.6, ?)
    `).run(Math.floor(Date.now() / 1000) - 20 * 86400);

    const r = await runGrievingNpcCycle({ db });
    assert.equal(r.ok, true);
    assert.ok(r.set >= 1);
    const pre = db.prepare(`SELECT * FROM npc_preoccupations
      WHERE npc_id = 'npc_friend' AND kind = 'personal_loss' AND target_id = 'U_gone'
    `).get();
    assert.ok(pre);
    assert.ok(pre.severity > 0);
  });

  it("does not re-set if preoccupation is still active", async () => {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM npc_preoccupations WHERE npc_id = 'npc_friend'`).get();
    const r = await runGrievingNpcCycle({ db });
    assert.equal(r.ok, true);
    assert.equal(r.set, 0, "no new preoccupation");
    const after = db.prepare(`SELECT COUNT(*) AS n FROM npc_preoccupations WHERE npc_id = 'npc_friend'`).get();
    assert.equal(after.n, before.n);
  });

  it("skips low-sentiment memories", async () => {
    db.prepare(`INSERT INTO npc_player_memories (npc_id, player_id, world_id, sentiment, last_interaction_at)
      VALUES ('npc_indifferent', 'U_gone', 'concordia', 0.1, ?)
    `).run(Math.floor(Date.now() / 1000) - 30 * 86400);
    await runGrievingNpcCycle({ db });
    const pre = db.prepare(`SELECT * FROM npc_preoccupations
      WHERE npc_id = 'npc_indifferent' AND kind = 'personal_loss'
    `).get();
    assert.equal(pre, undefined, "low-sentiment NPC does not grieve");
  });
});
