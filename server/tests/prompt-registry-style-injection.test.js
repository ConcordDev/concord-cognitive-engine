// Living chat / style learning — style-profile injection into composeSystemPrompt.
//
// Pins the wiring added so a user's REAL chat messages (fed through
// initiative-engine.js#learnStyle from server.js's `chat.respond` live path)
// actually shape ConKay's regular replies, not just proactive follow-ups:
//
//   (1) a casual, short, emoji-using learned profile injects casual/concise/
//       emoji guidance into the conscious-brain system prompt
//   (2) a formal, longer, no-emoji learned profile injects the opposite
//   (3) a user with NO learned profile yet gets no style guidance line at
//       all (honest-empty — never a fabricated/guessed default)
//   (4) missing db or missing userId degrades the same honest way, no crash
//   (5) the Modelfile-persona / DTU-citation functional layer is preserved
//       either way (style guidance ADDS, never replaces)
//
// Same lazy-bound-lookup shape as tests/world-voice-injection.test.js
// (ctx.worldId → _getWorldVoice); here ctx.userId + ctx.db → getStyleProfile.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as upInitiative } from "../migrations/029_initiative.js";
import { createInitiativeEngine } from "../lib/initiative-engine.js";
import { composeSystemPrompt, BRAIN_IDENTITY } from "../lib/prompt-registry.js";

function makeDb() {
  const db = new Database(":memory:");
  upInitiative(db);
  return db;
}

describe("style-profile injection into composeSystemPrompt", () => {
  let db, engine;
  // Ground truth, computed via the REAL engine (compute-don't-guess) — never
  // hand-paste expected formality/emoji values, read them back off the
  // actual learnStyle() result and assert the prompt reflects THAT.
  let casualProfile, formalProfile;
  const CASUAL_MSG = "hey lol 😀😂 whats up dude gonna check this out no cap";
  const FORMAL_MSG = "Good afternoon. I would like to formally request an update regarding the quarterly financial report, at your earliest convenience.";

  before(() => {
    db = makeDb();
    engine = createInitiativeEngine(db);
    casualProfile = engine.learnStyle("u-casual", CASUAL_MSG);
    formalProfile = engine.learnStyle("u-formal", FORMAL_MSG);
    // Sanity on the ground truth itself — these are the real thresholds the
    // prompt-registry injection branches on. If these ever stop holding,
    // the fixture messages need to change, not the assertions below.
    assert.ok(casualProfile.formalityLevel <= 0.35, `casual fixture formality ${casualProfile.formalityLevel} not <=0.35`);
    assert.ok(casualProfile.avgMessageLength > 0 && casualProfile.avgMessageLength <= 120);
    assert.ok(casualProfile.emojiRate >= 0.05);
    assert.ok(formalProfile.formalityLevel >= 0.65, `formal fixture formality ${formalProfile.formalityLevel} not >=0.65`);
    assert.ok(formalProfile.avgMessageLength > 120);
    assert.equal(formalProfile.emojiRate, 0);
  });

  it("a casual/short/emoji-using learned profile injects casual + concise + emoji guidance", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: "u-casual", db });
    assert.match(r.system, /Learned conversational style for this user/);
    assert.match(r.system, /casual\/informal phrasing with contractions/);
    assert.match(r.system, /concise replies/);
    assert.match(r.system, /occasional emoji reads naturally to them/);
    // Never the opposite bucket at the same time.
    assert.doesNotMatch(r.system, /more formal, fully-spelled-out phrasing/);
    assert.doesNotMatch(r.system, /no emoji\b/);
  });

  it("a formal/longer/no-emoji learned profile injects the opposite guidance", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: "u-formal", db });
    assert.match(r.system, /Learned conversational style for this user/);
    assert.match(r.system, /more formal, fully-spelled-out phrasing/);
    assert.match(r.system, /\bno emoji\b/);
    // Message was >120 chars — the concise bit must NOT fire.
    assert.doesNotMatch(r.system, /concise replies/);
    assert.doesNotMatch(r.system, /casual\/informal phrasing/);
  });

  it("a user with no learned profile yet gets no style guidance line (honest-empty)", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: "u-never-chatted", db });
    assert.doesNotMatch(r.system, /Learned conversational style for this user/);
  });

  it("missing db (userId only) degrades honestly — no crash, no guidance line", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: "u-casual", db: null });
    assert.doesNotMatch(r.system, /Learned conversational style for this user/);
  });

  it("missing userId (db only) degrades honestly — no crash, no guidance line", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: null, db });
    assert.doesNotMatch(r.system, /Learned conversational style for this user/);
  });

  it("no ctx fields at all still returns the ordinary prompt (back-compat)", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat" });
    assert.doesNotMatch(r.system, /Learned conversational style for this user/);
    assert.equal(r.useModelfileSystem, true);
  });

  it("style guidance ADDS to, never replaces, the functional/DTU-citation layer", () => {
    const r = composeSystemPrompt("conscious", { mode: "chat", userId: "u-casual", db });
    // The functional BRAIN_IDENTITY.conscious block (DTU citation rules,
    // architectural awareness, boundary) must still be present verbatim.
    assert.ok(r.system.includes(BRAIN_IDENTITY.conscious));
    assert.equal(r.useModelfileSystem, true);
    // Style guidance is appended after it, not substituted in.
    const dtuIdx = r.system.indexOf("DTU policy:");
    const styleIdx = r.system.indexOf("Learned conversational style for this user");
    assert.ok(dtuIdx >= 0 && styleIdx > dtuIdx);
  });

  it("different db instances get independent, correct profiles (no cross-db staleness)", () => {
    // A second db with a DIFFERENT profile for the same-shaped userId proves
    // the WeakMap-per-db engine cache doesn't leak a stale engine bound to
    // the first db object across independent db handles.
    const db2 = makeDb();
    const engine2 = createInitiativeEngine(db2);
    engine2.learnStyle("u-casual", FORMAL_MSG); // same userId, opposite style, different db

    const r1 = composeSystemPrompt("conscious", { userId: "u-casual", db });
    const r2 = composeSystemPrompt("conscious", { userId: "u-casual", db: db2 });
    assert.match(r1.system, /casual\/informal phrasing with contractions/);
    assert.match(r2.system, /more formal, fully-spelled-out phrasing/);
  });
});
