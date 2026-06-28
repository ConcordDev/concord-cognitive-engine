// Macro surface for the courtship lens (server/domains/courtship.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB built from the actual migration (206), and
// asserts each macro both delegates to the romance-engine lib AND mutates/reads
// the database for REAL: affinity values change by the engine delta, propose is
// gated at the canonical ENGAGE_THRESHOLD, wed is gated at MARRY_THRESHOLD, and
// spouse-reactivity moves a married spouse's affinity. No { ok:true }-only
// assertions — every act asserts a concrete computed value or a real DB row.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCourtshipMacros from "../domains/courtship.js";
import { up as upRomance } from "../migrations/206_romance.js";
import { ROMANCE_CONSTANTS } from "../lib/romance-engine.js";

function collectMacros() {
  const map = new Map();
  registerCourtshipMacros((domain, name, handler) => {
    assert.equal(domain, "courtship", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  upRomance(db);
  // spouse-reactivity reads world_npcs / npc_opinions / faction_relations /
  // npc_stress; create the minimal shapes it guards on so the cruel/kin/faction
  // branches don't false-positive (it degrades to neutral when absent anyway).
  db.exec(`
    CREATE TABLE world_npcs (id TEXT PRIMARY KEY, faction TEXT, world_id TEXT);
    CREATE TABLE npc_relations (npc_id TEXT, related_npc_id TEXT);
  `);
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });
const PK = "npc", PID = "npc_lyra";

// Raise a courtship to a target affinity by repeated +1 interactions.
async function raiseAffinityTo(macros, db, userId, target) {
  let last = 0;
  for (let i = 0; i < 60; i++) {
    const r = await macros.get("interact")(ctxFor(db, userId), { partnerKind: PK, partnerId: PID, sentiment: 1 });
    last = r.affinity;
    if (last >= target) break;
  }
  return last;
}

describe("courtship domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + act surface", () => {
    for (const name of [
      "list", "get", "interact", "propose", "wed", "marriages",
      "dissolve", "conceive", "birth", "children", "spouses",
      "spouse_react", "constants",
    ]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("constants exposes the canonical propose/marry thresholds", async () => {
    const r = await macros.get("constants")(ctxFor(db, "u1"), {});
    assert.equal(r.ok, true);
    assert.equal(r.constants.ENGAGE_THRESHOLD, ROMANCE_CONSTANTS.ENGAGE_THRESHOLD);
    assert.equal(r.constants.MARRY_THRESHOLD, ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    assert.ok(r.constants.ENGAGE_THRESHOLD > 0 && r.constants.ENGAGE_THRESHOLD < 1);
  });

  it("interact creates a courtship row and moves affinity by the engine delta", async () => {
    const before = await macros.get("list")(ctxFor(db, "u1"), {});
    assert.equal(before.courtships.length, 0, "empty state");

    const r = await macros.get("interact")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID, sentiment: 1 });
    assert.equal(r.ok, true);
    // delta = COURT_AFFINITY_DELTA * 1 — a real computed value, not a flag.
    assert.ok(Math.abs(r.affinity - ROMANCE_CONSTANTS.COURT_AFFINITY_DELTA) < 1e-9,
      `expected ${ROMANCE_CONSTANTS.COURT_AFFINITY_DELTA}, got ${r.affinity}`);

    const row = db.prepare(
      "SELECT affinity, status FROM player_courtship WHERE player_user_id=? AND partner_id=?"
    ).get("u1", PID);
    assert.ok(row, "row persisted");
    assert.ok(Math.abs(row.affinity - ROMANCE_CONSTANTS.COURT_AFFINITY_DELTA) < 1e-9);
  });

  it("propose is REJECTED below ENGAGE_THRESHOLD and accepted at/above it", async () => {
    // One interaction → affinity well below 0.70.
    await macros.get("interact")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID, sentiment: 1 });
    const low = await macros.get("propose")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(low.ok, false);
    assert.equal(low.reason, "affinity_too_low");
    assert.equal(low.required, ROMANCE_CONSTANTS.ENGAGE_THRESHOLD);

    // Raise above the engage threshold, then propose succeeds → status 'engaged'.
    const aff = await raiseAffinityTo(macros, db, "u1", ROMANCE_CONSTANTS.ENGAGE_THRESHOLD);
    assert.ok(aff >= ROMANCE_CONSTANTS.ENGAGE_THRESHOLD, `affinity ${aff} not raised`);
    const ok = await macros.get("propose")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(ok.ok, true);
    assert.equal(ok.status, "engaged");

    const row = db.prepare(
      "SELECT status FROM player_courtship WHERE player_user_id=? AND partner_id=?"
    ).get("u1", PID);
    assert.equal(row.status, "engaged");
  });

  it("wed requires engagement AND MARRY_THRESHOLD, then writes a marriage row", async () => {
    // Raise above the marry threshold so wed isn't blocked on affinity.
    await raiseAffinityTo(macros, db, "u1", ROMANCE_CONSTANTS.MARRY_THRESHOLD);

    // Not engaged yet → wed rejected.
    const notEngaged = await macros.get("wed")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(notEngaged.ok, false);
    assert.equal(notEngaged.reason, "not_engaged");

    await macros.get("propose")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    const wedded = await macros.get("wed")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(wedded.ok, true);
    assert.equal(wedded.status, "married");
    assert.ok(wedded.marriageId);

    const m = await macros.get("marriages")(ctxFor(db, "u1"), {});
    assert.equal(m.ok, true);
    assert.equal(m.marriages.length, 1);
    assert.equal(m.marriages[0].partner_id, PID);
    assert.ok(Array.isArray(m.children));
  });

  it("conceive requires marriage, then birth produces a child the children macro returns", async () => {
    // No marriage → conceive rejected.
    const noMarriage = await macros.get("conceive")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(noMarriage.ok, false);
    assert.equal(noMarriage.reason, "must_be_married_to_conceive");

    // Marry, then conceive + birth.
    await raiseAffinityTo(macros, db, "u1", ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    await macros.get("propose")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    await macros.get("wed")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });

    const preg = await macros.get("conceive")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(preg.ok, true);
    assert.ok(preg.pregnancyId);

    const birth = await macros.get("birth")(ctxFor(db, "u1"), {
      pregnancyId: preg.pregnancyId,
      name: "Asbir",
      parentSkills: { mum: { swordsmanship: 50 } },
    });
    assert.equal(birth.ok, true);
    assert.equal(birth.name, "Asbir");
    // inheritSkills = 80% of best parent skill — a real computed value.
    assert.ok(Math.abs(birth.inheritedSkills.swordsmanship - 50 * ROMANCE_CONSTANTS.SKILL_INHERITANCE_FRAC) < 1e-9);

    const kids = await macros.get("children")(ctxFor(db, "u1"), {});
    assert.equal(kids.ok, true);
    assert.equal(kids.children.length, 1);
    assert.equal(kids.children[0].name, "Asbir");
  });

  it("spouse_react moves a married spouse's affinity (deterministic, real DB write)", async () => {
    // Wed an NPC whose faction we then betray.
    db.prepare("INSERT INTO world_npcs (id, faction, world_id) VALUES (?,?,?)").run(PID, "house_var", "concordia-hub");
    await raiseAffinityTo(macros, db, "u1", ROMANCE_CONSTANTS.MARRY_THRESHOLD);
    await macros.get("propose")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    await macros.get("wed")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });

    const before = db.prepare(
      "SELECT affinity FROM player_courtship WHERE player_user_id=? AND partner_id=?"
    ).get("u1", PID).affinity;

    const react = await macros.get("spouse_react")(ctxFor(db, "u1"), {
      kind: "faction_betray", factionId: "house_var",
    });
    assert.equal(react.ok, true);
    assert.equal(react.reactions.length, 1);
    // Betraying the spouse's own faction is a negative delta.
    assert.ok(react.reactions[0].delta < 0, `expected negative delta, got ${react.reactions[0].delta}`);

    const after = db.prepare(
      "SELECT affinity FROM player_courtship WHERE player_user_id=? AND partner_id=?"
    ).get("u1", PID).affinity;
    assert.ok(after < before, `affinity should drop: ${before} → ${after}`);
  });

  it("get returns a real courtship and no_courtship for an unknown partner", async () => {
    await macros.get("interact")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID, sentiment: 1 });
    const got = await macros.get("get")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: PID });
    assert.equal(got.ok, true);
    assert.equal(got.courtship.partner_id, PID);

    const missing = await macros.get("get")(ctxFor(db, "u1"), { partnerKind: PK, partnerId: "nobody" });
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "no_courtship");
  });

  it("guards: no db / no user / missing inputs are rejected, not crashed", async () => {
    assert.equal((await macros.get("list")({}, {})).reason, "no_db");
    assert.equal((await macros.get("list")(ctxFor(db, null), {})).reason, "no_user");
    assert.equal((await macros.get("propose")(ctxFor(db, "u1"), {})).reason, "missing_inputs");
    assert.equal((await macros.get("interact")(ctxFor(db, "u1"), {})).reason, "missing_inputs");
  });
});
