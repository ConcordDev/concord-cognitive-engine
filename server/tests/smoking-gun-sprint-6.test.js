// server/tests/smoking-gun-sprint-6.test.js
//
// Sprint 6 — I2 feed_sources durable + I4 consent durable (through
// existing user_consent table). I8 (atlas) was false alarm — atlas
// page makes no /api/atlas/* direct calls; existing routes suffice.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["032_consent_layer", "233_feed_sources"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("I2 — feed_sources durable", () => {
  it("INSERT + SELECT round-trip preserves shape", () => {
    db.prepare(`
      INSERT INTO feed_sources (id, url, title, kind, active, item_count, created_by, created_at)
      VALUES ('feed:test', 'https://example.com/rss', 'Example RSS', 'rss', 1, 42, 'u_test', unixepoch())
    `).run();
    const r = db.prepare(`SELECT * FROM feed_sources WHERE id = 'feed:test'`).get();
    assert.equal(r.title, "Example RSS");
    assert.equal(r.item_count, 42);
    assert.equal(r.kind, "rss");
    assert.equal(r.active, 1);
  });

  it("CHECK constraint rejects invalid kind", () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO feed_sources (id, url, kind, created_by) VALUES ('feed:bad', 'x', 'TWEETS', 'u')`).run();
    }, /CHECK/);
  });

  it("idx_feed_active partial index covers active=1", () => {
    db.prepare(`INSERT INTO feed_sources (id, url, kind, active, created_by) VALUES ('feed:inactive', 'x', 'rss', 0, 'u')`).run();
    const rows = db.prepare(`SELECT id FROM feed_sources WHERE active = 1`).all();
    assert.ok(rows.find((r) => r.id === "feed:test"));
    assert.ok(!rows.find((r) => r.id === "feed:inactive"));
  });
});

describe("I4 — consent durable via existing user_consent (migration 032)", () => {
  it("grantConsent → user_consent row", async () => {
    const { grantConsent, checkConsent } = await import("../lib/consent.js");
    grantConsent(db, "u_consent_a", "allow_citation");
    assert.equal(checkConsent(db, "u_consent_a", "allow_citation").consented, true);
  });

  it("revokeConsent flips back", async () => {
    const { grantConsent, revokeConsent, checkConsent } = await import("../lib/consent.js");
    grantConsent(db, "u_consent_b", "publish_to_marketplace");
    revokeConsent(db, "u_consent_b", "publish_to_marketplace");
    assert.equal(checkConsent(db, "u_consent_b", "publish_to_marketplace").consented, false);
  });

  it("invalid action enum is rejected by user_consent CHECK", () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO user_consent (id, user_id, action, granted) VALUES ('c1', 'u_bad', 'NOT_AN_ACTION', 1)`).run();
    }, /CHECK/);
  });
});
