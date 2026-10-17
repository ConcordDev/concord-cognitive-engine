/**
 * INC-118 — Authorization regression tests for kingdoms takeover + depose.
 *
 * Covers the macro surface exposed by server/domains/kingdoms.js:
 *   - depose_ruler: only the player ruler or an admin may depose.
 *   - takeover_election: requires a real, passed governance proposal by the actor;
 *     client voterTurnoutOk is ignored.
 *   - takeover_inheritance: requires a positive heir link to the actor.
 *   - takeover_conquest: rejects the test-only bypass proof from clients.
 *
 * Run:
 *   cd server && NODE_ENV=test nice node --test --test-concurrency=2 \
 *     --import=./tests/preload/no-egress.mjs tests/INC-118-authz.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerKingdomsMacros from "../domains/kingdoms.js";
import { getKingdom } from "../lib/kingdoms.js";
import { up as up133 } from "../migrations/133_npc_legacy.js";
import { up as up138 } from "../migrations/138_governance_proposals.js";
import { up as up158 } from "../migrations/158_kingdoms.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
registerKingdomsMacros(register);

function setupDb() {
  const db = new Database(":memory:");
  up133(db);
  up138(db);
  up158(db);
  return db;
}

async function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`kingdoms.${name}`);
  if (!fn) throw new Error(`kingdoms.${name} not registered`);
  return fn(ctx, input);
}

function makeCtx(db, userId, role = null) {
  const actor = { userId };
  if (role) actor.role = role;
  return { db, actor };
}

function seedRealm(db, {
  id = "rlm_test",
  name = "Test Realm",
  worldId = "w",
  factionId = "fac_test",
  rulerKind = "npc",
  rulerId = "npc_ruler",
} = {}) {
  db.prepare(`
    INSERT INTO realms
      (id, name, world_id, faction_id, ruler_kind, ruler_id, legitimacy, treasury, tax_rate)
    VALUES (?, ?, ?, ?, ?, ?, 60, 1000, 0.10)
  `).run(id, name, worldId, factionId, rulerKind, rulerId);
  return id;
}

function seedProposal(db, {
  proposalId = "gp_test",
  proposerId,
  kingdomId = null,
  status = "passed",
  quorum = 1,
  yesVotes = 1,
  voters = null,
  constantPath = "marketplace.platform_fee_rate",
  proposedValue = "0.03",
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO governance_proposals
      (id, title, summary, proposer_id, constant_path, current_value, proposed_value,
       status, quorum, threshold_pct, opened_at, closed_at, closes_at)
    VALUES (?, 'Title', 'Summary', ?, ?, '0.05', ?,
            ?, ?, 0.5, ?, ?, ?)
  `).run(proposalId, proposerId, constantPath, proposedValue, status, quorum, now - 1000, status === "passed" ? now - 1 : null, now + 86400);

  for (let i = 0; i < yesVotes; i++) {
    const voterId = voters?.[i] || proposerId;
    db.prepare(`
      INSERT OR REPLACE INTO governance_votes (proposal_id, voter_id, vote, cast_at)
      VALUES (?, ?, 'yes', ?)
    `).run(proposalId, voterId, now - 500);
  }
  return proposalId;
}

describe("INC-118 — depose_ruler authorization", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("refuses anonymous callers", async () => {
    const id = seedRealm(db, { rulerKind: "player", rulerId: "ownerA" });
    const before = getKingdom(db, id);
    const r = await call("depose_ruler", makeCtx(db, "anon"), { kingdomId: id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "auth_required");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("refuses an outsider and leaves the realm unchanged", async () => {
    const id = seedRealm(db, { rulerKind: "player", rulerId: "ownerA" });
    const before = getKingdom(db, id);
    const r = await call("depose_ruler", makeCtx(db, "outsiderB"), { kingdomId: id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "forbidden");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("allows the player ruler to abdicate", async () => {
    const id = seedRealm(db, { rulerKind: "player", rulerId: "ownerA" });
    db.prepare(`
      INSERT INTO realm_decrees (id, kingdom_id, kind, body_json, issued_by_kind, effect_state, popularity_delta)
      VALUES ('dx', ?, 'festival', '{}', 'system', 'active', 12)
    `).run(id);
    const r = await call("depose_ruler", makeCtx(db, "ownerA"), { kingdomId: id, reason: "abdication" });
    assert.equal(r.ok, true);
    const after = getKingdom(db, id);
    assert.equal(after.ruler_kind, "interregnum");
    assert.equal(after.ruler_id, null);
    const dx = db.prepare(`SELECT effect_state FROM realm_decrees WHERE id = 'dx'`).get();
    assert.equal(dx.effect_state, "expired");
  });

  it("allows an admin to depose", async () => {
    const id = seedRealm(db, { rulerKind: "player", rulerId: "ownerA" });
    const r = await call("depose_ruler", makeCtx(db, "adminC", "admin"), { kingdomId: id });
    assert.equal(r.ok, true);
    assert.equal(getKingdom(db, id).ruler_kind, "interregnum");
  });
});

describe("INC-118 — takeover_election authorization", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("refuses a call with no proposalId", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const before = getKingdom(db, id);
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      voterTurnoutOk: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("refuses an open (not passed) proposal even when client sends voterTurnoutOk=true", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const pid = seedProposal(db, { proposerId: "candX", status: "open" });
    const before = getKingdom(db, id);
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      proposalId: pid,
      voterTurnoutOk: true,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "proposal_not_passed");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("refuses a passed proposal proposed by someone else", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const pid = seedProposal(db, { proposerId: "otherUser" });
    const before = getKingdom(db, id);
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      proposalId: pid,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_proposal");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("allows a passed, quorate proposal by the actor and ignores client voterTurnoutOk=false", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const pid = seedProposal(db, {
      proposerId: "candX",
      kingdomId: id,
      quorum: 1,
      yesVotes: 1,
      constantPath: `kingdoms.${id}.ruler`,
      proposedValue: "candX",
    });
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      proposalId: pid,
      voterTurnoutOk: false,
    });
    assert.equal(r.ok, true);
    const after = getKingdom(db, id);
    assert.equal(after.ruler_kind, "player");
    assert.equal(after.ruler_id, "candX");
  });

  it("refuses a passed proposal with an unrelated constant_path", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const pid = seedProposal(db, { proposerId: "candX", quorum: 1, yesVotes: 1 });
    const before = getKingdom(db, id);
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      proposalId: pid,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "election_requires_kingdom_ruler_proposal");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("refuses a passed proposal scoped to a different kingdom", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const other = seedRealm(db, { id: "rlm_other", name: "Other Realm", rulerKind: "npc", rulerId: "npc_other" });
    const pid = seedProposal(db, {
      proposerId: "candX",
      kingdomId: other,
      quorum: 1,
      yesVotes: 1,
      constantPath: `kingdoms.${other}.ruler`,
      proposedValue: "candX",
    });
    const before = getKingdom(db, id);
    const r = await call("takeover_election", makeCtx(db, "candX"), {
      kingdomId: id,
      proposalId: pid,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "election_requires_kingdom_ruler_proposal");
    assert.deepEqual(getKingdom(db, id), before);
  });
});

describe("INC-118 — takeover_inheritance authorization", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("refuses when the actor has no heir link and leaves the realm unchanged", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const before = getKingdom(db, id);
    const r = await call("takeover_inheritance", makeCtx(db, "u1"), {
      kingdomId: id,
      heirOfNpcId: "npc_ruler",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_heir");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("refuses when no heirOfNpcId is supplied", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const before = getKingdom(db, id);
    const r = await call("takeover_inheritance", makeCtx(db, "u1"), { kingdomId: id });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_heir");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("allows a positive heir link to the current NPC ruler", async () => {
    const rulerId = "npc_ruler";
    const id = seedRealm(db, { rulerKind: "npc", rulerId: rulerId });
    db.prepare(`
      INSERT INTO npc_inheritance_links (id, deceased_npc_id, heir_npc_id, inherited_kind)
      VALUES ('il1', ?, 'u1', 'wealth')
    `).run(rulerId);
    const r = await call("takeover_inheritance", makeCtx(db, "u1"), {
      kingdomId: id,
      heirOfNpcId: rulerId,
    });
    assert.equal(r.ok, true);
    const after = getKingdom(db, id);
    assert.equal(after.ruler_kind, "player");
    assert.equal(after.ruler_id, "u1");
  });
});

describe("INC-118 — takeover_conquest authorization", () => {
  let db;
  beforeEach(() => { db = setupDb(); });

  it("rejects the test-only bypass proof from a client", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const before = getKingdom(db, id);
    const r = await call("takeover_conquest", makeCtx(db, "warlord"), {
      kingdomId: id,
      proof: { bypass: true },
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_proof");
    assert.deepEqual(getKingdom(db, id), before);
  });

  it("accepts a validated conquest proof", async () => {
    const id = seedRealm(db, { rulerKind: "npc", rulerId: "npc_ruler" });
    const now = Math.floor(Date.now() / 1000);
    const r = await call("takeover_conquest", makeCtx(db, "warlord"), {
      kingdomId: id,
      proof: {
        rulerKilledAt: now - 8 * 3600,
        capitalHeldSince: now - 7 * 3600,
      },
    });
    assert.equal(r.ok, true);
    const after = getKingdom(db, id);
    assert.equal(after.ruler_kind, "player");
    assert.equal(after.ruler_id, "warlord");
  });
});
