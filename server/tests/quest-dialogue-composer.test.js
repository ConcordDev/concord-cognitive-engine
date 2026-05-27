// Phase AE — quest dialogue composer tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  composeDeterministicDialogue,
  composeQuestDialogue,
  persistDialogue,
  getDialogue,
} from "../lib/quest-dialogue-composer.js";
import { up as upDialogue } from "../migrations/229_lattice_quest_dialogue.js";

function freshDb() {
  const db = new Database(":memory:");
  // Minimal lattice_born_quests shape — only the columns the
  // composer/persist touches.
  db.exec(`
    CREATE TABLE lattice_born_quests (
      id TEXT PRIMARY KEY,
      drift_alert_signature TEXT UNIQUE,
      drift_type TEXT,
      drift_severity TEXT,
      quest_id TEXT,
      world_id TEXT,
      target_npc_id TEXT,
      composer TEXT,
      composed_at INTEGER
    );
  `);
  upDialogue(db);
  return db;
}

const quest = {
  id: "q-1", title: "The Stolen Reliquary",
  summary: "Recover the reliquary from the south crypt.",
};

describe("Phase AE — deterministic dialogue", () => {
  it("returns three non-empty strings", () => {
    const d = composeDeterministicDialogue(quest);
    assert.ok(d.opener.length > 0);
    assert.ok(d.midline.length > 0);
    assert.ok(d.closer.length > 0);
    assert.equal(d.composer, "deterministic");
  });

  it("same quest id produces same dialogue (idempotent)", () => {
    const a = composeDeterministicDialogue(quest);
    const b = composeDeterministicDialogue(quest);
    assert.deepEqual(a, b);
  });

  it("different NPC context can change the opener", () => {
    const a = composeDeterministicDialogue(quest, { preoccupation: "grief" });
    const b = composeDeterministicDialogue(quest, { preoccupation: "vengeance" });
    // At minimum the tone string interpolation differs when not "neutral"
    assert.notEqual(a.opener, b.opener);
  });

  it("desire reward is woven into the opener and closer when present", () => {
    const d = composeDeterministicDialogue(quest, { desire: "a vial of redroot" });
    assert.ok(d.opener.includes("vial of redroot") || d.closer.includes("vial of redroot"));
  });
});

describe("Phase AE — composeQuestDialogue (async + LLM gate)", () => {
  it("falls back to deterministic when env flag is off", async () => {
    delete process.env.CONCORD_QUEST_DIALOGUE_LLM;
    const fakeLLM = { chat: async () => ({ content: "OPENER: foo\nMIDLINE: bar\nCLOSER: baz" }) };
    const d = await composeQuestDialogue(quest, {}, {}, { llm: fakeLLM });
    assert.equal(d.composer, "deterministic");
  });

  it("uses LLM when enabled + parses three-line response", async () => {
    process.env.CONCORD_QUEST_DIALOGUE_LLM = "true";
    const fakeLLM = {
      chat: async () => ({
        content: "OPENER: Heed me well, hero.\nMIDLINE: Speak — what news?\nCLOSER: At last, peace.",
      }),
    };
    const d = await composeQuestDialogue(quest, {}, {}, { llm: fakeLLM });
    assert.equal(d.composer, "llm");
    assert.equal(d.opener, "Heed me well, hero.");
    assert.equal(d.midline, "Speak — what news?");
    assert.equal(d.closer, "At last, peace.");
    delete process.env.CONCORD_QUEST_DIALOGUE_LLM;
  });

  it("falls back when LLM throws", async () => {
    process.env.CONCORD_QUEST_DIALOGUE_LLM = "true";
    const failing = { chat: async () => { throw new Error("boom"); } };
    const d = await composeQuestDialogue(quest, {}, {}, { llm: failing });
    assert.equal(d.composer, "deterministic");
    delete process.env.CONCORD_QUEST_DIALOGUE_LLM;
  });

  it("falls back when LLM response is unparseable", async () => {
    process.env.CONCORD_QUEST_DIALOGUE_LLM = "true";
    const bad = { chat: async () => ({ content: "I'm afraid I can't do that, Dave." }) };
    const d = await composeQuestDialogue(quest, {}, {}, { llm: bad });
    assert.equal(d.composer, "deterministic");
    delete process.env.CONCORD_QUEST_DIALOGUE_LLM;
  });
});

describe("Phase AE — persistDialogue / getDialogue round-trip", () => {
  let db;
  beforeEach(() => { db = freshDb(); });

  it("persists and reads back", () => {
    db.prepare(`
      INSERT INTO lattice_born_quests (id, drift_alert_signature, quest_id, world_id, composer, composed_at)
      VALUES (?, ?, ?, ?, 'deterministic', unixepoch())
    `).run("lbq-1", "sig-1", "q-1", "tunya");
    const d = composeDeterministicDialogue(quest);
    const r = persistDialogue(db, "q-1", d);
    assert.equal(r.ok, true);
    const back = getDialogue(db, "q-1");
    assert.deepEqual(back, d);
  });

  it("re-persist overwrites (idempotent)", () => {
    db.prepare(`
      INSERT INTO lattice_born_quests (id, drift_alert_signature, quest_id, world_id, composer, composed_at)
      VALUES (?, ?, ?, ?, 'deterministic', unixepoch())
    `).run("lbq-1", "sig-1", "q-1", "tunya");
    persistDialogue(db, "q-1", { opener: "a", midline: "b", closer: "c", composer: "deterministic" });
    persistDialogue(db, "q-1", { opener: "x", midline: "y", closer: "z", composer: "deterministic" });
    const back = getDialogue(db, "q-1");
    assert.equal(back.opener, "x");
  });
});
