// AD-06 (MST-W4-15) — Main arc completion (incl. Sere): end-to-end load proof.
//
// The authored content stands complete (determination filed at claim time:
// corpus = 135 quest ids, exactly the A-01 audit count; main arc 7 chapters
// / 29 objectives with its follow_up chain fully resolving; Sere arc 4 quests
// / 10 objectives with its prerequisite chain resolving into the Twin Pact
// payoff). What no repo test proved is the LOAD: that both arcs pass the
// seeder's validation gate, register in _authoredQuests, bridge into System
// B's world_quests (the table /api/quests, the dialogue offer path and
// QuestTracker actually read), land their objectives as quest_objectives
// rows, and come back out of the live getAvailableQuests read path.
//
// This suite runs the REAL seedContent over the REAL content tree (the
// authored-dialogue harness pattern: runMigrations + seedContent on an
// in-memory DB, one boot — the seeder caches _seeded at module level).
// Expectations derive from the authored files read at runtime, so the suite
// pins the files exactly as they stand: an arc quest dropped, renamed,
// de-linked or stripped of objectives fails here, not in a walk.
//
// Run: node --test tests/concordia-main-arc-load.test.js

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import { seedContent, _authoredQuests } from "../lib/content-seeder.js";
import { getAvailableQuests } from "../lib/quests/quest-engine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "..", "..");

const ARCS = [
  { file: "content/quests/main-arc.json", worldId: "concordia-hub", label: "main arc" },
  { file: "content/world/sere/quests/main-arc.json", worldId: "sere", label: "Sere main arc" },
].map((a) => ({ ...a, quests: JSON.parse(readFileSync(path.join(REPO_ROOT, a.file), "utf8")) }));

const ALL = ARCS.flatMap((a) => a.quests.map((q) => ({ ...q, worldId: a.worldId })));

describe("AD-06 — main arc + Sere main arc load end-to-end through the seeder", () => {
  let db;
  let seedResult;

  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedResult = await seedContent({ db });
  });

  it("seedContent reports ok", () => {
    assert.equal(seedResult.ok, true);
  });

  it("both arcs are non-trivial as authored (7 + 4 quests)", () => {
    assert.equal(ARCS[0].quests.length, 7, "main arc chapter count (§4.9 target: 7+)");
    assert.equal(ARCS[1].quests.length, 4, "Sere arc quest count");
  });

  it("every arc quest passes the seeder gate and registers in _authoredQuests", () => {
    for (const q of ALL) {
      const rec = _authoredQuests.get(q.id);
      assert.ok(rec, `${q.id} must register in _authoredQuests (validateQuest + createQuest)`);
      assert.equal(rec.raw.title, q.title);
      assert.ok(rec.engineId, `${q.id} carries an engine id`);
    }
  });

  it("every arc quest bridges into world_quests as an available authored row in its own world", () => {
    for (const q of ALL) {
      const row = db.prepare("SELECT * FROM world_quests WHERE id = ?").get(q.id);
      assert.ok(row, `${q.id} must land in world_quests (System B)`);
      assert.equal(row.world_id, q.worldId, `${q.id} world`);
      assert.equal(row.status, "available", `${q.id} status`);
      assert.equal(row.authored, 1, `${q.id} authored flag`);
      assert.equal(row.title, q.title, `${q.id} title`);
    }
  });

  it("objectives land verbatim in objectives_json and as quest_objectives rows at the mapper's contract", () => {
    for (const q of ALL) {
      const row = db.prepare("SELECT objectives_json FROM world_quests WHERE id = ?").get(q.id);
      const verbatim = JSON.parse(row.objectives_json || "[]");
      assert.equal(verbatim.length, (q.objectives || []).length, `${q.id} objectives_json count`);
      // System B's mapper keeps exactly the objectives carrying a type AND a target.
      const mappable = (q.objectives || []).filter(
        (o) => typeof o?.type === "string" && o.type && typeof o?.target === "string" && o.target,
      );
      const rows = db
        .prepare("SELECT * FROM quest_objectives WHERE quest_id = ? ORDER BY order_index")
        .all(q.id);
      assert.equal(rows.length, mappable.length, `${q.id} quest_objectives rows`);
      rows.forEach((r, i) => {
        assert.equal(r.type, mappable[i].type, `${q.id} objective ${i} type`);
        assert.equal(r.target, mappable[i].target, `${q.id} objective ${i} target`);
        assert.equal(r.order_index, i, `${q.id} objective ${i} order`);
      });
    }
    const total = ALL.reduce((n, q) => n + (q.objectives || []).length, 0);
    assert.equal(total, 39, "both arcs together carry 39 authored objectives (29 + 10)");
  });

  it("chain linkage is retained exactly as authored", () => {
    for (const q of ALL) {
      const raw = _authoredQuests.get(q.id).raw;
      assert.deepEqual(raw.follow_up_quest_ids || [], q.follow_up_quest_ids || [], `${q.id} follow-ups`);
      assert.deepEqual(raw.prerequisite_quests || [], q.prerequisite_quests || [], `${q.id} prerequisites`);
    }
    // The chains resolve inside the registered corpus — no dangling link.
    for (const q of ALL) {
      for (const ref of [...(q.follow_up_quest_ids || []), ...(q.prerequisite_quests || [])]) {
        assert.ok(_authoredQuests.has(ref), `${q.id} -> ${ref} must resolve to a registered quest`);
      }
    }
    // Shape pins: the main arc is one follow_up chain from first to terminal;
    // the Sere arc is a prerequisite ladder ending at the Twin Pact payoff.
    const main = ARCS[0].quests;
    for (let i = 0; i < main.length - 1; i++) {
      assert.deepEqual(main[i].follow_up_quest_ids, [main[i + 1].id], `main arc link ${i}`);
    }
    assert.deepEqual(main[main.length - 1].follow_up_quest_ids || [], [], "main arc terminal quest");
    const sere = ARCS[1].quests;
    for (let i = 1; i < sere.length; i++) {
      assert.deepEqual(sere[i].prerequisite_quests, [sere[i - 1].id], `Sere ladder rung ${i}`);
    }
    assert.equal(sere[sere.length - 1].id, "sere_arc_4_heal_the_pact", "Sere arc ends at the Twin Pact payoff");
  });

  it("the live read path returns the arcs: getAvailableQuests per world", () => {
    for (const arc of ARCS) {
      const avail = getAvailableQuests(db, "ad06-load-test-user", arc.worldId);
      const ids = new Set(avail.map((q) => q.id));
      for (const q of arc.quests) {
        assert.ok(ids.has(q.id), `${q.id} must be available in ${arc.worldId}`);
      }
      const first = avail.find((q) => q.id === arc.quests[0].id);
      assert.ok(Array.isArray(first.objectives), "available quest carries its objective rows");
    }
  });
});
