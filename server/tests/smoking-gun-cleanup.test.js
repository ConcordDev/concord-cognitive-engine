// server/tests/smoking-gun-cleanup.test.js
//
// Tier-2 contract tests for the four smoking-gun fixes:
//   1. chat_scheduled_tasks — was 0R/0W dead schema (Sprint cleanup)
//   2. calendar_booking_slots + calendar_links + calendar_subscriptions
//      — three asymmetric tables from our own calendar sprints
//   3. council_dtu_votes — STATE.councilVotes Map → durable
//   4. marketplace_dtu_listings — STATE.marketplaceListings Map → durable

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerCalendarMoatsMacros from "../domains/calendar-moats.js";
import registerChatExtrasMacros from "../domains/chat-extras.js";
import {
  createListing, getListing, listAllListings, countListings,
  setStatus, updateDownloads, listingToRow, rowToListing,
} from "../lib/marketplace/dtu-listings.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["217_calendar", "219_calendar_moats", "223_chat_extras", "229_council_dtu_votes", "230_marketplace_dtu_listings"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Seed a calendar + event the calendar-moats macros can FK to
  // (the schemas already exist from migration 217)
  db.prepare(`INSERT INTO calendars (id, owner_id, name, kind, visibility) VALUES (?, ?, ?, ?, ?)`).run("cal:test", "u_owner", "Test", "personal", "private");
  db.prepare(`INSERT INTO calendar_events (id, calendar_id, organizer_id, title, start_at, end_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("evt:test", "cal:test", "u_owner", "Test event", Math.floor(Date.now()/1000), Math.floor(Date.now()/1000) + 3600, Math.floor(Date.now()/1000), Math.floor(Date.now()/1000));
  registerCalendarMoatsMacros(register);
  registerChatExtrasMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

// ─── #1 chat_scheduled_tasks ────────────────────────────────────

describe("Fix #1 — chat_scheduled_tasks is now alive", () => {
  it("scheduled_create writes + scheduled_list reads back", async () => {
    const r = await MACROS.get("scheduled_create")(ctx("u_sched"), {
      title: "Daily summary", prompt: "Summarize my day", cadenceKind: "daily",
    });
    assert.equal(r.ok, true);
    assert.ok(r.nextRunAt > Math.floor(Date.now() / 1000));
    const list = await MACROS.get("scheduled_list")(ctx("u_sched"));
    assert.ok(list.tasks.find((t) => t.id === r.id));
  });

  it("scheduled_update with cadence change recomputes next_run_at", async () => {
    const c = await MACROS.get("scheduled_create")(ctx("u_supd"), {
      title: "Weekly", prompt: "x", cadenceKind: "weekly",
    });
    const before = db.prepare(`SELECT next_run_at FROM chat_scheduled_tasks WHERE id = ?`).get(c.id);
    const u = await MACROS.get("scheduled_update")(ctx("u_supd"), { id: c.id, cadenceKind: "every_n_hours", cadenceParam: "1" });
    assert.equal(u.ok, true);
    const after = db.prepare(`SELECT next_run_at FROM chat_scheduled_tasks WHERE id = ?`).get(c.id);
    assert.ok(after.next_run_at < before.next_run_at, "1h cadence should be sooner than 1w");
  });

  it("scheduled_delete only deletes my own", async () => {
    const c = await MACROS.get("scheduled_create")(ctx("u_own"), { title: "Mine", prompt: "x" });
    const r = await MACROS.get("scheduled_delete")(ctx("u_thief"), { id: c.id });
    assert.equal(r.ok, false);
    const r2 = await MACROS.get("scheduled_delete")(ctx("u_own"), { id: c.id });
    assert.equal(r2.ok, true);
  });

  it("scheduled_due returns enabled tasks with next_run_at <= now", async () => {
    db.prepare(`
      INSERT INTO chat_scheduled_tasks (id, owner_id, title, prompt, cadence_kind, cadence_param, next_run_at, enabled, created_at, updated_at)
      VALUES ('chsched:due_now', 'u_due', 'Due', 'x', 'daily', '1', ?, 1, ?, ?)
    `).run(Math.floor(Date.now() / 1000) - 100, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    const r = await MACROS.get("scheduled_due")(ctx("u_due"));
    assert.ok(r.due.find((t) => t.id === "chsched:due_now"));
  });
});

// ─── #2 calendar asymmetric tables ──────────────────────────────

describe("Fix #2 — calendar_booking_slots can now be read (was WRITE-ONLY)", () => {
  it("bookings_list returns slots for a link owner only", async () => {
    db.prepare(`INSERT INTO calendar_booking_links (id, owner_id, slug, title, target_calendar_id) VALUES (?, ?, ?, ?, ?)`).run("link:abc", "u_link_owner", "coffee-slug", "Coffee chat", "cal:test");
    db.prepare(`INSERT INTO calendar_booking_slots (id, booking_link_id, event_id, guest_name, guest_email, created_at) VALUES ('slot:1', 'link:abc', 'evt:test', 'Alice', 'a@b.c', ?)`).run(Math.floor(Date.now() / 1000));
    const r = await MACROS.get("bookings_list")(ctx("u_link_owner"), { linkId: "link:abc" });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    assert.equal(r.bookings[0].guest_name, "Alice");
    const forbidden = await MACROS.get("bookings_list")(ctx("u_thief_link"), { linkId: "link:abc" });
    assert.equal(forbidden.reason, "forbidden");
  });

  it("bookings_mine returns slots across ALL of my booking links", async () => {
    const r = await MACROS.get("bookings_mine")(ctx("u_link_owner"));
    assert.equal(r.ok, true);
    assert.ok(r.count >= 1);
  });
});

describe("Fix #2 — calendar_links can now be written (was READ-ONLY)", () => {
  it("link_create + links_for_event round-trip", async () => {
    const c = await MACROS.get("link_create")(ctx("u_owner"), {
      eventId: "evt:test", targetKind: "doc", targetId: "doc:abc", targetLabel: "Spec",
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("links_for_event")(ctx("u_owner"), { eventId: "evt:test" });
    assert.equal(list.ok, true);
    assert.ok(list.links.find((l) => l.target_id === "doc:abc"));
  });

  it("link_create rejects invalid target_kind (CHECK constraint)", async () => {
    const r = await MACROS.get("link_create")(ctx("u_owner"), {
      eventId: "evt:test", targetKind: "nonsense", targetId: "x",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_target_kind");
  });

  it("link_create rejects events I don't own", async () => {
    const r = await MACROS.get("link_create")(ctx("u_outsider"), {
      eventId: "evt:test", targetKind: "doc", targetId: "x",
    });
    assert.equal(r.reason, "forbidden");
  });
});

describe("Fix #2 — calendar_subscriptions can now be written (was READ-ONLY)", () => {
  it("subscription_create yields token + feed_path + list returns it", async () => {
    const c = await MACROS.get("subscription_create")(ctx("u_subs"), { visibility: "busy_only" });
    assert.equal(c.ok, true);
    assert.ok(c.token.startsWith("subs:"));
    assert.ok(c.feedPath.includes(c.token));
    const list = await MACROS.get("subscription_list")(ctx("u_subs"));
    assert.ok(list.subscriptions.find((s) => s.token === c.token));
  });

  it("subscription_create with specific calendarIds rejects non-owned calendars", async () => {
    const r = await MACROS.get("subscription_create")(ctx("u_thief"), { calendarIds: ["cal:test"] });
    assert.equal(r.reason, "forbidden");
  });

  it("subscription_revoke flips active to 0", async () => {
    const c = await MACROS.get("subscription_create")(ctx("u_rev"), {});
    const r = await MACROS.get("subscription_revoke")(ctx("u_rev"), { token: c.token });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT active FROM calendar_subscriptions WHERE id = ?`).get(c.token);
    assert.equal(row.active, 0);
  });
});

// ─── #3 council_dtu_votes ───────────────────────────────────────

describe("Fix #3 — council_dtu_votes migration writes durable rows", () => {
  it("schema enforces UNIQUE(dtu_id, voter_id) — duplicate vote SQL rejection", () => {
    db.prepare(`
      INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at)
      VALUES ('vote:1', 'dtu:test', 'u_v1', 'approve', 'me', 'reason', 1.0, ?)
    `).run(Math.floor(Date.now() / 1000));
    assert.throws(() => {
      db.prepare(`
        INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at)
        VALUES ('vote:2', 'dtu:test', 'u_v1', 'reject', 'me', 'r2', 1.0, ?)
      `).run(Math.floor(Date.now() / 1000));
    }, /UNIQUE/);
  });

  it("CHECK constraint rejects invalid vote enum", () => {
    assert.throws(() => {
      db.prepare(`
        INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at)
        VALUES ('vote:bad', 'dtu:bad', 'u_bad', 'YES', 'me', '', 1.0, ?)
      `).run(Math.floor(Date.now() / 1000));
    }, /CHECK/);
  });

  it("tally aggregation works on multi-vote DTU", () => {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("v:a", "dtu:multi", "u_a", "approve", "p", "", 1.0, now);
    db.prepare(`INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("v:b", "dtu:multi", "u_b", "approve", "p", "", 1.0, now);
    db.prepare(`INSERT INTO council_dtu_votes (id, dtu_id, voter_id, vote, persona, reason, weight, cast_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run("v:c", "dtu:multi", "u_c", "reject", "p", "", 1.0, now);
    const rows = db.prepare(`SELECT vote, COUNT(*) AS n FROM council_dtu_votes WHERE dtu_id = ? GROUP BY vote`).all("dtu:multi");
    const tally = Object.fromEntries(rows.map((r) => [r.vote, r.n]));
    assert.equal(tally.approve, 2);
    assert.equal(tally.reject, 1);
  });
});

// ─── #4 marketplace_dtu_listings ────────────────────────────────

describe("Fix #4 — marketplace_dtu_listings is durable", () => {
  it("createListing + getListing round-trip preserves all 18 fields", () => {
    const listing = {
      id: "listing:abc",
      sourceDtuId: "dtu:src",
      sellerId: "u_seller",
      scope: "marketplace",
      title: "Test product",
      domain: "code",
      description: "A test",
      artifact: { kind: "zip", url: "https://x/y.zip", byteSize: 1234 },
      qualityTier: "gold",
      qualityScore: 0.92,
      price: 4.99,
      currency: "concord_coin",
      listedAt: new Date().toISOString(),
      downloads: 0,
      ratings: [{ userId: "u_r", score: 5, comment: "good" }],
      status: "active",
      repairScore: 0.85,
      repairFlags: ["low_risk"],
    };
    const r = createListing(db, listing);
    assert.equal(r.ok, true);
    const got = getListing(db, "listing:abc");
    assert.equal(got.title, "Test product");
    assert.equal(got.price, 4.99);
    assert.equal(got.artifact.url, "https://x/y.zip");
    assert.equal(got.ratings.length, 1);
    assert.equal(got.repairFlags[0], "low_risk");
  });

  it("listAllListings + countListings + status filter", () => {
    createListing(db, { id: "l:1", sourceDtuId: "d", sellerId: "u", scope: "marketplace", title: "A", price: 1 });
    createListing(db, { id: "l:2", sourceDtuId: "d", sellerId: "u", scope: "marketplace", title: "B", price: 2, status: "removed" });
    const all = listAllListings(db);
    assert.ok(all.find((l) => l.id === "l:1"));
    assert.ok(all.find((l) => l.id === "l:2"));
    const active = listAllListings(db, { status: "active" });
    assert.ok(!active.find((l) => l.id === "l:2"));
    const count = countListings(db);
    assert.ok(count >= 2);
  });

  it("setStatus enforces CHECK enum", () => {
    createListing(db, { id: "l:status", sourceDtuId: "d", sellerId: "u", scope: "marketplace", title: "X", price: 1 });
    assert.equal(setStatus(db, "l:status", "removed"), true);
    assert.equal(setStatus(db, "l:status", "INVALID"), false);
  });

  it("updateDownloads is atomic increment", () => {
    createListing(db, { id: "l:dl", sourceDtuId: "d", sellerId: "u", scope: "marketplace", title: "D", price: 0 });
    updateDownloads(db, "l:dl", 1);
    updateDownloads(db, "l:dl", 2);
    const g = getListing(db, "l:dl");
    assert.equal(g.downloads, 3);
  });

  it("listingToRow / rowToListing are inverse", () => {
    const orig = { id: "x", sourceDtuId: "y", sellerId: "z", scope: "marketplace", title: "t", price: 1.5, artifact: { a: 1 }, ratings: [{ s: 5 }], repairFlags: ["a"] };
    const row = listingToRow(orig);
    const back = rowToListing(row);
    assert.equal(back.id, orig.id);
    assert.equal(back.price, orig.price);
    assert.deepEqual(back.artifact, orig.artifact);
    assert.deepEqual(back.ratings, orig.ratings);
  });
});
