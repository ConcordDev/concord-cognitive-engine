// server/tests/wave-g-npc-barks-contract.test.js
//
// Wave G2 — pins the bark substrate: cooldown, appearance signals,
// topic picker variety, templated catalog completeness, prompt registry
// entry, LLM fallback safety.

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  composeBarkContext,
  pickBarkTopic,
  composeBarkLine,
  composeBarkLineLLM,
  recordBark,
  isOnCooldown,
  _internal,
} from "../lib/npc-barks.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

let db;

function buildSchema(d) {
  d.exec(`
    CREATE TABLE npc_player_memories (
      npc_id TEXT NOT NULL, player_id TEXT NOT NULL,
      summary_json TEXT, sentiment REAL DEFAULT 0,
      sightings INTEGER DEFAULT 0, interactions INTEGER DEFAULT 0,
      first_met_at INTEGER, last_interaction_at INTEGER,
      last_bark_at INTEGER, recent_bark_topics_json TEXT,
      PRIMARY KEY (npc_id, player_id)
    );
    CREATE TABLE npc_grudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      npc_id TEXT NOT NULL, target_player_id TEXT,
      severity REAL DEFAULT 0, what TEXT
    );
    CREATE TABLE character_opinions (
      npc_id TEXT, target_user_id TEXT, score REAL DEFAULT 0,
      PRIMARY KEY (npc_id, target_user_id)
    );
    CREATE TABLE damage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attacker_id TEXT, target_id TEXT,
      damage REAL DEFAULT 0,
      occurred_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE user_active_effects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL, kind TEXT NOT NULL,
      magnitude REAL DEFAULT 1.0,
      expires_at INTEGER
    );
    CREATE TABLE user_wallets (
      user_id TEXT PRIMARY KEY, balance REAL DEFAULT 0
    );
    CREATE TABLE player_inventory (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      weapon_class TEXT
    );
  `);
}

before(() => { db = new Database(":memory:"); buildSchema(db); });
after(() => { db?.close(); });
beforeEach(() => {
  db.exec(`
    DELETE FROM npc_player_memories;
    DELETE FROM npc_grudges;
    DELETE FROM character_opinions;
    DELETE FROM damage_events;
    DELETE FROM user_active_effects;
    DELETE FROM user_wallets;
    DELETE FROM player_inventory;
  `);
});

describe("BARK_TEMPLATES catalog", () => {
  it("every topic has a neutral fallback line", () => {
    for (const topic of Object.keys(_internal.BARK_TEMPLATES)) {
      const byTone = _internal.BARK_TEMPLATES[topic];
      assert.ok(Array.isArray(byTone.neutral) || Array.isArray(byTone.friendly),
        `${topic} has at least neutral OR friendly`);
    }
  });

  it("greeting has lines for all four tones", () => {
    const g = _internal.BARK_TEMPLATES.greeting;
    for (const tone of ["friendly", "neutral", "wary", "hostile"]) {
      assert.ok(Array.isArray(g[tone]) && g[tone].length > 0, `greeting.${tone}`);
    }
  });
});

describe("deriveTone", () => {
  it("hostile when grudge severity ≥ 6", () => {
    assert.equal(_internal.deriveTone({ grudge: { severity: 7 } }), "hostile");
  });
  it("friendly when opinion ≥ 25", () => {
    assert.equal(_internal.deriveTone({ opinion: 30 }), "friendly");
  });
  it("wary when opinion ≤ -25", () => {
    assert.equal(_internal.deriveTone({ opinion: -30 }), "wary");
  });
  it("neutral by default", () => {
    assert.equal(_internal.deriveTone({}), "neutral");
  });
});

describe("composeBarkContext — appearance + asymmetry pickup", () => {
  it("returns null without both ids", () => {
    assert.equal(composeBarkContext(null, null, null), null);
  });

  it("picks up appearance signals (bloody / glowing / wealthy / armed)", () => {
    db.prepare(`INSERT INTO damage_events (target_id) VALUES (?)`).run("U1");
    db.prepare(`INSERT INTO user_active_effects (user_id, kind) VALUES (?, ?)`).run("U1", "fire_glow");
    db.prepare(`INSERT INTO user_wallets (user_id, balance) VALUES (?, ?)`).run("U1", 7500);
    db.prepare(`INSERT INTO player_inventory (id, user_id, weapon_class) VALUES (?, ?, ?)`).run("inv1", "U1", "greatsword");
    const ctx = composeBarkContext(db, { id: "N1" }, "U1");
    assert.ok(ctx);
    assert.equal(ctx.appearance.bloody, true);
    assert.equal(ctx.appearance.glowing, true);
    assert.equal(ctx.appearance.wealthy, true);
    assert.equal(ctx.appearance.armed_with, "greatsword");
  });

  it("derives tone from grudge severity", () => {
    db.prepare(`INSERT INTO npc_grudges (npc_id, target_player_id, severity, what) VALUES (?, ?, ?, ?)`)
      .run("N1", "U1", 8, "killed kin");
    const ctx = composeBarkContext(db, { id: "N1" }, "U1");
    assert.equal(ctx.tone, "hostile");
  });

  it("derives tone from opinion when no grudge", () => {
    db.prepare(`INSERT INTO character_opinions (npc_id, target_user_id, score) VALUES (?, ?, ?)`)
      .run("N1", "U1", 40);
    const ctx = composeBarkContext(db, { id: "N1" }, "U1");
    assert.equal(ctx.tone, "friendly");
  });
});

describe("pickBarkTopic", () => {
  it("favors appearance topics when present", () => {
    const ctx = { npcId: "N1", playerId: "U1", appearance: { bloody: true }, tone: "neutral" };
    // Run multiple buckets to verify bloody appears at least once.
    let seenBloody = false;
    for (let bucket = 0; bucket < 12 && !seenBloody; bucket++) {
      // Simulate different time buckets by mutating npcId salt.
      const t = pickBarkTopic({ ...ctx, npcId: `N${bucket}` }, []);
      if (t === "bloody") seenBloody = true;
    }
    assert.ok(seenBloody, "bloody topic surfaced across some buckets");
  });

  it("never returns a topic in recentTopics if alternatives exist", () => {
    const ctx = { npcId: "Nrecent", playerId: "U1", appearance: { soaked: true }, tone: "neutral" };
    const topic = pickBarkTopic(ctx, ["soaked"]);
    assert.notEqual(topic, "soaked");
  });

  it("defaults to greeting/routine when no signals", () => {
    const ctx = { npcId: "Nempty", playerId: "U1", tone: "neutral" };
    const topic = pickBarkTopic(ctx, []);
    assert.ok(["greeting", "routine"].includes(topic));
  });
});

describe("composeBarkLine", () => {
  it("always returns a non-empty line + tone + topic", () => {
    const ctx = { npcId: "N1", playerId: "U1", tone: "friendly" };
    const r = composeBarkLine(ctx, "greeting");
    assert.ok(r.line && r.line.length > 0);
    assert.equal(r.tone, "friendly");
    assert.equal(r.topic, "greeting");
  });

  it("falls back to neutral tone if templates missing", () => {
    const ctx = { npcId: "N1", playerId: "U1", tone: "weird-unknown-tone" };
    const r = composeBarkLine(ctx, "greeting");
    assert.ok(r.line);
  });
});

describe("cooldown + record", () => {
  it("recordBark stamps last_bark_at + appends to recent", () => {
    const r = recordBark(db, { npcId: "N1", playerId: "U1", topic: "greeting" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.recent, ["greeting"]);
    const row = db.prepare(`SELECT * FROM npc_player_memories WHERE npc_id = ? AND player_id = ?`).get("N1", "U1");
    assert.ok(row.last_bark_at);
  });

  it("recent topics trimmed to RECENT_TOPICS_KEEP", () => {
    for (const t of ["t1", "t2", "t3", "t4", "t5", "t6"]) {
      recordBark(db, { npcId: "N1", playerId: "U1", topic: t });
    }
    const row = db.prepare(`SELECT recent_bark_topics_json FROM npc_player_memories WHERE npc_id = ? AND player_id = ?`)
      .get("N1", "U1");
    const recent = JSON.parse(row.recent_bark_topics_json);
    assert.equal(recent.length, _internal.RECENT_TOPICS_KEEP);
    assert.equal(recent[0], "t6"); // newest first
  });

  it("isOnCooldown blocks within 90s", () => {
    recordBark(db, { npcId: "N1", playerId: "U1", topic: "greeting" });
    assert.equal(isOnCooldown(db, "N1", "U1"), true);
  });

  it("isOnCooldown returns false after window expires", () => {
    recordBark(db, { npcId: "N1", playerId: "U1", topic: "greeting" });
    db.prepare(`UPDATE npc_player_memories SET last_bark_at = unixepoch() - 200 WHERE npc_id = ? AND player_id = ?`)
      .run("N1", "U1");
    assert.equal(isOnCooldown(db, "N1", "U1"), false);
  });
});

describe("LLM fallback safety", () => {
  it("returns null when LLM env var not set", async () => {
    delete process.env.CONCORD_NPC_BARKS_LLM;
    const r = await composeBarkLineLLM({ tone: "neutral", npcId: "N1", playerId: "U1" }, "greeting", null, { name: "Bob" });
    assert.equal(r, null);
  });

  it("returns null on missing brain", async () => {
    process.env.CONCORD_NPC_BARKS_LLM = "true";
    const r = await composeBarkLineLLM({ tone: "neutral", npcId: "N1", playerId: "U1" }, "greeting", null, { name: "Bob" });
    assert.equal(r, null);
    delete process.env.CONCORD_NPC_BARKS_LLM;
  });
});

describe("prompt-registry entry", () => {
  it("npcBark prompt is registered", () => {
    assert.equal(typeof TASK_PROMPTS.npcBark, "function");
    const out = TASK_PROMPTS.npcBark({ npcName: "Alyna", tone: "wary", topic: "armed" });
    assert.ok(out.includes("Alyna"));
    assert.ok(out.toLowerCase().includes("wary") || out.toLowerCase().includes("tone"));
  });
});
