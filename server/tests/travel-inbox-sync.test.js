// server/tests/travel-inbox-sync.test.js
//
// Wave-4 gap-closure (travel-capability-map.md #2 — "Inbox auto-sync
// (Gmail/Outlook, no manual paste)"): Gmail-only auto-sync for the travel
// lens. Covers two things:
//
//   1. A REGRESSION proof that extracting the booking-import email parser
//      into the standalone `parseBookingEmail()` (now shared with the new
//      `travel.inbox-sync` macro) left `travel.booking-import`'s behavior
//      byte-identical — same inputs, same outputs, as before the refactor.
//   2. Contract tests for the new `travel.inbox-sync` macro: a real
//      matched-email-to-booking import, a no-match (low-confidence) skip,
//      the honest not-connected failure (no fabricated "synced" result),
//      and dedupe-on-resync (no duplicate booking from re-scanning the same
//      Gmail message).
//
// Gmail egress is intercepted via the same test-only `fetchImpl` seam
// `connectorFetch` already exposes (see lib/connector-client.js /
// connector-read-paths.test.js) — no live Google call, no live server boot.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import registerTravelActions, { parseBookingEmail } from "../domains/travel.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`travel.${name}`);
  assert.ok(fn, `travel.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerTravelActions(register); });

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, userId = "u1") {
  persistConnectorToken(db, userId, "google_gmail", { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "x" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

const ctxA = (db) => ({ actor: { userId: "u1" }, userId: "u1", db });

function newTrip(db) {
  return call("trip-create", ctxA(db), {
    name: "Lisbon 2026", destination: "Lisbon", startDate: "2026-09-01", endDate: "2026-09-05",
  }).result.trip;
}

// Builds a fetchImpl the way connector-read-paths.test.js does: routes by URL
// shape (list vs a specific message id).
function fetchImplFor(messages) {
  return async (url) => {
    if (url.includes("/messages?")) {
      return resp({ messages: messages.map((m) => ({ id: m.id })), resultSizeEstimate: messages.length });
    }
    const hit = messages.find((m) => url.includes(`/messages/${m.id}`));
    if (hit) {
      return resp({
        id: hit.id, threadId: `t-${hit.id}`, labelIds: ["INBOX"], snippet: hit.snippet || "",
        payload: {
          headers: [{ name: "Subject", value: hit.subject }, { name: "From", value: hit.from || "a@x.com" }],
          mimeType: "text/plain",
          body: { data: Buffer.from(hit.body || "", "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") },
        },
      });
    }
    return resp({}, 404);
  };
}

describe("travel.booking-import — regression: byte-identical after parseBookingEmail extraction", () => {
  beforeEach(() => {
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
  });

  const FLIGHT_EMAIL = "Your flight is confirmed. Confirmation: ABC123. "
    + "Departure gate B12, seat 14C. Total: $452.10. Date 2026-09-01.";

  it("parseBookingEmail(text) returns the exact fields the old inline parser computed", () => {
    const parsed = parseBookingEmail(FLIGHT_EMAIL);
    assert.deepEqual(parsed, {
      type: "flight",
      confirmationCode: "ABC123",
      provider: null,
      cost: 452.1,
      date: "2026-09-01",
      confidence: 4, // type!=='activity', code, date, cost>0 — all four signals present
    });
  });

  it("booking-import produces the exact same booking + itineraryItem + parsed shape as before the refactor", () => {
    const db = freshDb();
    const tripId = newTrip(db).id;
    const r = call("booking-import", ctxA(db), { tripId, emailText: FLIGHT_EMAIL });
    assert.equal(r.ok, true);
    assert.equal(r.result.booking.type, "flight");
    assert.equal(r.result.booking.confirmationCode, "ABC123");
    assert.equal(r.result.booking.provider, null);
    assert.equal(r.result.booking.cost, 452.1);
    assert.equal(r.result.booking.date, "2026-09-01");
    assert.equal(r.result.booking.note, "Imported from forwarded confirmation email");
    assert.equal(r.result.booking.importedFromEmail, true);
    // The refactor must NOT leak inbox-sync-only fields onto the manual-paste path.
    assert.equal("sourceMessageId" in r.result.booking, false);
    assert.equal("sourceSubject" in r.result.booking, false);
    assert.deepEqual(r.result.parsed, {
      type: "flight", confirmationCode: "ABC123", provider: null, cost: 452.1, date: "2026-09-01", confidence: 4,
    });
    assert.equal(r.result.unparsedHint, null);
    assert.equal(r.result.itineraryItem.title, "Flight");
    assert.equal(r.result.itineraryItem.category, "transport");
    assert.equal(r.result.itineraryItem.day, "2026-09-01");
    assert.equal(r.result.itineraryItem.note, "Confirmation: ABC123");
    assert.equal(r.result.itineraryItem.fromBooking, r.result.booking.id);
    db.close();
  });

  it("hotel confirmation still resolves type=hotel with a partial-confidence unparsedHint", () => {
    const db = freshDb();
    const tripId = newTrip(db).id;
    const r = call("booking-import", ctxA(db), {
      tripId, emailText: "Your hotel room is reserved for 3 nights stay. Check-in May 5, 2026.",
    });
    assert.equal(r.result.booking.type, "hotel");
    assert.equal(r.result.booking.date, "2026-05-05");
    assert.equal(r.result.booking.confirmationCode, null);
    assert.ok(r.result.unparsedHint); // no confirmation code parsed
    db.close();
  });

  it("still rejects an unknown trip / empty email exactly as before", () => {
    const db = freshDb();
    assert.equal(call("booking-import", ctxA(db), { tripId: "nope", emailText: "x" }).ok, false);
    const tripId = newTrip(db).id;
    assert.equal(call("booking-import", ctxA(db), { tripId, emailText: "" }).ok, false);
    db.close();
  });
});

describe("travel.inbox-sync — Gmail auto-sync (mocked egress)", () => {
  let db;
  beforeEach(() => {
    globalThis._concordSTATE = {};
    globalThis._concordSaveStateDebounced = () => {};
    db = freshDb();
  });
  afterEach(() => { db.close(); });

  it("returns the honest no_token reason when Gmail isn't connected — never a fabricated sync", async () => {
    const tripId = newTrip(db).id;
    const r = await call("inbox-sync", ctxA(db), { tripId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_token");
    assert.equal(r.error, "no_token");
  });

  it("rejects an unknown trip before touching Gmail", async () => {
    const r = await call("inbox-sync", ctxA(db), { tripId: "nope" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "trip not found");
  });

  it("rejects an anonymous caller", async () => {
    seedToken(db);
    const tripId = newTrip(db).id;
    const r = await call("inbox-sync", { actor: { userId: "anon" }, db }, { tripId });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_user");
  });

  it("imports a real matched booking email and mirrors an itinerary item", async () => {
    seedToken(db);
    const tripId = newTrip(db).id;
    const __fetchImpl = fetchImplFor([
      {
        id: "m1", subject: "Your flight confirmation ABC123",
        body: "Your flight is confirmed. Confirmation: ABC123. Departure gate B12, seat 14C. Total: $452.10. Date 2026-09-01.",
      },
    ]);
    const r = await call("inbox-sync", ctxA(db), { tripId, __fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.result.scanned, 1);
    assert.equal(r.result.imported, 1);
    assert.equal(r.result.skippedCount, 0);
    const [booking] = r.result.bookings;
    assert.equal(booking.type, "flight");
    assert.equal(booking.confirmationCode, "ABC123");
    assert.equal(booking.cost, 452.1);
    assert.equal(booking.sourceMessageId, "m1");
    assert.equal(booking.sourceSubject, "Your flight confirmation ABC123");
    assert.equal(booking.note, "Imported from Gmail inbox sync");
    assert.equal(r.result.itineraryItems[0].fromBooking, booking.id);

    // The booking is genuinely persisted into travel state (not just returned).
    const list = call("booking-list", ctxA(db), { tripId });
    assert.equal(list.result.bookings.length, 1);
  });

  it("skips a message that doesn't parse into a confident booking (no match)", async () => {
    seedToken(db);
    const tripId = newTrip(db).id;
    const __fetchImpl = fetchImplFor([
      { id: "m2", subject: "Weekly newsletter", body: "Check out our new blog post about travel tips!" },
    ]);
    const r = await call("inbox-sync", ctxA(db), { tripId, __fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.result.scanned, 1);
    assert.equal(r.result.imported, 0);
    assert.equal(r.result.skippedCount, 1);
    assert.equal(r.result.skipped[0].reason, "low_confidence");
    const list = call("booking-list", ctxA(db), { tripId });
    assert.equal(list.result.bookings.length, 0);
  });

  it("dedupes on resync — re-scanning the same message never creates a duplicate booking", async () => {
    seedToken(db);
    const tripId = newTrip(db).id;
    const __fetchImpl = fetchImplFor([
      {
        id: "m3", subject: "Hotel reservation confirmed",
        body: "Your hotel room is reserved for 3 nights stay. Confirmation: HTL999. Check-in 2026-09-02. Total: $610.00.",
      },
    ]);
    const first = await call("inbox-sync", ctxA(db), { tripId, __fetchImpl });
    assert.equal(first.result.imported, 1);

    const second = await call("inbox-sync", ctxA(db), { tripId, __fetchImpl });
    assert.equal(second.ok, true);
    assert.equal(second.result.scanned, 1);
    assert.equal(second.result.imported, 0);
    assert.equal(second.result.skippedCount, 1);
    assert.equal(second.result.skipped[0].reason, "already_imported");

    const list = call("booking-list", ctxA(db), { tripId });
    assert.equal(list.result.bookings.length, 1); // still exactly one, not two
  });

  it("imports multiple matched messages and skips low-confidence ones in the same pass", async () => {
    seedToken(db);
    const tripId = newTrip(db).id;
    const __fetchImpl = fetchImplFor([
      {
        id: "m4", subject: "Car rental confirmation",
        body: "Your rental car booking is confirmed with Enterprise. Confirmation: CAR456. Pick-up location: LIS airport. Total: $210.00. 2026-09-03.",
      },
      { id: "m5", subject: "Newsletter", body: "Nothing booking-shaped here at all." },
    ]);
    const r = await call("inbox-sync", ctxA(db), { tripId, __fetchImpl });
    assert.equal(r.result.scanned, 2);
    assert.equal(r.result.imported, 1);
    assert.equal(r.result.skippedCount, 1);
    assert.equal(r.result.bookings[0].type, "car");
    assert.equal(r.result.bookings[0].confirmationCode, "CAR456");
  });
});
