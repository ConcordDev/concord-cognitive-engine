// Phase CA-CF end-to-end smoke test.
//
// Walks the Convergence Sprint surfaces in one hermetic memDb run.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

// Migrations.
import { up as upClimb }      from "../../migrations/244_climbing_routes.js";
import { up as upRoguelite }  from "../../migrations/245_roguelite_runs.js";
import { up as upHorde }      from "../../migrations/246_horde_mode.js";
import { up as upFarm }       from "../../migrations/247_farm_plots.js";
import { up as upRestaurant } from "../../migrations/248_restaurant.js";
import { up as upTrivia }     from "../../migrations/249_trivia.js";
import { up as upHO }         from "../../migrations/250_hidden_object.js";
import { up as upTurn }       from "../../migrations/251_turn_combat.js";
import { up as upParty }      from "../../migrations/259_fluid_party_combat.js";
import { up as upHack }       from "../../migrations/252_hacking_puzzles.js";
import { up as upProg }       from "../../migrations/253_programming_puzzles.js";
import { up as upFactory }    from "../../migrations/254_claim_entities.js";
import { up as upLoops }      from "../../migrations/255_time_loops.js";
import { up as upHorror }     from "../../migrations/256_asymmetric_horror.js";
import { up as upPark }       from "../../migrations/257_theme_park.js";
import { up as upExtr }       from "../../migrations/258_extraction_runs.js";

// Libraries.
import { recordRoute }                          from "../../lib/climbing.js";
import { lockInDeduction }                      from "../../lib/detective.js";
import { inviteBrawl, acceptBrawl, _reset as brawlReset } from "../../lib/brawl.js";
import { startRun as rgStart, endRun as rgEnd, purchaseUnlock, getBalance } from "../../lib/roguelite.js";
import { startHorde, tickWave, endHorde }       from "../../lib/horde-mode.js";
import { plantSeed, harvestCrop }               from "../../lib/farming.js";
import { openRestaurant, placeOrder, serveOrder } from "../../lib/restaurant.js";
import { authorQuestion, startSession, submitAnswer, tallySession } from "../../lib/trivia.js";
import { createScene, playScene, submitFind }   from "../../lib/hidden-object.js";
import { startCombat as startParty, queueAction, resolveTick, setTimeScale } from "../../lib/party-combat.js";
import { authorPuzzle as authorHack, attemptCommand } from "../../lib/hacking.js";
import { authorPuzzle as authorCp, submitSolution }    from "../../lib/programming-puzzle.js";
import { placeEntity, depositToEntity, tickClaimFactory, connectEntities, getInventory } from "../../lib/factory.js";
import { startLoop, endLoop, recordMemory, getMemories } from "../../lib/time-loop.js";
import { startSession as startHorror, joinAsInvestigator, recordSighting } from "../../lib/horror.js";
import { openAttraction, tickVisitors, getAttraction } from "../../lib/theme-park.js";
import { startRun as startExtr, pickupLoot, declareExtractionZone, extract } from "../../lib/extraction.js";

function bootDb() {
  const db = new Database(":memory:");
  // Minimal stubs for cross-table joins the libs need.
  db.exec(`
    CREATE TABLE land_claims (id TEXT PRIMARY KEY, owner_user_id TEXT, world_id TEXT, anchor_x REAL, anchor_z REAL, radius_m REAL, bond_sparks REAL, maintenance_per_day REAL, claimed_at INTEGER, last_maintained_at INTEGER, status TEXT);
    CREATE TABLE crime_events (id TEXT PRIMARY KEY, world_id TEXT, crime_type TEXT, location_type TEXT, location_id TEXT, criminal_id TEXT, criminal_type TEXT, victim_id TEXT, victim_type TEXT, evidence TEXT DEFAULT '[]', witnesses TEXT DEFAULT '[]', status TEXT DEFAULT 'open', detective_id TEXT, suspect_ids TEXT DEFAULT '[]', confidence REAL DEFAULT 0, stolen_items TEXT DEFAULT '[]', occurred_at INTEGER, resolved_at INTEGER, report_text TEXT);
    CREATE TABLE evidence_items (id TEXT PRIMARY KEY, crime_event_id TEXT, world_id TEXT, evidence_type TEXT, description TEXT, links_to_id TEXT, links_to_type TEXT, confidence_boost REAL DEFAULT 0.1, collected_by TEXT, collected_at INTEGER, decay_at INTEGER, created_at INTEGER);
    CREATE TABLE arrest_records (id TEXT PRIMARY KEY, world_id TEXT, crime_id TEXT, arresting_detective_id TEXT, suspect_id TEXT, suspect_type TEXT, charges TEXT, evidence_summary TEXT, verdict TEXT, sentence_type TEXT, sentence_data TEXT, processed_at INTEGER);
  `);
  upClimb(db); upRoguelite(db); upHorde(db); upFarm(db); upRestaurant(db);
  upTrivia(db); upHO(db); upTurn(db); upParty(db); upHack(db); upProg(db);
  upFactory(db); upLoops(db); upHorror(db); upPark(db); upExtr(db);
  return db;
}

describe("Phase CA-CF — Convergence Sprint end-to-end", () => {
  it("walks the full journey without exception", () => {
    const db = bootDb();
    brawlReset();

    // ── CA3 climbing ──────────────────────────────────────────────────
    const climb = recordRoute(db, "u1", {
      worldId: "tunya", startX: 0, startY: 100, startZ: 0,
      endX: 0, endY: 250, endZ: 0, peakAltitude: 250, durationS: 180,
    });
    assert.equal(climb.heightClimbed, 150);

    // ── CA5 detective ─────────────────────────────────────────────────
    db.prepare(`INSERT INTO crime_events (id, world_id, crime_type, location_type, location_id, criminal_id, criminal_type, status, occurred_at) VALUES ('cr1', 'tunya', 'theft', 'room', 'r1', 'npc-x', 'npc', 'open', unixepoch())`).run();
    const d = lockInDeduction(db, "u1", "cr1", { suspectId: "npc-x", weapon: "theft", motive: "money" });
    assert.equal(d.solved, true);

    // ── CA7 brawl ─────────────────────────────────────────────────────
    const inv = inviteBrawl("u1", "u2");
    const acc = acceptBrawl(inv.inviteId, "u2");
    assert.equal(acc.profile, "sifu_brawler");

    // ── CB1 roguelite ─────────────────────────────────────────────────
    const rg = rgStart(db, "u1", { worldId: "tunya", regionId: "reg-1" });
    rgEnd(db, rg.runId, { reason: "extract", depthReached: 20 });
    const purch = purchaseUnlock(db, "u1", "extra_slot", 50);
    assert.equal(purch.ok, true);

    // ── CB2 horde ─────────────────────────────────────────────────────
    const hd = startHorde(db, "u1", { worldId: "tunya" });
    const tw = tickWave(db, hd.runId, { killsThisWave: 30 });
    assert.equal(tw.upgradeChoices.length, 3);
    endHorde(db, hd.runId, { reason: "death" });

    // ── CB3 farm ──────────────────────────────────────────────────────
    db.prepare(`INSERT INTO land_claims VALUES ('lc-1', 'u1', 'tunya', 0, 0, 50, 50, 5, unixepoch(), unixepoch(), 'active')`).run();
    plantSeed(db, "u1", { claimId: "lc-1", tileX: 0, tileY: 0, cropKind: "wheat", currentSeasonIdx: 0, currentDay: 0, isOwner: () => true });
    db.prepare(`UPDATE claim_crops SET growth_stage = 3`).run();
    const harvest = harvestCrop(db, "u1", { claimId: "lc-1", tileX: 0, tileY: 0, isOwner: () => true });
    assert.equal(harvest.harvested.itemId, "wheat");

    // ── CB4 restaurant ────────────────────────────────────────────────
    const rs = openRestaurant(db, "u1", { worldId: "tunya" });
    const ord = placeOrder(db, rs.restaurantId, { customerNpcId: "npc-c", dishId: "stew" });
    const sv = serveOrder(db, "u1", ord.orderId);
    assert.equal(sv.ok, true);

    // ── CB5 trivia ────────────────────────────────────────────────────
    authorQuestion(db, { dtuId: "dtu-q", questionText: "Who?", answerDtuId: "dtu-a", difficulty: 2, createdBy: "u1" });
    const qId = db.prepare(`SELECT id FROM trivia_questions`).get().id;
    const ts = startSession(db, "u1", { questionIds: [qId] });
    const sub = submitAnswer(db, ts.sessionId, "u2", { questionId: qId, citedDtuId: "dtu-a" });
    assert.equal(sub.isCorrect, true);
    const tally = tallySession(db, ts.sessionId);
    assert.equal(tally.scoreboard.u2, 2);

    // ── CB6 hidden object ─────────────────────────────────────────────
    const hos = createScene(db, "u1", { sceneDtuId: "dtu-photo", targets: [{ id: "key", label: "k", x: 0, y: 0, w: 10, h: 10 }] });
    const hop = playScene(db, "u2", hos.sceneId);
    const found = submitFind(db, hop.runId, { x: 5, y: 5 });
    assert.equal(found.complete, true);

    // ── CC1 fluid party combat (real-time-with-pause) ────────────────
    const pc = startParty(db, { worldId: "tunya", participants: [
      { entityId: "alice", team: "blue", hp: 100, x: 0, z: 0 },
      { entityId: "bob",   team: "red",  hp: 100, x: 1, z: 0 },
    ] });
    // Pause, queue, resume, tick — RTwP shape.
    setTimeScale(db, pc.sessionId, 0);
    queueAction(db, pc.sessionId, "alice", {
      kind: "attack",
      payload: { kind: "attack", targetId: "bob", damage: 100, range: 2 },
    });
    setTimeScale(db, pc.sessionId, 1.0);
    const pcTick = resolveTick(db, pc.sessionId, Date.now());
    assert.equal(pcTick.winnerTeam, "blue");

    // ── CC2 hacking ───────────────────────────────────────────────────
    const hp = authorHack(db, { name: "x", terminalTree: {}, solutionPath: ["ls"] });
    const hc = attemptCommand(db, hp.puzzleId, "u1", "ls");
    assert.equal(hc.completed, true);

    // ── CC3 programming puzzle ────────────────────────────────────────
    const pp = authorCp(db, { name: "echo", testCases: [{ input: [7], expected: [7] }] });
    const ps = submitSolution(db, "u1", pp.puzzleId, [{ op: "OUT", src: "INP" }]);
    assert.equal(ps.accepted, true);

    // ── CC4 factory ───────────────────────────────────────────────────
    const belt = placeEntity(db, "u1", { claimId: "lc-1", entityType: "belt", tileX: 5, tileY: 0, isOwner: () => true });
    const chest = placeEntity(db, "u1", { claimId: "lc-1", entityType: "chest", tileX: 6, tileY: 0, isOwner: () => true });
    connectEntities(db, "u1", belt.entityId, chest.entityId, { isOwner: () => true });
    depositToEntity(db, belt.entityId, { itemDescriptor: "ore", quantity: 1 });
    tickClaimFactory(db, "lc-1");
    const chestInv = getInventory(db, chest.entityId);
    assert.equal(chestInv[0].quantity, 1);

    // ── CC5 time loop ─────────────────────────────────────────────────
    const tl = startLoop(db, "u1", { worldId: "loop-world" });
    recordMemory(db, "u1", { worldId: "loop-world", summary: "trust no one", firstLoopNumber: 1 });
    endLoop(db, tl.sessionId, { reason: "death" });
    const tl2 = startLoop(db, "u1", { worldId: "loop-world" });
    assert.equal(tl2.loopNumber, 2);
    const mems = getMemories(db, "u1", "loop-world");
    assert.equal(mems.length, 1);

    // ── CC6 horror ────────────────────────────────────────────────────
    const hs = startHorror(db, "ghost", { worldId: "tunya" });
    joinAsInvestigator(db, hs.sessionId, "inv1");
    recordSighting(db, hs.sessionId, "inv1", { x: 1, y: 1, z: 1, sightingKind: "blur" });
    recordSighting(db, hs.sessionId, "inv1", { x: 1, y: 1, z: 1, sightingKind: "voice" });
    const win = recordSighting(db, hs.sessionId, "inv1", { x: 1, y: 1, z: 1, sightingKind: "writing" });
    assert.equal(win.winner, "investigators");

    // ── CC7 theme park ────────────────────────────────────────────────
    const att = openAttraction(db, "u1", { worldId: "tunya", attractionKind: "ride", ticketCc: 10 });
    tickVisitors(db, "tunya", { newArrivals: 2 });
    const a = getAttraction(db, att.attractionId);
    assert.equal(a.total_visits, 2);

    // ── CC8 extraction ────────────────────────────────────────────────
    const ex = startExtr(db, "u1", { worldId: "tunya" });
    pickupLoot(db, ex.runId, { itemId: "rare", quantity: 1 });
    declareExtractionZone(db, { worldId: "tunya", x: 0, z: 0, radiusM: 10 });
    const exr = extract(db, ex.runId, { x: 5, z: 5 });
    assert.equal(exr.extracted, true);
  });
});
