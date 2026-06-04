// Contract test for Wave 7 / Track B5 — memory → identity (character over time).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { up as migAgent } from "../migrations/325_agent_identity.js";
import { createAgentSelf, getAgentSelf } from "../lib/agent-self.js";
import { evolveCharacter, getAutobiography } from "../lib/agent-autobiography.js";

function setupDb() {
  const db = new Database(":memory:");
  migAgent(db);
  return db;
}

test("Track B5 — memory → identity", async (t) => {
  await t.test("a run of FEAR peaks drifts the agent's character warier (anchored)", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["curiosity", "care_for_others"] });
    const id = r.agentId;
    const startFear = getAgentSelf(db, id).drive_profile.FEAR;
    // feed it a hard year of fear peaks (supplied directly to avoid needing the dream table)
    const peaks = Array.from({ length: 20 }, () => ({ dominantDrive: "FEAR", intensity: 0.9, valence: -0.8 }));
    const ev = evolveCharacter(db, id, { peaks, maturity: 0.5 });
    assert.equal(ev.evolved, true);
    assert.ok(getAgentSelf(db, id).drive_profile.FEAR > startFear, "the felt peaks became character");
    assert.ok(getAgentSelf(db, id).last_evolved_at > 0, "evolution is stamped");
  });

  await t.test("the values anchor is never mutated by evolution", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["honesty"] });
    evolveCharacter(db, r.agentId, { peaks: [{ dominantDrive: "RAGE", intensity: 0.95, valence: -0.6 }] });
    assert.deepEqual(getAgentSelf(db, r.agentId).core_values, ["honesty"], "anchor intact through evolution");
  });

  await t.test("character that diverges far from the anchor is FLAGGED (not corrected)", () => {
    const db = setupDb();
    // anchor values that the drift away from RAGE/FEAR won't express
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["serenity", "gentleness", "patience"], driveProfile: { SEEKING: 0.3, RAGE: 0.2, FEAR: 0.2, CARE: 0.3, PANIC: 0.2, PLAY: 0.3, LUST: 0.2 } });
    const ev = evolveCharacter(db, r.agentId, {
      peaks: Array.from({ length: 30 }, () => ({ dominantDrive: "RAGE", intensity: 0.95, valence: -0.7 })),
      maturity: 0.3,
    });
    assert.ok(ev.valueDrift > 0, "expressed character diverges from the anchor");
    assert.equal(ev.flagged, ev.valueDrift >= 0.6, "high divergence flags for human review (C3)");
  });

  await t.test("no peaks → no evolution (a calm life leaves character settled)", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w" });
    const ev = evolveCharacter(db, r.agentId, { peaks: [] });
    assert.equal(ev.evolved, false);
  });

  await t.test("getAutobiography reads as a life: name, values, character, peaks", () => {
    const db = setupDb();
    const r = createAgentSelf(db, { worldId: "w", coreValues: ["curiosity"] });
    evolveCharacter(db, r.agentId, { peaks: [{ dominantDrive: "SEEKING", intensity: 0.8, valence: 0.5 }] });
    const bio = getAutobiography(db, r.agentId);
    assert.ok(bio.name && Array.isArray(bio.values) && bio.character.dominantDrives.length === 3);
  });

  await t.test("totality: missing agent → clean error; never throws", () => {
    const db = setupDb();
    assert.equal(evolveCharacter(db, "nonexistent").ok, false);
    assert.equal(getAutobiography(db, "nonexistent"), null);
  });
});
