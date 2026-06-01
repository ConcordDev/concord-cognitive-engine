// G7 — content-continuity feedback. Pins the "what users completed" rollup + the
// dry-up early-warning (a world whose authored quests are nearly all completed is
// flagged for the next authored drop). Table-guarded; macros register.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { completionSummary, worldQuestStatus, topCompletedQuests } from "../lib/completion-feedback.js";
import registerCompletionMacros from "../domains/completion.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE world_quests (id TEXT PRIMARY KEY, world_id TEXT, status TEXT);
    CREATE TABLE quest_completions (user_id TEXT, quest_id TEXT, federation_tier TEXT, completed_at TEXT);
    CREATE TABLE player_achievements (player_id TEXT, achievement_id TEXT);
    CREATE TABLE weekly_objectives (id TEXT, user_id TEXT, objective_id TEXT, completed_at TEXT);
  `);
  // 'sere': 5 completed, 1 available  -> nearly exhausted (needs an authored drop)
  for (let i = 0; i < 5; i++) db.prepare("INSERT INTO world_quests VALUES (?, 'sere', 'completed')").run(`sq${i}`);
  db.prepare("INSERT INTO world_quests VALUES ('sq5', 'sere', 'available')").run();
  // 'tunya': plenty still available -> healthy
  for (let i = 0; i < 8; i++) db.prepare("INSERT INTO world_quests VALUES (?, 'tunya', 'available')").run(`tq${i}`);
  db.prepare("INSERT INTO world_quests VALUES ('tq8', 'tunya', 'completed')").run();
  // completions log
  for (let i = 0; i < 4; i++) db.prepare("INSERT INTO quest_completions VALUES ('u1','popular_quest','local','2026-05-30')").run();
  db.prepare("INSERT INTO quest_completions VALUES ('u2','rare_quest','local','2026-05-29')").run();
  db.prepare("INSERT INTO player_achievements VALUES ('u1','first_blood')").run();
  db.prepare("INSERT INTO weekly_objectives VALUES ('w1','u1','weekly_slayer','2026-05-30')").run();
  db.prepare("INSERT INTO weekly_objectives VALUES ('w2','u2','weekly_trader',NULL)").run();
  return db;
}

describe("completion feedback (G7)", () => {
  it("flags a nearly-exhausted world for the next authored drop", () => {
    const db = freshDb();
    const worlds = worldQuestStatus(db);
    const sere = worlds.find((w) => w.world_id === "sere");
    const tunya = worlds.find((w) => w.world_id === "tunya");
    assert.equal(sere.nearlyExhausted, true, "sere: 5 completed / 1 available → inject authored content");
    assert.ok(sere.exhaustion >= 0.8);
    assert.equal(tunya.nearlyExhausted, false, "tunya still has plenty available");
  });

  it("rolls up what users completed", () => {
    const db = freshDb();
    const s = completionSummary(db);
    assert.equal(s.ok, true);
    assert.equal(s.totalCompletions, 5);
    assert.equal(s.topCompletedQuests[0].quest_id, "popular_quest");
    assert.equal(s.topCompletedQuests[0].completions, 4);
    assert.deepEqual(s.nearlyExhausted, ["sere"]);
    // weekly objective the players skipped surfaces first (lowest completion rate)
    assert.equal(s.underservedObjectiveTypes[0].objective_id, "weekly_trader");
  });

  it("degrades to empty on a minimal build + registers macros", () => {
    const empty = new Database(":memory:");
    const s = completionSummary(empty);
    assert.equal(s.ok, true);
    assert.equal(s.totalCompletions, 0);
    assert.deepEqual(s.worlds, []);
    const m = new Map();
    registerCompletionMacros((d, n, fn) => m.set(`${d}.${n}`, fn));
    assert.ok(m.has("completion.summary") && m.has("completion.exhaustion"));
  });
});
