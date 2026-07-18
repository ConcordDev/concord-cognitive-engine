/**
 * P-D governance sign-off — the five owner-approved decisions, pinned as
 * enforced, can't-regress invariants (governance-as-code).
 *
 * docs/GOVERNANCE_DESIGN.md (P-D) was delivered as a design doc and OWNER-SIGNED-
 * OFF 2026-07-18. Its five recommendations are not aspirational prose — each is
 * already enforced in the codebase. This test locks that enforcement so a future
 * change can't silently undo a governance decision:
 *
 *   1. Consent — monetizing phenomenal/personal data (a dream DTU) REQUIRES an
 *      explicit, revocable `allow_phenomenal_monetization` consent; the gate
 *      fails closed.
 *   1b/4. Disclosure — a forked/reenacted "you" MUST disclose it is an agent
 *      (a locked is_agent=1 account + an agent_identities row).
 *   5. Shadow Parliament — auto-execution is OFF by default (advisory-forever),
 *      and its action allow-list is default-deny + money-free.
 *   3. Retroactive/cross-temporal royalties — the ledger-conservation predicate
 *      that would have to be broken to pay them is intact (design condition:
 *      "prove conservation or reject" → conservation preserved, feature unbuilt).
 *   2. Joint DTU ownership — deferred: the royalty cascade stays single-creator;
 *      no multi-owner/joint-ownership primitive is exported.
 *
 * Run: node --test server/tests/governance/pd-signoff-invariants.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../../migrate.js";
import { grantConsent } from "../../lib/consent.js";
import { promoteCandidateAsDTU } from "../../lib/dream-marketplace-bridge.js";
import { createForkObject } from "../../lib/lattice-fork.js";
import { isAutoexecEnabled, PARLIAMENT_ALLOWLIST } from "../../lib/shadow-parliament.js";
import { CREDIT_ROW_PREDICATE } from "../../economy/balances.js";
import * as royaltyCascade from "../../economy/royalty-cascade.js";

async function migratedDb() {
  const db = new Database(":memory:");
  await runMigrations(db); // runMigrations is async — must await or the tables aren't there yet
  return db;
}

describe("P-D sign-off invariant 1 — phenomenal-data monetization requires consent", () => {
  const dtuId = "dtu_pd_dream";
  function stateWithDream(db) {
    return { db, dtus: new Map([[dtuId, { dtuId, title: "A remembered dream", human: { summary: "grounded fragments" }, meta: { tags: [] }, content: "…" }]]) };
  }

  it("a MONETIZED promotion (userPrice > 0) with NO consent fails closed", async () => {
    const db = await migratedDb();
    const r = await promoteCandidateAsDTU(stateWithDream(db), { dtuId, kind: "dream" }, { userPrice: 5, userId: "u_noconsent" });
    assert.equal(r.promoted, false);
    assert.equal(r.reason, "consent_required");
    assert.equal(r.consentRequired?.action, "allow_phenomenal_monetization");
    db.close();
  });

  it("with consent granted, the consent gate no longer blocks it", async () => {
    const db = await migratedDb();
    grantConsent(db, "u_ok", "allow_phenomenal_monetization");
    // scoreFn:()=>0 forces an honest score_below_floor return AFTER the consent
    // gate, so we assert on the gate alone without invoking the LLM repair path.
    const r = await promoteCandidateAsDTU(stateWithDream(db), { dtuId, kind: "dream" }, { userPrice: 5, userId: "u_ok", scoreFn: () => 0 });
    assert.notEqual(r.reason, "consent_required", "consent was granted — must pass the gate");
    db.close();
  });

  it("a FREE listing (no userPrice) never triggers the monetization gate", async () => {
    const db = await migratedDb();
    const r = await promoteCandidateAsDTU(stateWithDream(db), { dtuId, kind: "dream" }, { scoreFn: () => 0 });
    assert.notEqual(r.reason, "consent_required");
    db.close();
  });
});

describe("P-D sign-off invariant 1b/4 — a fork discloses it is an agent", () => {
  it("createForkObject establishes a disclosed is_agent=1 account + agent_identities row", async () => {
    const db = await migratedDb();
    // createForkObject builds its own disclosed agent account from the real
    // users schema + writes the agent_identities row; no source-user seed needed
    // (the bounded dtuIds are stored as JSON, not validated against a table).
    const fork = createForkObject(db, { ownerUserId: "u_src", dtuIds: ["d1", "d2"] });
    assert.equal(fork.ok, true);
    assert.ok(fork.agentUserId, "a disclosed agent account id is returned");
    // Disclosure signal 1: the fork's account id itself declares it is an agent
    // (namespaced `agent_…`), so it can never masquerade as a human login.
    assert.match(fork.agentUserId, /^agent_/, "the fork account id discloses it is an agent");
    // Disclosure signal 2: the canonical agent self-model row (mig 325) exists —
    // the disclosure record proper. (PK is agent_id; the row is keyed to the
    // fork's agent account via user_id.)
    const identity = db.prepare("SELECT COUNT(*) n FROM agent_identities WHERE user_id = ?").get(fork.agentUserId);
    assert.equal(identity.n, 1, "the fork has a disclosed agent self-model (agent_identities) record");
    db.close();
  });
});

describe("P-D sign-off invariant 5 — Shadow Parliament is advisory by default", () => {
  it("auto-execution is OFF unless an operator explicitly opts in", () => {
    const prior = process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC;
    delete process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC;
    assert.equal(isAutoexecEnabled(), false, "default MUST be advisory (autoexec off)");
    // and only the two explicit truthy opt-ins enable it
    process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC = "false";
    assert.equal(isAutoexecEnabled(), false);
    process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC = "true";
    assert.equal(isAutoexecEnabled(), true);
    if (prior === undefined) delete process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC;
    else process.env.CONCORD_SHADOW_PARLIAMENT_AUTOEXEC = prior;
  });

  it("the auto-execute allow-list is default-deny and money-free", () => {
    assert.ok(Array.isArray(PARLIAMENT_ALLOWLIST) && PARLIAMENT_ALLOWLIST.length > 0);
    // Nothing money/permission/economy-touching may sit in the allow-list.
    const forbidden = /wallet|coin|mint|burn|purchase|withdraw|royalt|stake|transfer|payout|marketplace|price|escrow|grant|auth|permission|role/i;
    for (const entry of PARLIAMENT_ALLOWLIST) {
      const key = `${entry.domain}.${entry.name}`;
      assert.ok(!forbidden.test(key), `allow-list entry ${key} is money/permission-touching — must not auto-execute`);
      assert.ok(typeof entry.reversible === "string" && entry.reversible.length > 20, `${key} must document why it is reversible`);
    }
  });
});

describe("P-D sign-off invariant 3 — retroactive royalties: conservation preserved", () => {
  it("the ledger-conservation predicate that blocks double-crediting is intact", () => {
    // The design condition for retroactive/cross-temporal royalties was "prove
    // conservation or reject." Conservation rests on excluding the redundant
    // two-row debit halves; retroactive royalties are (correctly) unbuilt, and
    // this guard is what any future attempt would have to preserve.
    assert.match(CREDIT_ROW_PREDICATE, /TRANSFER/);
    assert.match(CREDIT_ROW_PREDICATE, /MARKETPLACE_PURCHASE/);
    assert.match(CREDIT_ROW_PREDICATE, /from_user_id IS NOT NULL/);
  });
});

describe("P-D sign-off invariant 2 — joint DTU ownership stays deferred (single-creator cascade)", () => {
  it("no multi-owner / joint-ownership primitive is exported by the royalty cascade", () => {
    const exported = Object.keys(royaltyCascade);
    const jointish = exported.filter((k) => /joint|coOwner|co_owner|coCreator|splitOwnership|owners\b|multiOwner/i.test(k));
    assert.deepEqual(jointish, [], `royalty cascade must stay single-creator; found joint-ownership export(s): ${jointish.join(", ")}`);
    // The cascade's citation entry is keyed by a single creatorId (design intent).
    assert.equal(typeof royaltyCascade.registerCitation, "function");
  });
});
