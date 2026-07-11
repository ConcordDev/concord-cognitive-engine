// server/tests/quest-moral-branch.test.js
//
// Wave 4 gap-closure — docs/concordia-specs/quests-dialogue-capability-map.md
// §3/§6#1: moral_branch/reputation_change is authored across 11 quest files
// and was read by zero lines of server or frontend code.
//
// This is a REAL round-trip against the actual schema (no mocked db): boots
// the real server (content-seeder runs at boot, so the real
// content/quests/main-arc.json + content/world/npcs.json + factions.json are
// seeded), then drives the real macro path:
//
//   quest.resolve_moral_branch  (server.js)
//     → applyMoralBranchChoice   (lib/quests/moral-branch.js)
//       → recordOpinionEvent     (lib/npc-opinions.js)          — personal
//       → refreshOneFactionReputation (lib/faction-reputation.js) — faction
//
// and asserts the player's actual reputation in the DB — via the SAME real
// computeFactionReputation/getOpinion functions production code calls, not
// hand-derived arithmetic ("compute don't guess", CLAUDE.md).
//
// Fixture used: content/quests/main-arc.json's "warden_crackdown" quest,
// option "warn_rael" — reputation_change: { captain_rael_personal: 30,
// iron_wardens: -15, scholars_guild: 10 }. captain_rael (faction iron_wardens)
// is a real authored hub NPC; iron_wardens (6 members) and scholars_guild (6
// members) are real authored hub factions per content/world/{npcs,factions}.json.
// The "quest" domain's macros are registered by server.js's ghost-fleet
// loader (initGhostFleet), which is deliberately deferred behind a
// CONCORD_GHOST_FLEET_DELAY_MS setTimeout (default 20s in production, so a
// player's very first requests don't contend with boot-critical work). Set
// it to a small value BEFORE anything imports server.js (the harness's
// load() dynamic-imports it lazily inside macroRuntime(), so this top-level
// assignment — which runs at module-eval time, before any before()/it()
// callback body executes — always wins the race).
process.env.CONCORD_GHOST_FLEET_DELAY_MS = process.env.CONCORD_GHOST_FLEET_DELAY_MS || "10";

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { macroRuntime, load } from "./depth/_harness.js";
import { getOpinion } from "../lib/npc-opinions.js";
import { computeFactionReputation, getFactionReputation } from "../lib/faction-reputation.js";
import { getMoralBranch, resolveReputationTarget } from "../lib/quests/moral-branch.js";

const WORLD = "concordia-hub";
const QUEST_ID = "warden_crackdown";
const OPTION_ID = "warn_rael";

/** Poll until the ghost-fleet-registered quest.resolve_moral_branch macro
 * lands in MACROS (initGhostFleet runs async, off a setTimeout, and loads
 * each of its ~30 modules with a 2s stagger between them — quest-engine is
 * roughly the 8th-9th module in that sequence, so this can take ~20s+). */
async function waitForQuestDomain(timeoutMs = 45000) {
  const { MACROS } = await load();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (MACROS.get("quest")?.has("resolve_moral_branch")) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("timed out waiting for quest.resolve_moral_branch to register via ghost fleet");
}

describe("moral_branch content is genuinely authored (sanity check on the fixture)", () => {
  let runMacro, ctx;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime(`moral-branch-fixture-${randomUUID()}`));
    await waitForQuestDomain();
  });

  it("warden_crackdown carries the moral_branch payload post-boot (content-seeder retained it)", async () => {
    // Touch the seeded state via a real macro call so we know boot/seed has
    // actually completed before reading the in-memory _authoredQuests map.
    await runMacro("quest", "list", {}, ctx);
    const branch = getMoralBranch(QUEST_ID);
    assert.ok(branch, "expected warden_crackdown to carry an authored moral_branch");
    const opt = branch.options.find((o) => o.id === OPTION_ID);
    assert.ok(opt, "expected the warn_rael option to exist");
    assert.deepEqual(opt.reputation_change, {
      captain_rael_personal: 30,
      iron_wardens: -15,
      scholars_guild: 10,
    });
  });
});

describe("quest.resolve_moral_branch — real reputation round-trip", () => {
  let runMacro, STATE, db, ctx, userId;

  before(async () => {
    const rt = await macroRuntime(`moral-branch-apply-${randomUUID()}`);
    runMacro = rt.runMacro;
    STATE = rt.STATE;
    ctx = rt.ctx;
    db = STATE.db;
    userId = `u_moral_branch_${randomUUID()}`;
    await waitForQuestDomain();
  });

  it("resolveReputationTarget resolves the fixture's three keys correctly against the real seeded content", () => {
    assert.deepEqual(resolveReputationTarget(db, "captain_rael_personal", WORLD), { kind: "npc", id: "captain_rael" });
    assert.deepEqual(resolveReputationTarget(db, "iron_wardens", WORLD), { kind: "faction", id: "iron_wardens" });
    assert.deepEqual(resolveReputationTarget(db, "scholars_guild", WORLD), { kind: "faction", id: "scholars_guild" });
    assert.equal(resolveReputationTarget(db, "not_a_real_key_at_all", WORLD), null);
  });

  it("a fresh player starts at neutral/zero reputation with iron_wardens and scholars_guild", () => {
    const iw = computeFactionReputation(db, userId, "iron_wardens", WORLD);
    const sg = computeFactionReputation(db, userId, "scholars_guild", WORLD);
    assert.equal(iw.score, 0);
    assert.equal(iw.tier, "neutral");
    assert.equal(sg.score, 0);
    const rael = getOpinion(db, "captain_rael", "player", userId);
    assert.equal(rael, null, "no opinion row should exist yet for a fresh user");
  });

  // captain_rael is HERSELF an iron_wardens member (content/world/npcs.json:
  // faction_id "iron_wardens"), so warn_rael's reputation_change hits her
  // twice: +30 as the personal "captain_rael_personal" target, then -15
  // again as one of the "iron_wardens" faction's own members — the two keys
  // are independent narrative axes ("what Rael personally feels" vs. "what
  // the Wardens institutionally feel"), but they compound on the same
  // underlying character_opinions row since she is both things at once.
  // Expected values below are DERIVED from the real seeded NPC roster
  // (queried live, not hardcoded), per this project's "compute don't guess"
  // methodology — hardcoding "6 members" would silently drift if the
  // authored roster ever grows.
  function ironWardensMembers() {
    return db.prepare(`SELECT id FROM world_npcs WHERE faction = ? AND world_id = ?`).all("iron_wardens", WORLD);
  }
  function scholarsGuildMembers() {
    return db.prepare(`SELECT id FROM world_npcs WHERE faction = ? AND world_id = ?`).all("scholars_guild", WORLD);
  }

  it("resolving warden_crackdown/warn_rael applies all three reputation_change deltas", async () => {
    const iwMembers = ironWardensMembers();
    const sgMembers = scholarsGuildMembers();
    assert.ok(iwMembers.some((m) => m.id === "captain_rael"), "fixture assumption: captain_rael must be an iron_wardens member");
    assert.ok(!sgMembers.some((m) => m.id === "captain_rael"), "fixture assumption: captain_rael must NOT also be a scholars_guild member");
    // Every non-captain_rael iron_wardens member nets exactly -15; captain_rael
    // nets +30 (personal) then -15 (faction) = +15.
    const expectedIwScore = ((iwMembers.length - 1) * -15 + 15) / iwMembers.length;
    const expectedSgScore = 10; // clean, no overlapping personal target

    const r = await runMacro("quest", "resolve_moral_branch", {
      questAuthoredId: QUEST_ID,
      optionId: OPTION_ID,
      userId,
      worldId: WORLD,
    }, ctx);

    assert.equal(r.ok, true);
    assert.equal(r.questAuthoredId, QUEST_ID);
    assert.equal(r.optionId, OPTION_ID);
    assert.equal(r.trigger, "tell_rael_truth");
    assert.equal(r.unresolved.length, 0, `expected every key to resolve; unresolved=${JSON.stringify(r.unresolved)}`);
    assert.equal(r.applied.length, 3);

    // Personal opinion — real character_opinions row, via the real getOpinion().
    const rael = getOpinion(db, "captain_rael", "player", userId);
    assert.ok(rael, "expected a character_opinions row for captain_rael");
    assert.equal(rael.score, 15);
    assert.equal(rael.kind, "respects"); // KIND_FROM_SCORE: score>=10 → "respects" (lib/npc-opinions.js)

    // Faction reputation — via the REAL computeFactionReputation aggregate
    // (average of every touched member's opinion), not hand math.
    const iw = computeFactionReputation(db, userId, "iron_wardens", WORLD);
    assert.equal(iw.score, expectedIwScore);
    const sg = computeFactionReputation(db, userId, "scholars_guild", WORLD);
    assert.equal(sg.score, expectedSgScore);

    // The cache row was refreshed immediately (not waiting on the ~15min
    // faction-rep-cache-refresh heartbeat) — getFactionReputation reads the
    // cache table directly.
    const iwCached = getFactionReputation(db, userId, "iron_wardens", WORLD);
    assert.equal(iwCached.score, expectedIwScore);
    const sgCached = getFactionReputation(db, userId, "scholars_guild", WORLD);
    assert.equal(sgCached.score, expectedSgScore);

    // Every one of iron_wardens'/scholars_guild's real seeded members
    // actually got touched, matching the live roster exactly.
    const iwApplied = r.applied.find((a) => a.factionId === "iron_wardens");
    assert.equal(iwApplied.npcsTouched, iwMembers.length);
    const sgApplied = r.applied.find((a) => a.factionId === "scholars_guild");
    assert.equal(sgApplied.npcsTouched, sgMembers.length);
  });

  it("is idempotent — re-resolving the same quest for the same player is a no-op, not a double-application", async () => {
    const iwMembers = ironWardensMembers();
    const expectedIwScore = ((iwMembers.length - 1) * -15 + 15) / iwMembers.length;

    const before1 = getOpinion(db, "captain_rael", "player", userId);
    const r2 = await runMacro("quest", "resolve_moral_branch", {
      questAuthoredId: QUEST_ID,
      optionId: OPTION_ID,
      userId,
      worldId: WORLD,
    }, ctx);
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "already_chosen");
    assert.equal(r2.existingOptionId, OPTION_ID);

    const after1 = getOpinion(db, "captain_rael", "player", userId);
    assert.equal(after1.score, before1.score, "reputation must not double-apply on a retried call");
    assert.equal(after1.score, 15);

    const iw = computeFactionReputation(db, userId, "iron_wardens", WORLD);
    assert.equal(iw.score, expectedIwScore, "faction reputation must not double-apply on a retried call either");
  });

  it("a different player choosing the OTHER branch option gets the other option's deltas, independently", async () => {
    const iwMembers = ironWardensMembers();
    const expectedIwScore = ((iwMembers.length - 1) * -15 + 15) / iwMembers.length;

    const otherUser = `u_moral_branch_other_${randomUUID()}`;
    const r = await runMacro("quest", "resolve_moral_branch", {
      questAuthoredId: QUEST_ID,
      optionId: "deflect_rael",
      userId: otherUser,
      worldId: WORLD,
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.applied.length, 1); // deflect_rael only touches captain_rael_personal
    const rael = getOpinion(db, "captain_rael", "player", otherUser);
    assert.equal(rael.score, -5);

    // The first player's reputation from the earlier test is untouched by
    // this second, independent player's choice.
    const firstIw = computeFactionReputation(db, userId, "iron_wardens", WORLD);
    assert.equal(firstIw.score, expectedIwScore);
  });

  it("rejects an unknown quest / unknown option honestly (no reputation_change fabricated)", async () => {
    const rNoBranch = await runMacro("quest", "resolve_moral_branch", {
      questAuthoredId: "not_a_real_quest_id",
      optionId: "whatever",
      userId,
      worldId: WORLD,
    }, ctx);
    assert.equal(rNoBranch.ok, false);
    assert.equal(rNoBranch.reason, "no_moral_branch");

    const rBadOption = await runMacro("quest", "resolve_moral_branch", {
      questAuthoredId: QUEST_ID,
      optionId: "not_a_real_option",
      userId: `u_moral_branch_badopt_${randomUUID()}`,
      worldId: WORLD,
    }, ctx);
    assert.equal(rBadOption.ok, false);
    assert.equal(rBadOption.reason, "option_not_found");
  });
});
