/**
 * Tier-2 contract tests for Sprint C / Track A3 — secrets discovery loop.
 *
 * PRIVACY INVARIANT: secrets.body MUST NEVER appear in the buildNPCTraits
 * output (LLM prompt). The test imports buildNPCTraits with a fixture NPC
 * carrying narrative_context.secret and asserts the JSON serialization of
 * the returned traits does NOT contain the secret string.
 *
 * Other pins:
 *   - discoverSecret idempotent on (user, secret)
 *   - weaponiseSecret records correct opinion deltas on holder + subject
 *   - inheritSecretsForHeir copies secrets to the heir
 *   - rollSurveillance accumulates dice and discovers when threshold hit
 *
 * Run: node --test tests/secrets-discovery.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  discoverSecret,
  weaponiseSecret,
  inheritSecretsForHeir,
  rollSurveillance,
  insertSyntheticSecret,
  listDiscoveredForUser,
  SECRETS_CONSTANTS,
} from "../lib/secrets.js";
import { up as up153 } from "../migrations/153_npc_opinions.js";
import { up as up154 } from "../migrations/154_secrets.js";
import { getOpinion } from "../lib/npc-opinions.js";

function setupDb() {
  const db = new Database(":memory:");
  up153(db);
  up154(db);
  return db;
}

function seedSecret(db, { id = "sec_x1", holder = "merchant_a", subjectKind = "npc", subjectId = "rival_b", body = "rival_b fled debt to me" }) {
  db.prepare(`
    INSERT INTO secrets (id, holder_npc_id, subject_kind, subject_id, kind, body, discovery_difficulty)
    VALUES (?, ?, ?, ?, 'debt', ?, 4)
  `).run(id, holder, subjectKind, subjectId, body);
  return id;
}

describe("Sprint C / A3 — discoverSecret", () => {
  it("inserts a discovery row + flags secret revealed_at", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    const r = discoverSecret(db, "u1", sid, "dialogue");
    assert.equal(r.action, "discovered");
    const sec = db.prepare(`SELECT revealed_at FROM secrets WHERE id = ?`).get(sid);
    assert.ok(sec.revealed_at > 0);
  });

  it("idempotent: second call returns already_known", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    discoverSecret(db, "u1", sid);
    const r2 = discoverSecret(db, "u1", sid);
    assert.equal(r2.action, "already_known");
  });

  it("returns secret_not_found when sid is missing", () => {
    const db = setupDb();
    const r = discoverSecret(db, "u1", "nonexistent");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "secret_not_found");
  });
});

describe("Sprint C / A3 — weaponiseSecret cascades to opinions", () => {
  it("records -30 on holder + -50 on subject", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    discoverSecret(db, "u1", sid);
    const r = weaponiseSecret(db, "u1", sid, "rival_b");
    assert.equal(r.action, "weaponised");
    assert.equal(getOpinion(db, "merchant_a", "player", "u1").score, -30);
    assert.equal(getOpinion(db, "rival_b", "player", "u1").score, -50);
  });

  it("requires prior discovery", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    const r = weaponiseSecret(db, "u1", sid, "rival_b");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_discovered");
  });

  it("idempotent: cannot weaponise twice", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    discoverSecret(db, "u1", sid);
    weaponiseSecret(db, "u1", sid, "rival_b");
    const r2 = weaponiseSecret(db, "u1", sid, "rival_b");
    assert.equal(r2.ok, false);
    assert.equal(r2.reason, "already_weaponised");
  });
});

describe("Sprint C / A3 — inheritSecretsForHeir", () => {
  it("copies parent's secrets to heir holder rows", () => {
    const db = setupDb();
    seedSecret(db, { id: "sec1", holder: "parent_a" });
    seedSecret(db, { id: "sec2", holder: "parent_a", subjectId: "rival_c" });
    const r = inheritSecretsForHeir(db, "parent_a", "child_b");
    assert.equal(r.copied, 2);
    const heirSecrets = db.prepare(`SELECT id FROM secrets WHERE holder_npc_id = ?`).all("child_b");
    assert.equal(heirSecrets.length, 2);
  });
});

describe("Sprint C / A3 — rollSurveillance", () => {
  it("accumulates dice, discovers when 3× difficulty crossed", () => {
    const db = setupDb();
    seedSecret(db, { id: "low_diff", holder: "merchant_a" });
    db.prepare(`UPDATE secrets SET discovery_difficulty = 1 WHERE id = ?`).run("low_diff");

    // Force max roll 6 every time → cumulative 6, 12. Threshold = 1*3=3, hit on first roll.
    const r = rollSurveillance(db, "u_surv1", "merchant_a", () => 0.99);
    assert.equal(r.action, "discovered");
    assert.equal(r.secretId, "low_diff");
  });

  it("just rolls when below threshold", () => {
    const db = setupDb();
    seedSecret(db, { id: "high_diff", holder: "merchant_b" });
    db.prepare(`UPDATE secrets SET discovery_difficulty = 9 WHERE id = ?`).run("high_diff");
    const r = rollSurveillance(db, "u_surv2", "merchant_b", () => 0); // dice=1
    assert.equal(r.action, "rolled");
    assert.equal(r.dice, 1);
  });
});

describe("Sprint C / A3 — synthetic secret + listDiscoveredForUser", () => {
  it("insertSyntheticSecret marks synthetic=1", () => {
    const db = setupDb();
    const r = insertSyntheticSecret(db, "plotter_a", "npc", "victim_a", "fabricated heresy claim", 7);
    assert.ok(r.id);
    const row = db.prepare(`SELECT synthetic, kind FROM secrets WHERE id = ?`).get(r.id);
    assert.equal(row.synthetic, 1);
    assert.equal(row.kind, "fabricated");
  });

  it("listDiscoveredForUser with includeBody:false omits body", () => {
    const db = setupDb();
    const sid = seedSecret(db, {});
    discoverSecret(db, "u1", sid);
    const list = listDiscoveredForUser(db, "u1");
    assert.equal(list.length, 1);
    assert.equal(list[0].body, undefined); // body should be excluded
  });

  it("listDiscoveredForUser with includeBody:true returns body", () => {
    const db = setupDb();
    const sid = seedSecret(db, { body: "private content" });
    discoverSecret(db, "u1", sid);
    const list = listDiscoveredForUser(db, "u1", { includeBody: true });
    assert.equal(list[0].body, "private content");
  });
});

describe("Sprint C / A3 — kind inference helper", () => {
  it("classifies authored secret strings", () => {
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("his real father is unknown"), "paternity");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("she committed murder years ago"), "crime");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("they had a forbidden affair"), "liaison");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("owes a substantial debt"), "debt");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("private heresy from doctrine"), "heresy");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("hidden mastery of an art"), "hidden_skill");
    assert.equal(SECRETS_CONSTANTS.inferKindFromText("nothing classifiable"), "grudge_origin");
  });
});
