// server/tests/INC-104-authz.test.js
//
// Regression pins for INC-104 — careers contract negotiation authorization.
// A non-party could counter or reject an open offer, and any logged-in user
// could forge a contract naming two other players as employer and worker.
// After the fix: the caller must be one of the contract parties for
// offer / counter / reject / accept; accept still works for the counterparty.
//
// Run:
//   cd server && NODE_ENV=test nice node --test --test-concurrency=2 --import=./tests/preload/no-egress.mjs tests/INC-104-authz.test.js

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerCareerMacros from "../domains/careers.js";

function collectMacros() {
  const map = new Map();
  registerCareerMacros((domain, name, handler) => {
    assert.equal(domain, "careers", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

async function freshDb() {
  const db = new Database(":memory:");
  await runMigrations(db);
  return db;
}

function seedUser(db, id, sparks = 0) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at, sparks)
     VALUES (?, ?, ?, 'x', ?, ?)
     ON CONFLICT(id) DO UPDATE SET sparks = excluded.sparks`
  ).run(id, id, `${id}@test.local`, now, sparks);
}

function ctxFor(db, userId) {
  return { db, actor: userId ? { userId } : undefined };
}

async function offerBetween(db, macros, employerId, workerId, opts = {}) {
  return macros.get("offer")(ctxFor(db, employerId), {
    employerKind: "player",
    employerId,
    workerKind: "player",
    workerId,
    trackId: "chef",
    tier: 1,
    baseWage: 10,
    signingBonus: 0,
    ...opts,
  });
}

describe("INC-104 — careers contract authz", () => {
  let db, macros;

  beforeEach(async () => {
    db = await freshDb();
    macros = collectMacros();
    seedUser(db, "playerA", 1000);
    seedUser(db, "playerB", 0);
    seedUser(db, "playerC", 0);
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* noop */
    }
  });

  it("non-party cannot counter an open offer and the row is unchanged", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB");
    assert.equal(o.ok, true, o.reason);

    const before = db
      .prepare(
        `SELECT status, base_wage_sparks, last_offer_by FROM career_contracts WHERE id = ?`
      )
      .get(o.contractId);

    const counter = await macros.get("counter")(ctxFor(db, "playerC"), {
      contractId: o.contractId,
      terms: { baseWage: 999 },
    });
    assert.equal(counter.ok, false);
    assert.equal(counter.reason, "not_a_party");

    const after = db
      .prepare(
        `SELECT status, base_wage_sparks, last_offer_by FROM career_contracts WHERE id = ?`
      )
      .get(o.contractId);
    assert.deepEqual(after, before);
  });

  it("non-party cannot reject an open offer and the row is unchanged", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB");
    assert.equal(o.ok, true, o.reason);

    const before = db
      .prepare(`SELECT status, last_offer_by FROM career_contracts WHERE id = ?`)
      .get(o.contractId);

    const rejected = await macros.get("reject")(ctxFor(db, "playerC"), {
      contractId: o.contractId,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "not_a_party");

    const after = db
      .prepare(`SELECT status, last_offer_by FROM career_contracts WHERE id = ?`)
      .get(o.contractId);
    assert.deepEqual(after, before);
  });

  it("offer naming two other players is refused and no row is created", async () => {
    const beforeCount = db
      .prepare(`SELECT COUNT(*) AS n FROM career_contracts`)
      .get().n;

    const r = await macros.get("offer")(ctxFor(db, "playerC"), {
      employerKind: "player",
      employerId: "playerA",
      workerKind: "player",
      workerId: "playerB",
      trackId: "chef",
      tier: 1,
      baseWage: 10,
      signingBonus: 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_a_party");

    const afterCount = db
      .prepare(`SELECT COUNT(*) AS n FROM career_contracts`)
      .get().n;
    assert.equal(afterCount, beforeCount);
  });

  it("anonymous caller is refused for offer, counter, reject, and accept", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB");
    assert.equal(o.ok, true, o.reason);

    for (const [name, input] of [
      [
        "offer",
        {
          employerKind: "player",
          employerId: "playerA",
          workerKind: "player",
          workerId: "playerB",
          trackId: "chef",
          tier: 1,
          baseWage: 1,
        },
      ],
      ["counter", { contractId: o.contractId, terms: { baseWage: 2 } }],
      ["reject", { contractId: o.contractId }],
      ["accept", { contractId: o.contractId }],
    ]) {
      const r = await macros.get(name)(ctxFor(db, "anon"), input);
      assert.equal(r.ok, false, `${name} should reject anon`);
      assert.equal(r.reason, "auth_required", `${name} reason should be auth_required`);
    }
  });

  it("party can still accept the counterparty's offer", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB", {
      signingBonus: 50,
    });
    assert.equal(o.ok, true, o.reason);

    const accepted = await macros.get("accept")(ctxFor(db, "playerB"), {
      contractId: o.contractId,
    });
    assert.equal(accepted.ok, true, accepted.reason || "");
    assert.equal(accepted.status, "active");
    assert.equal(accepted.bonusPaid, 50);
  });

  it("owner can still reject their own offer", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB");
    assert.equal(o.ok, true, o.reason);

    const rejected = await macros.get("reject")(ctxFor(db, "playerA"), {
      contractId: o.contractId,
    });
    assert.equal(rejected.ok, true, rejected.reason || "");
    assert.equal(rejected.status, "rejected");

    const row = db
      .prepare(`SELECT status FROM career_contracts WHERE id = ?`)
      .get(o.contractId);
    assert.equal(row.status, "rejected");
  });

  it("counter cannot accept their own standing offer", async () => {
    const o = await offerBetween(db, macros, "playerA", "playerB");
    assert.equal(o.ok, true, o.reason);

    const countered = await macros.get("counter")(ctxFor(db, "playerB"), {
      contractId: o.contractId,
      terms: { baseWage: 20 },
    });
    assert.equal(countered.ok, true, countered.reason || "");

    // playerB made the standing counter → cannot accept it
    const ownAccept = await macros.get("accept")(ctxFor(db, "playerB"), {
      contractId: o.contractId,
    });
    assert.equal(ownAccept.ok, false);
    assert.equal(ownAccept.reason, "cannot_accept_own_offer");

    // playerA (the other party) can accept
    const accept = await macros.get("accept")(ctxFor(db, "playerA"), {
      contractId: o.contractId,
    });
    assert.equal(accept.ok, true, accept.reason || "");
  });
});
