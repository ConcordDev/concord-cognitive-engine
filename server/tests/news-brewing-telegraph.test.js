// Legibility W4 — telegraph the brewing, not just the terminal reveal.
//
// Pins the two new escalation harvests: a faction relation in 'tension' with an
// expansionist side -> tension_rising; an active scheme past 50% discovery ->
// evidence_mounting. So the news shows the arc, and the eventual war/exposure
// references its own foreshadowing.
//
// Run: node --test tests/news-brewing-telegraph.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runNewsComposePass, listRecentStories } from "../lib/news-story-composer.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, owner_user_id TEXT, title TEXT, body_json TEXT,
      tags_json TEXT, visibility TEXT, tier TEXT, created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE faction_relations (
      faction_a TEXT, faction_b TEXT, score REAL DEFAULT 0, kind TEXT DEFAULT 'neutral',
      updated_at INTEGER DEFAULT (unixepoch()), PRIMARY KEY (faction_a, faction_b)
    );
    CREATE TABLE faction_strategy_state (
      faction_id TEXT PRIMARY KEY, stance TEXT DEFAULT 'consolidate', momentum REAL DEFAULT 0
    );
    CREATE TABLE npc_schemes (
      id TEXT PRIMARY KEY, plotter_id TEXT, kind TEXT, phase TEXT DEFAULT 'planning',
      discovery_pct INTEGER DEFAULT 10, next_tick_at INTEGER DEFAULT (unixepoch())
    );
  `);
  const now = Math.floor(Date.now() / 1000);
  // Brewing tension: Emerald and Crimson, Emerald is expanding.
  db.prepare(`INSERT INTO faction_relations (faction_a, faction_b, score, kind, updated_at) VALUES ('crimson','emerald',-0.3,'tension',?)`).run(now);
  db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance) VALUES ('emerald','expand')`).run();
  db.prepare(`INSERT INTO faction_strategy_state (faction_id, stance) VALUES ('crimson','consolidate')`).run();
  // A scheme being uncovered (60% discovered, still active).
  db.prepare(`INSERT INTO npc_schemes (id, plotter_id, kind, phase, discovery_pct, next_tick_at) VALUES ('sch1','npcX','blackmail','executing',60,?)`).run(now);
  // A neutral relation (no telegraph) + a quiet scheme (under threshold) — must NOT surface.
  db.prepare(`INSERT INTO faction_relations (faction_a, faction_b, score, kind, updated_at) VALUES ('azure','beige',0,'neutral',?)`).run(now);
  db.prepare(`INSERT INTO npc_schemes (id, plotter_id, kind, phase, discovery_pct, next_tick_at) VALUES ('sch2','npcY','theft','planning',20,?)`).run(now);
});
afterEach(() => { try { db.close(); } catch { /* noop */ } });

describe("W4 — brewing telegraph", () => {
  it("surfaces tension_rising before war is declared", () => {
    runNewsComposePass(db, {});
    const stories = listRecentStories(db, { kind: "tension_rising" });
    assert.ok(stories.length >= 1, "a tension_rising story should be composed");
    assert.match(stories[0].title, /emerald|crimson|tension|border|brewing/i);
  });

  it("surfaces evidence_mounting for a half-uncovered scheme", () => {
    runNewsComposePass(db, {});
    const stories = listRecentStories(db, { kind: "evidence_mounting" });
    assert.ok(stories.length >= 1, "an evidence_mounting story should be composed");
  });

  it("does NOT telegraph neutral relations or low-discovery schemes", () => {
    runNewsComposePass(db, {});
    const tension = listRecentStories(db, { kind: "tension_rising" });
    // only the crimson/emerald pair, never azure/beige
    assert.ok(tension.every((s) => !/azure|beige/i.test(s.title)));
  });
});
