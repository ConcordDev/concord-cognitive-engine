/**
 * Contract tests for the full Gmail client surface: RFC-822 building (header
 * injection, reply threading, attachments, non-ASCII subjects), conversation
 * list/read, drafts and attachment download. Provider network is mocked via
 * the opts.fetchImpl seam; a token is seeded so the egress path runs.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import { up as migrate331 } from "../migrations/331_connector_oauth_tokens.js";
import { persistConnectorToken } from "../lib/connector-tokens.js";
import {
  buildGmailRfc822,
  writeGmailMessage,
  readGmailThreads,
  readGmailThread,
  saveGmailDraft,
  getGmailAttachment,
  modifyGmailThread,
} from "../lib/connector-client.js";
import registerGmailActions from "../domains/gmail.js";

const resp = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
const decodeBase64Parts = (raw) => raw.split(/\r\n\r\n/).map((chunk) => {
  try { return Buffer.from(chunk.replace(/\r\n--.*$/s, "").replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return ""; }
}).join("\n");

describe("buildGmailRfc822", () => {
  it("strips CR/LF from header values so a subject cannot inject headers", () => {
    const raw = buildGmailRfc822({ to: "a@x.com\r\nBcc: evil@x.com", subject: "Hi\r\nBcc: evil@x.com", body: "x" });
    const headerBlock = raw.split("\r\n\r\n")[0];
    assert.equal(/^Bcc:/m.test(headerBlock), false);
    assert.match(headerBlock, /^To: a@x\.com Bcc: evil@x\.com$/m);
  });

  it("writes reply threading headers and an encoded non-ASCII subject", () => {
    const raw = buildGmailRfc822({ to: "a@x.com", subject: "Re: Café", inReplyTo: "<m1@x>", references: "<m0@x> <m1@x>", body: "thanks" });
    assert.match(raw, /^In-Reply-To: <m1@x>$/m);
    assert.match(raw, /^References: <m0@x> <m1@x>$/m);
    assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
    assert.ok(decodeBase64Parts(raw).includes("thanks"));
  });

  it("builds multipart/mixed with each attachment as a base64 part", () => {
    const data = Buffer.from("hello file").toString("base64");
    const raw = buildGmailRfc822({ to: "a@x.com", subject: "s", body: "see attached", attachments: [{ filename: "notes.txt", mimeType: "text/plain", data }] });
    assert.match(raw, /Content-Type: multipart\/mixed; boundary="mix_/);
    assert.match(raw, /Content-Disposition: attachment; filename="notes.txt"/);
    assert.ok(raw.includes(data));
  });
});

describe("Gmail client egress (mocked)", () => {
  let db;
  beforeEach(() => {
    db = new Database(":memory:");
    migrate331(db);
    persistConnectorToken(db, "u1", "google_gmail", { access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "x" });
  });
  afterEach(() => db.close());

  it("send keeps a reply in its thread", async () => {
    let sent;
    const fetchImpl = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return resp({ id: "m9", threadId: "t1" }); };
    const r = await writeGmailMessage(db, "u1", { to: "a@x.com", subject: "Re: plan", body: "ok", threadId: "t1", inReplyTo: "<m1@x>" }, { fetchImpl });
    assert.equal(r.ok, true);
    assert.match(sent.url, /\/messages\/send$/);
    assert.equal(sent.body.threadId, "t1");
    assert.match(fromB64url(sent.body.raw), /^In-Reply-To: <m1@x>$/m);
  });

  it("lists conversations as summary rows (participants, count, unread)", async () => {
    const fetchImpl = async (url) => {
      if (url.includes("/threads?")) return resp({ threads: [{ id: "t1" }], resultSizeEstimate: 1 });
      if (url.includes("/threads/t1")) return resp({ id: "t1", messages: [
        { id: "m1", threadId: "t1", labelIds: ["INBOX"], snippet: "first", payload: { headers: [{ name: "From", value: "Ana <ana@x.com>" }, { name: "Subject", value: "Plan" }] } },
        { id: "m2", threadId: "t1", labelIds: ["INBOX", "UNREAD"], snippet: "latest reply", payload: { headers: [{ name: "From", value: "Ben <ben@x.com>" }, { name: "Subject", value: "Re: Plan" }] } },
      ] });
      return resp({}, 404);
    };
    const r = await readGmailThreads(db, "u1", { labelIds: ["INBOX"] }, { fetchImpl });
    assert.equal(r.ok, true);
    const [t] = r.threads;
    assert.equal(t.subject, "Plan");
    assert.equal(t.messageCount, 2);
    assert.equal(t.unread, true);
    assert.equal(t.snippet, "latest reply");
    assert.deepEqual(t.participants, ["Ana", "Ben"]);
  });

  it("reads a conversation with attachment metadata and Message-ID", async () => {
    const fetchImpl = async () => resp({ id: "t1", messages: [{
      id: "m1", threadId: "t1", labelIds: ["INBOX"],
      payload: { mimeType: "multipart/mixed", headers: [{ name: "Message-ID", value: "<m1@x>" }, { name: "Subject", value: "Doc" }], parts: [
        { mimeType: "text/plain", body: { data: b64url("body text") } },
        { mimeType: "application/pdf", filename: "spec.pdf", body: { attachmentId: "att1", size: 1200 } },
      ] },
    }] });
    const r = await readGmailThread(db, "u1", "t1", { fetchImpl });
    const m = r.thread.messages[0];
    assert.equal(m.text, "body text");
    assert.equal(m.messageIdHeader, "<m1@x>");
    assert.deepEqual(m.attachments, [{ attachmentId: "att1", filename: "spec.pdf", mimeType: "application/pdf", size: 1200 }]);
  });

  it("creates a draft with POST and replaces it with PUT", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => { calls.push({ url, method: init.method }); return resp({ id: "d1", message: { id: "m5", threadId: "t5" } }); };
    await saveGmailDraft(db, "u1", { to: "a@x.com", subject: "draft" }, { fetchImpl });
    await saveGmailDraft(db, "u1", { draftId: "d1", to: "a@x.com", subject: "draft v2" }, { fetchImpl });
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /\/drafts$/);
    assert.equal(calls[1].method, "PUT");
    assert.match(calls[1].url, /\/drafts\/d1$/);
  });

  it("converts attachment data from base64url to standard base64", async () => {
    const fetchImpl = async () => resp({ data: "aGk-Pz8_", size: 6 });
    const r = await getGmailAttachment(db, "u1", "m1", "att1", { fetchImpl });
    assert.equal(r.attachment.data, "aGk+Pz8/");
  });

  it("modifies a whole conversation", async () => {
    let body;
    const fetchImpl = async (url, init) => { body = { url, data: JSON.parse(init.body) }; return resp({ id: "t1" }); };
    await modifyGmailThread(db, "u1", "t1", { removeLabelIds: ["INBOX"] }, { fetchImpl });
    assert.match(body.url, /\/threads\/t1\/modify$/);
    assert.deepEqual(body.data, { addLabelIds: [], removeLabelIds: ["INBOX"] });
  });
});

describe("gmail macros — guards", () => {
  const map = new Map();
  registerGmailActions((d, n, fn) => map.set(n, fn));

  it("registers the full client surface", () => {
    for (const n of ["threads", "thread", "thread-modify", "thread-trash", "thread-untrash", "untrash", "profile", "attachment", "label-create", "drafts", "draft-save", "draft-send", "draft-delete"]) {
      assert.ok(map.has(n), n);
    }
  });

  it("refuses anonymous callers and bad input honestly", async () => {
    assert.equal((await map.get("threads")({}, null, {})).error, "no_user");
    const ctx = { actor: { userId: "u1" }, db: {} };
    assert.equal((await map.get("thread")(ctx, null, {})).error, "threadId required");
    assert.equal((await map.get("thread-modify")(ctx, null, { threadId: "t1", action: "explode" })).error, "unknown action: explode");
  });
});
