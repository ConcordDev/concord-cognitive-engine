// server/tests/consent-phenomenal-influence.test.js
//
// Pins the `allow_phenomenal_influence` consent gate — gate (a) from
// docs/GOVERNANCE_DESIGN.md §2.3 (owner-approved 2026-07-03): consent
// before a player's real dream/pain/somatic records are used to shape how
// NPCs and autonomous agents BEHAVE TOWARD that player. `server/lib/consent.js`
// registers the CONSENT_ACTIONS entry; `server/migrations/369_phenomenal_influence_consent.js`
// widens the `user_consent` CHECK constraint to admit it (mirroring migration
// 355's pattern for the sibling `allow_phenomenal_monetization` key).
//
// This is a consent/auth-adjacent invariant, so it's pinned by a committed
// test rather than left as a one-off verification run.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { runMigrations } from "../migrate.js";
import {
  checkConsent,
  requireConsent,
  grantConsent,
  revokeConsent,
  CONSENT_ACTIONS,
} from "../lib/consent.js";

let db;
beforeEach(async () => {
  db = new Database(":memory:");
  db.pragma("journal_mode = MEMORY");
  db.pragma("foreign_keys = ON");
  await runMigrations(db);
});

test("CONSENT_ACTIONS defines allow_phenomenal_influence with an honest prompt", () => {
  const def = CONSENT_ACTIONS.allow_phenomenal_influence;
  assert.ok(def, "allow_phenomenal_influence must be registered");
  assert.equal(def.required, true);
  assert.equal(def.revocable, true);
  assert.match(def.prompt, /dream|somatic|behave/i);
});

test("default-deny: a user with no consent row is denied", () => {
  const check = checkConsent(db, "user-A", "allow_phenomenal_influence");
  assert.equal(check.consented, false);

  const gate = requireConsent(db, "user-A", "allow_phenomenal_influence");
  assert.equal(gate.allowed, false);
  assert.equal(gate.error, "consent_required");
  assert.equal(gate.consentRequired.action, "allow_phenomenal_influence");
});

test("granting consent flips requireConsent to allowed", () => {
  const before = requireConsent(db, "user-B", "allow_phenomenal_influence");
  assert.equal(before.allowed, false);

  const grant = grantConsent(db, "user-B", "allow_phenomenal_influence");
  assert.equal(grant.ok, true);
  assert.equal(grant.granted, true);

  const after = requireConsent(db, "user-B", "allow_phenomenal_influence");
  assert.equal(after.allowed, true);
});

test("revoking consent flips requireConsent back to denied", () => {
  grantConsent(db, "user-C", "allow_phenomenal_influence");
  assert.equal(requireConsent(db, "user-C", "allow_phenomenal_influence").allowed, true);

  const revoke = revokeConsent(db, "user-C", "allow_phenomenal_influence");
  assert.equal(revoke.ok, true);
  assert.equal(revoke.revoked, true);

  assert.equal(requireConsent(db, "user-C", "allow_phenomenal_influence").allowed, false);
});

test("the CHECK constraint actually admits the new key at the DB layer", () => {
  grantConsent(db, "user-B", "allow_phenomenal_influence");
  const row = db.prepare("SELECT * FROM user_consent WHERE user_id = ? AND action = ?")
    .get("user-B", "allow_phenomenal_influence");
  assert.ok(row, "row must persist — a rejected CHECK would leave no row");
  assert.equal(row.granted, 1);
});

test("existing allow_phenomenal_monetization + allow_citation rows survive the 369 table-recreate untouched", () => {
  grantConsent(db, "user-D", "allow_phenomenal_monetization");
  const before = db.prepare("SELECT * FROM user_consent WHERE user_id = ? AND action = ?")
    .get("user-D", "allow_phenomenal_monetization");
  assert.ok(before);
  assert.equal(before.granted, 1);

  // requireConsent for the pre-existing key still works post-migration.
  assert.equal(requireConsent(db, "user-D", "allow_phenomenal_monetization").allowed, true);
  // And the older allow_citation key too, for good measure.
  grantConsent(db, "user-D", "allow_citation");
  assert.equal(requireConsent(db, "user-D", "allow_citation").allowed, true);
});

test("migration is idempotent / re-runnable without breaking schema_version bookkeeping", async () => {
  // Running migrations again on the same (already-migrated) db must be a no-op,
  // not a re-throw of the CHECK-constraint recreate.
  await assert.doesNotReject(() => runMigrations(db));
});
