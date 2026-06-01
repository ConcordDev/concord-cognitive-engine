// Real creator progression (replaces ProgressionPanel's demo data): citations,
// royalties, per-domain tiers, badges, unlocks, milestones — all from live tables.
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { getCreatorProgression, REPUTATION_DOMAINS } from "../lib/creator-progression.js";

function db0() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (id TEXT PRIMARY KEY, creator_id TEXT, type TEXT, title TEXT, tags_json TEXT DEFAULT '[]');
    CREATE TABLE dtu_citations (dtu_id TEXT PRIMARY KEY, citation_count INTEGER DEFAULT 0, last_cited TEXT);
    CREATE TABLE economy_ledger (
      id TEXT PRIMARY KEY, type TEXT, to_user_id TEXT, net REAL, status TEXT DEFAULT 'complete'
    );
  `);
  return db;
}
function addDtu(db, id, creator, title, tags, citations) {
  db.prepare("INSERT INTO dtus (id, creator_id, type, title, tags_json) VALUES (?,?,?,?,?)")
    .run(id, creator, "skill", title, JSON.stringify(tags));
  db.prepare("INSERT INTO dtu_citations (dtu_id, citation_count, last_cited) VALUES (?,?,?)")
    .run(id, citations, "2026-05-01T00:00:00Z");
}

test("empty creator → all zeros, no throw, well-formed shape", () => {
  const db = db0();
  const r = getCreatorProgression(db, "nobody");
  assert.equal(r.profile.totalCitations, 0);
  assert.equal(r.profile.totalRoyalties, 0);
  assert.equal(r.profile.domains.length, REPUTATION_DOMAINS.length);
  assert.ok(r.profile.domains.every((d) => d.tier === "Novice"));
});

test("citations sum + domain attribution via tags", () => {
  const db = db0();
  addDtu(db, "d1", "alice", "Steel Beam Spec", ["structural", "beam"], 12);
  addDtu(db, "d2", "alice", "Solar Reactor", ["energy"], 8);
  addDtu(db, "d3", "alice", "Untagged thing", [], 5); // → exploration default
  addDtu(db, "d4", "bob", "Not alice's", ["energy"], 99); // other creator excluded
  const r = getCreatorProgression(db, "alice");
  assert.equal(r.profile.totalCitations, 25);
  const byDomain = Object.fromEntries(r.profile.domains.map((d) => [d.domain, d.citations]));
  assert.equal(byDomain.structural, 12);
  assert.equal(byDomain.energy, 8);
  assert.equal(byDomain.exploration, 5, "untagged falls to exploration");
});

test("tier derives from citation count (structural 12 → Apprentice)", () => {
  const db = db0();
  addDtu(db, "d1", "carol", "Beam", ["structural"], 12); // ≥10 → Apprentice
  const r = getCreatorProgression(db, "carol");
  const structural = r.profile.domains.find((d) => d.domain === "structural");
  assert.equal(structural.tier, "Apprentice");
  assert.equal(structural.citationsToNextTier, 50 - 12);
});

test("royalties sum only completed ROYALTY_PAYOUTs received", () => {
  const db = db0();
  addDtu(db, "d1", "dave", "X", ["energy"], 3);
  db.prepare("INSERT INTO economy_ledger (id, type, to_user_id, net, status) VALUES ('l1','ROYALTY_PAYOUT','dave',10.5,'complete')").run();
  db.prepare("INSERT INTO economy_ledger (id, type, to_user_id, net, status) VALUES ('l2','ROYALTY_PAYOUT','dave',4.25,'complete')").run();
  db.prepare("INSERT INTO economy_ledger (id, type, to_user_id, net, status) VALUES ('l3','ROYALTY_PAYOUT','dave',99,'pending')").run(); // excluded
  db.prepare("INSERT INTO economy_ledger (id, type, to_user_id, net, status) VALUES ('l4','TRANSFER','dave',50,'complete')").run(); // excluded
  const r = getCreatorProgression(db, "dave");
  assert.equal(r.profile.totalRoyalties, 14.75);
});

test("badges + milestones + unlocks derive from real data", () => {
  const db = db0();
  addDtu(db, "d1", "erin", "Popular Spec", ["materials"], 120);
  db.prepare("INSERT INTO economy_ledger (id, type, to_user_id, net, status) VALUES ('l1','ROYALTY_PAYOUT','erin',5,'complete')").run();
  const r = getCreatorProgression(db, "erin");
  const ids = r.profile.badges.map((b) => b.id);
  assert.ok(ids.includes("first-citation"));
  assert.ok(ids.includes("cited-100"));
  assert.ok(ids.includes("first-royalty"));
  // one unlock per domain, materials' next-tier flagged unlocked at 120 ≥ 50
  const matUnlock = r.unlocks.find((u) => u.domain === "materials");
  assert.ok(matUnlock);
  assert.equal(matUnlock.unlocked, true);
  // milestone references the real DTU
  assert.ok(r.milestones.some((m) => m.title.includes("Popular Spec")));
});

test("missing tables degrade to zeros (minimal build)", () => {
  const db = new Database(":memory:"); // no tables at all
  const r = getCreatorProgression(db, "x");
  assert.equal(r.profile.totalCitations, 0);
  assert.equal(r.profile.domains.length, REPUTATION_DOMAINS.length);
});
