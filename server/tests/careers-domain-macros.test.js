// Macro surface for the living-career system (server/domains/careers.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB, and asserts the macro both delegates to
// the shipped libs (professions / career-engine / sparks-service /
// career-contracts) AND reads/mutates the database for real (computed values +
// round-trips, not just { ok:true }). Mirrors the register(domain, name, handler)
// collection pattern the server uses so we exercise the exact handlers without
// booting server.js.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCareerMacros from "../domains/careers.js";
import { up as upContracts } from "../migrations/312_career_contracts.js";

function collectMacros() {
  const map = new Map();
  registerCareerMacros((domain, name, handler) => {
    assert.equal(domain, "careers", `unexpected domain registration: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  // The career system reads/writes the canonical sparks stores. 048 ALTERs an
  // existing users table; in isolation we create it with the columns it needs.
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      sparks INTEGER NOT NULL DEFAULT 0,
      concordia_credits REAL NOT NULL DEFAULT 0
    );
    CREATE TABLE sparks_ledger (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, delta INTEGER NOT NULL,
      reason TEXT NOT NULL, world_id TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  upContracts(db);
  return db;
}
function seedUser(db, id, sparks = 0) {
  db.prepare(`INSERT INTO users (id, sparks) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET sparks = excluded.sparks`).run(id, sparks);
}
function getSparks(db, id) {
  return db.prepare(`SELECT sparks FROM users WHERE id = ?`).get(id)?.sparks ?? 0;
}
function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : undefined };
}

describe("careers domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full read + write surface", () => {
    for (const name of ["tracks", "ladder", "work", "contracts", "offer", "accept", "counter", "reject"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  // ── tracks: the profession taxonomy (real values, not just shape) ──────────
  it("tracks returns the real profession taxonomy with bound activities", async () => {
    const r = await macros.get("tracks")(ctxFor(db), {});
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.categories) && r.categories.includes("Culinary"));
    const chef = r.tracks.find((t) => t.id === "chef");
    assert.ok(chef, "chef track present");
    assert.equal(chef.category, "Culinary");
    assert.equal(chef.activity, "cook"); // the Sims-lie fix: profession binds to a real engine
  });

  // ── ladder: a track's 10-tier ladder with derived wage/skill gates ─────────
  it("ladder returns the 10-tier ladder for a real track and rejects unknown", async () => {
    const r = await macros.get("ladder")(ctxFor(db), { trackId: "smith" });
    assert.equal(r.ok, true);
    assert.equal(r.ladder.length, 10);
    assert.equal(r.ladder[0].tier, 1);
    assert.equal(r.ladder[9].tier, 10);
    assert.ok(r.ladder[9].wageBase > r.ladder[0].wageBase, "wage scales with tier");

    const bad = await macros.get("ladder")(ctxFor(db), { trackId: "no_such_track" });
    assert.equal(bad.ok, false);
    assert.equal(bad.reason, "unknown_track");
  });

  // ── work: PLAY a shift → sparks actually credited to the DB wallet ─────────
  it("work credits real sparks to the wallet and returns a computed wage/xp", async () => {
    seedUser(db, "player1", 0);
    const r = await macros.get("work")(ctxFor(db, "player1"), { trackId: "chef", tier: 5, attribute: 0.9, skillInput: 0.9 });
    assert.equal(r.ok, true);
    assert.equal(r.trackId, "chef");
    assert.equal(r.tier, 5);
    assert.ok(r.performanceScore > 0 && r.performanceScore <= 1, "performance in [0,1]");
    assert.ok(r.wage > 0, "earned a positive wage");
    assert.equal(r.paid, true);
    // the wallet really moved — not a pretended credit
    assert.equal(getSparks(db, "player1"), r.wage);
  });

  it("work requires auth and rejects an unknown track", async () => {
    const noAuth = await macros.get("work")(ctxFor(db), { trackId: "chef" });
    assert.equal(noAuth.ok, false);
    assert.equal(noAuth.reason, "auth_required");

    seedUser(db, "p2", 0);
    const badTrack = await macros.get("work")(ctxFor(db, "p2"), { trackId: "ghost_job" });
    assert.equal(badTrack.ok, false);
    assert.equal(badTrack.reason, "unknown_track");
  });

  // ── CONSTRUCTION RULE A: fail-CLOSED on poisoned numeric inputs ────────────
  it("work rejects poisoned numeric inputs before they reach the resolver", async () => {
    seedUser(db, "p3", 0);
    for (const bad of [
      { trackId: "chef", tier: Number.NaN },
      { trackId: "chef", attribute: Infinity },
      { trackId: "chef", skillInput: 1e308 },
      { trackId: "chef", tier: -5 },
    ]) {
      const r = await macros.get("work")(ctxFor(db, "p3"), bad);
      assert.equal(r.ok, false, `should reject ${JSON.stringify(bad)}`);
      assert.match(r.reason, /^invalid_/, `reason should be invalid_*, got ${r.reason}`);
    }
    // a poisoned shift never credited the wallet
    assert.equal(getSparks(db, "p3"), 0);
  });

  // ── contracts: offer → accept → persists → lists back (full round-trip) ────
  it("offer → accept persists the contract, pays the signing bonus, and lists back", async () => {
    seedUser(db, "employer", 1000);
    seedUser(db, "worker", 0);

    // employer offers the worker a chef contract with a signing bonus
    const offered = await macros.get("offer")(ctxFor(db, "employer"), {
      employerKind: "player", employerId: "employer",
      workerKind: "player", workerId: "worker",
      trackId: "chef", tier: 3, role: "Line Cook",
      baseWage: 40, signingBonus: 100, durationDays: 30,
    });
    assert.equal(offered.ok, true);
    const contractId = offered.contractId;
    assert.ok(contractId);

    // the offer is visible to the worker (the other party) as a real DB row
    const beforeAccept = await macros.get("contracts")(ctxFor(db, "worker"), {});
    assert.equal(beforeAccept.ok, true);
    const row = beforeAccept.contracts.find((c) => c.id === contractId);
    assert.ok(row, "offered contract listed for the worker");
    assert.equal(row.status, "offered");
    assert.equal(row.base_wage_sparks, 40);

    // the worker accepts → status flips to active + signing bonus moves
    const accepted = await macros.get("accept")(ctxFor(db, "worker"), { contractId });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.status, "active");
    assert.equal(accepted.bonusPaid, 100);
    assert.equal(getSparks(db, "worker"), 100, "worker received the signing bonus");
    assert.equal(getSparks(db, "employer"), 900, "employer paid the signing bonus");

    // round-trips back as active
    const afterAccept = await macros.get("contracts")(ctxFor(db, "worker"), {});
    assert.equal(afterAccept.contracts.find((c) => c.id === contractId).status, "active");
  });

  it("counter flips the standing offer, reject closes it, accept-own-offer is blocked", async () => {
    seedUser(db, "emp", 500);
    seedUser(db, "wrk", 0);
    const offered = await macros.get("offer")(ctxFor(db, "emp"), {
      employerKind: "player", employerId: "emp",
      workerKind: "player", workerId: "wrk",
      trackId: "smith", tier: 2, baseWage: 30, signingBonus: 0,
    });
    const contractId = offered.contractId;

    // the employer made the offer → cannot accept their own
    const ownAccept = await macros.get("accept")(ctxFor(db, "emp"), { contractId });
    assert.equal(ownAccept.ok, false);
    assert.equal(ownAccept.reason, "cannot_accept_own_offer");

    // worker counters with a higher wage
    const countered = await macros.get("counter")(ctxFor(db, "wrk"), { contractId, terms: { baseWage: 60 } });
    assert.equal(countered.ok, true);
    const row = db.prepare(`SELECT status, base_wage_sparks FROM career_contracts WHERE id = ?`).get(contractId);
    assert.equal(row.status, "countered");
    assert.equal(row.base_wage_sparks, 60);

    // employer rejects the counter
    const rejected = await macros.get("reject")(ctxFor(db, "emp"), { contractId });
    assert.equal(rejected.ok, true);
    assert.equal(rejected.status, "rejected");
    const finalRow = db.prepare(`SELECT status FROM career_contracts WHERE id = ?`).get(contractId);
    assert.equal(finalRow.status, "rejected");
  });

  it("offer rejects missing parties, unknown track, and poisoned numerics (fail-closed)", async () => {
    seedUser(db, "e1", 100);
    const missing = await macros.get("offer")(ctxFor(db, "e1"), { trackId: "chef" }); // no workerId
    assert.equal(missing.ok, false);
    assert.equal(missing.reason, "missing_parties");

    const unknown = await macros.get("offer")(ctxFor(db, "e1"), {
      employerId: "e1", workerKind: "npc", workerId: "n1", trackId: "ghost",
    });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown_track");

    const poisoned = await macros.get("offer")(ctxFor(db, "e1"), {
      employerId: "e1", workerKind: "npc", workerId: "n1", trackId: "chef", baseWage: Infinity,
    });
    assert.equal(poisoned.ok, false);
    assert.equal(poisoned.reason, "invalid_baseWage");
  });

  it("contracts requires auth and returns an empty list for a fresh user", async () => {
    const noAuth = await macros.get("contracts")(ctxFor(db), {});
    assert.equal(noAuth.ok, false);
    assert.equal(noAuth.reason, "auth_required");

    seedUser(db, "lonely", 0);
    const empty = await macros.get("contracts")(ctxFor(db, "lonely"), {});
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.contracts, []);
  });

  it("gates: every macro returns no_db without a db, and disabled when the flag is off", async () => {
    const r = await macros.get("tracks")({ actor: { userId: "x" } }, {});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");

    const prev = process.env.CONCORD_LIVING_CAREER;
    process.env.CONCORD_LIVING_CAREER = "0";
    try {
      const off = await macros.get("tracks")(ctxFor(db), {});
      assert.equal(off.ok, false);
      assert.equal(off.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_LIVING_CAREER;
      else process.env.CONCORD_LIVING_CAREER = prev;
    }
  });
});
