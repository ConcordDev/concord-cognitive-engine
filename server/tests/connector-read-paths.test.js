/**
 * Tier-2 contract tests for Track C read paths — real Gmail inbox + Google
 * Calendar pull. The provider network is mocked via the opts.fetchImpl seam on
 * connectorFetch (no live Google call); a valid token is seeded so the egress
 * runs end-to-end through parsing.
 *
 * Run: node --test server/tests/connector-read-paths.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import {
  readGmailMessages,
  readGmailMessage,
  modifyGmailMessage,
  listGmailLabels,
  readGoogleCalendarEvents,
  parseGmailMessage,
} from "../lib/connector-client.js";
import registerGmailActions from "../domains/gmail.js";
import registerCalendarActions from "../domains/calendar.js";

function freshDb() {
  const db = new Database(":memory:");
  migrate331(db);
  return db;
}
function seedToken(db, connectorId = "google_gmail") {
  persistConnectorToken(db, "u1", connectorId, { access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "x" });
}
const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

// base64url-encode a UTF-8 string the way Gmail returns body data.
const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Build a registry from the domain module so we can call macros directly.
function buildMacros(register) {
  const map = new Map();
  register((domain, name, fn) => map.set(`${domain}.${name}`, fn));
  return map;
}

describe("Gmail read helpers (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db); });
  afterEach(() => { db.close(); });

  it("list hydrates each message id with parsed metadata", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/messages?")) return resp({ messages: [{ id: "m1" }, { id: "m2" }], resultSizeEstimate: 2 });
      if (url.includes("/messages/m1")) return resp({ id: "m1", threadId: "t1", labelIds: ["INBOX", "UNREAD"], snippet: "hi there", payload: { headers: [{ name: "From", value: "a@x.com" }, { name: "Subject", value: "Hello" }, { name: "Date", value: "Mon, 1 Jan 2026" }] } });
      if (url.includes("/messages/m2")) return resp({ id: "m2", threadId: "t2", labelIds: ["INBOX"], snippet: "read one", payload: { headers: [{ name: "From", value: "b@x.com" }, { name: "Subject", value: "Re: Hello" }] } });
      return resp({}, 404);
    };
    const r = await readGmailMessages(db, "u1", { maxResults: 10 }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.messages.length, 2);
    assert.equal(r.messages[0].subject, "Hello");
    assert.equal(r.messages[0].from, "a@x.com");
    assert.equal(r.messages[0].unread, true);
    assert.equal(r.messages[1].unread, false);
  });

  it("get(full) walks the MIME tree and decodes text + html bodies", async () => {
    const fetchImpl = async () => resp({
      id: "m1", threadId: "t1", labelIds: ["INBOX"], snippet: "snip",
      payload: {
        headers: [{ name: "Subject", value: "Body test" }, { name: "From", value: "a@x.com" }],
        mimeType: "multipart/alternative",
        parts: [
          { mimeType: "text/plain", body: { data: b64url("plain hello") } },
          { mimeType: "text/html", body: { data: b64url("<b>html hello</b>") } },
        ],
      },
    });
    const r = await readGmailMessage(db, "u1", "m1", { format: "full" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.message.text, "plain hello");
    assert.equal(r.message.html, "<b>html hello</b>");
    assert.equal(r.message.subject, "Body test");
  });

  it("modify (mark read) posts the right label delta and returns labelIds", async () => {
    let captured = null;
    const fetchImpl = async (url, init) => {
      captured = { url, body: JSON.parse(init.body) };
      return resp({ id: "m1", labelIds: ["INBOX"] });
    };
    const r = await modifyGmailMessage(db, "u1", "m1", { removeLabelIds: ["UNREAD"] }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.match(captured.url, /\/messages\/m1\/modify$/);
    assert.deepEqual(captured.body.removeLabelIds, ["UNREAD"]);
  });

  it("labels returns a flat {id,name,type} list", async () => {
    const fetchImpl = async () => resp({ labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "L1", name: "Work", type: "user" }] });
    const r = await listGmailLabels(db, "u1", { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.labels.length, 2);
    assert.equal(r.labels[1].name, "Work");
  });

  it("parseGmailMessage flags starred + handles a header-less message", () => {
    const m = parseGmailMessage({ id: "x", labelIds: ["STARRED"], payload: {} });
    assert.equal(m.starred, true);
    assert.equal(m.subject, "(no subject)");
  });
});

describe("Google Calendar pull helper (mocked egress)", () => {
  let db;
  beforeEach(() => { db = freshDb(); seedToken(db, "google_calendar"); });
  afterEach(() => { db.close(); });

  it("normalizes timed + all-day events and orders/expands via query", async () => {
    let url = null;
    const fetchImpl = async (u) => {
      url = u;
      return resp({ items: [
        { id: "e1", summary: "Standup", start: { dateTime: "2026-06-10T09:00:00Z" }, end: { dateTime: "2026-06-10T09:15:00Z" }, htmlLink: "h" },
        { id: "e2", summary: "Holiday", start: { date: "2026-06-11" }, end: { date: "2026-06-12" } },
      ] });
    };
    const r = await readGoogleCalendarEvents(db, "u1", { timeMin: "2026-06-10", maxResults: 100 }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.equal(r.events.length, 2);
    assert.equal(r.events[0].allDay, false);
    assert.equal(r.events[1].allDay, true);
    assert.match(url, /singleEvents=true/);
    assert.match(url, /orderBy=startTime/);
  });
});

describe("Gmail + Calendar macros — guards + honest failures (offline)", () => {
  let db, gmail, calendar;
  beforeEach(() => {
    db = freshDb();
    gmail = buildMacros(registerGmailActions);
    calendar = buildMacros(registerCalendarActions);
  });
  afterEach(() => { db.close(); });

  const ctx = (over = {}) => ({ db, actor: { userId: "u1" }, ...over });

  it("gmail.list with no stored token returns the honest no_token reason", async () => {
    const out = await callMacro(gmail, "gmail.list", ctx(), {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });

  it("gmail.get rejects a missing messageId before any network", async () => {
    const out = await callMacro(gmail, "gmail.get", ctx(), {});
    assert.equal(out.ok, false);
    assert.match(out.error, /messageId/);
  });

  it("gmail.list rejects an anonymous caller", async () => {
    const out = await callMacro(gmail, "gmail.list", ctx({ actor: { userId: "anon" } }), {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_user");
  });

  it("calendar.accounts-pull-events with no token returns no_token", async () => {
    const out = await callMacro(calendar, "calendar.accounts-pull-events", ctx(), {});
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no_token");
  });

  it("gmail.connect surfaces a real authorize URL with modify+send scopes", () => {
    const out = callMacro(gmail, "gmail.connect", ctx(), {});
    assert.equal(out.ok, true);
    assert.match(out.result.authorizeUrl, /\/api\/oauth\/google\/authorize\?/);
    assert.ok(out.result.scopes.some((s) => s.includes("gmail.modify")));
    assert.ok(out.result.scopes.some((s) => s.includes("gmail.send")));
  });
});

function callMacro(map, key, ctx, params) {
  const fn = map.get(key);
  assert.ok(fn, `${key} registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
