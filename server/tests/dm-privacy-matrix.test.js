/**
 * dm-privacy-matrix.test.js — SB-11 (Mega Plan v2, Track B / SB-G3).
 *
 * The DM privacy pin matrix over every surface in audit/sec/DM-SURFACES.md.
 * Cast: A (u_a) and B (u_b) are participants; C (u_c) is a non-participant;
 * anon is unauthenticated. For each surface: B reads OK; C's read, list,
 * mark-read, recall, search and export are denied with no body or metadata;
 * anon is refused.
 *
 * EXPECTED SHAPE ON PRISTINE (named in advance, per SB-10's verdict):
 *  - The HTTP-shaped spoof cases PASS on pristine: ctx.userId is not
 *    client-reachable (SB-10, CB-0629), so identity fields in action input
 *    are ignored. These are pins of a true negative, never filed as leaks.
 *  - Exactly two cases FAIL on pristine — they are the downstream targets:
 *      * "SB-12 TARGET" — the hand-built ctx { userId } fallback in
 *        domains/social.js actor() / domains/message.js msgActor(). No
 *        production path builds such a ctx (SB-10), so this is a latent
 *        trap, not a live spoof; SB-12 removes the fallback and this case
 *        turns green.
 *      * "SB-13 TARGET" — the shared "anon" key in the message domain's
 *        per-user stores: write-classified actions are already refused for
 *        anon by the registrar guard, but index-message/index-backfill
 *        persist into the search corpus without a write-classified name and
 *        the own-store reads stay open — one anon caller indexes, another
 *        searches. SB-13 refuses the shared key at those handlers.
 *    The matrix passes entire only when SB-12/13 land. SB-14's ground (the
 *    monolith's own /api/social/dm/* routes under AUTH_MODE=public) is not
 *    mountable from a test file — those handlers are inline in server.js —
 *    and is pinned by SB-14 itself; the router set's public-mode behaviour
 *    IS pinned here (R2) and passes on pristine.
 *
 * Harness: in-memory STATE + the real layer, the real domain registrations,
 * and (where express/better-sqlite3 are installed) the real social-core
 * router mounted on the social-core-loop harness shape. Router legs skip
 * where those deps are absent; CI runs them.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
  sendMessage, getMessages, getConversations, markMessagesRead, recallMessage,
  upsertProfile, setSocialEmitter,
} from "../emergent/social-layer.js";
import {
  listMessageRequests, acceptMessageRequest, declineMessageRequest, hideMessageForUser,
  setSocialPreferences,
} from "../lib/social-loop.js";
import { hasLensExportProvider, collectLensExport } from "../lib/lens-export.js";
import registerSocialActions from "../domains/social.js";
import registerMessageActions from "../domains/message.js";

const A = "u_a";
const B = "u_b";
const C = "u_c";
const BODY = "dm-matrix-secret-body-7f3a";
const TERM = "dmmatrixterm9q";

function freshSTATE() {
  const STATE = { dtus: new Map() };
  globalThis._concordSTATE = STATE;
  globalThis._concordSaveStateDebounced = () => {};
  return STATE;
}

function seedPair(STATE) {
  upsertProfile(STATE, A, { displayName: "A" });
  upsertProfile(STATE, B, { displayName: "B" });
  upsertProfile(STATE, C, { displayName: "C" });
  const sent = sendMessage(STATE, { fromUserId: A, toUserId: B, content: BODY });
  assert.equal(sent.ok, true, "seed send A->B");
  return sent.message;
}

function captureActions(registerFn) {
  const actions = new Map();
  registerFn((domain, name, fn) => actions.set(`${domain}.${name}`, fn));
  return actions;
}

function noBodyNoMeta(result, label) {
  const s = JSON.stringify(result ?? {});
  assert.ok(!s.includes(BODY), `${label}: result must not contain the DM body`);
  assert.ok(!s.includes(TERM), `${label}: result must not contain the DM term`);
}

// ── Layer surfaces (social-layer + social-loop) ─────────────────────────────

describe("SB-11 layer: participant reads, non-participant refused", () => {
  it("L1 B (participant) reads the conversation and lists it", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    const read = getMessages(STATE, msg.conversationId, { userId: B });
    assert.equal(read.ok, true);
    assert.ok(read.messages.some((m) => m.content === BODY));
    const list = getConversations(STATE, B);
    assert.ok(list.conversations.some((c) => c.conversationId === msg.conversationId));
  });

  it("L2 C read is refused 404-shaped, with no body or metadata", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    const read = getMessages(STATE, msg.conversationId, { userId: C });
    assert.equal(read.ok, false);
    assert.equal(read.status, 404);
    assert.deepEqual(Object.keys(read).sort(), ["error", "ok", "status"]);
    noBodyNoMeta(read, "L2");
  });

  it("L3 C's conversation list does not contain the A-B conversation", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    const list = getConversations(STATE, C);
    assert.ok(!list.conversations.some((c) => c.conversationId === msg.conversationId));
    noBodyNoMeta(list, "L3");
  });

  it("L4 C mark-read is refused and changes nothing", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    const r = markMessagesRead(STATE, { userId: C, conversationId: msg.conversationId });
    assert.equal(r.ok, false);
    const list = getConversations(STATE, B);
    const conv = list.conversations.find((c) => c.conversationId === msg.conversationId);
    assert.equal(conv.unreadCount, 1, "B's unread count is untouched by C's attempt");
  });

  it("L5 C recall is refused; B (non-sender) recall is refused; body intact", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    assert.equal(recallMessage(STATE, { messageId: msg.id, userId: C }).ok, false);
    const byB = recallMessage(STATE, { messageId: msg.id, userId: B });
    assert.equal(byB.ok, false);
    assert.match(byB.error, /only the sender/);
    const read = getMessages(STATE, msg.conversationId, { userId: B });
    assert.ok(read.messages.some((m) => m.content === BODY), "body survives refused recalls");
  });

  it("L6 message requests are self-scoped: C sees none and cannot accept A's", () => {
    const STATE = freshSTATE();
    upsertProfile(STATE, A, { displayName: "A" });
    upsertProfile(STATE, B, { displayName: "B" });
    upsertProfile(STATE, C, { displayName: "C" });
    setSocialPreferences(STATE, B, { dmPolicy: "followers" });
    const sent = sendMessage(STATE, { fromUserId: A, toUserId: B, content: BODY });
    assert.equal(sent.ok, true);
    assert.equal(listMessageRequests(STATE, C).requests.length, 0);
    assert.equal(listMessageRequests(STATE, B).requests.length, 1);
    assert.equal(acceptMessageRequest(STATE, { userId: C, fromUserId: A }).ok, false);
    assert.equal(declineMessageRequest(STATE, { userId: C, fromUserId: A }).ok, false);
    assert.equal(acceptMessageRequest(STATE, { userId: B, fromUserId: A }).ok, true);
  });

  it("L7 C cannot hide a message from a conversation it is not in", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    assert.equal(hideMessageForUser(STATE, { userId: C, messageId: msg.id }).ok, false);
    assert.equal(hideMessageForUser(STATE, { userId: B, messageId: msg.id }).ok, true);
  });

  it("L8 anon is refused at the layer: no list, no read, no mark-read", () => {
    const STATE = freshSTATE();
    const msg = seedPair(STATE);
    assert.deepEqual(getConversations(STATE, "anon").conversations, []);
    assert.equal(getMessages(STATE, msg.conversationId, { userId: "anon" }).ok, false);
    assert.equal(getMessages(STATE, msg.conversationId, {}).ok, false);
    assert.equal(markMessagesRead(STATE, { userId: "anon", conversationId: msg.conversationId }).ok, false);
  });
});

// ── Lens-action surfaces: social domain ─────────────────────────────────────

describe("SB-11 social lens actions", () => {
  function setup() {
    const STATE = freshSTATE();
    const actions = captureActions(registerSocialActions);
    const msg = seedPair(STATE);
    return { STATE, actions, msg };
  }
  const ctx = (userId) => ({ actor: { userId }, db: null });

  it("D1 inbox: B sees the thread, C does not", () => {
    const { actions, msg } = setup();
    const inboxB = actions.get("social.inbox")(ctx(B), null, {});
    assert.equal(inboxB.ok, true);
    assert.ok(inboxB.result.threads.some((t) => t.threadKey === msg.conversationId));
    const inboxC = actions.get("social.inbox")(ctx(C), null, {});
    assert.equal(inboxC.ok, true);
    assert.ok(!inboxC.result.threads.some((t) => t.threadKey === msg.conversationId));
    noBodyNoMeta(inboxC, "D1");
  });

  it("D2 conversation: B reads — and reading marks read (side-effect pin)", () => {
    const { STATE, actions, msg } = setup();
    const read = actions.get("social.conversation")(ctx(B), null, { threadKey: msg.conversationId });
    assert.equal(read.ok, true);
    assert.ok(read.result.messages.some((m) => m.body === BODY));
    const list = getConversations(STATE, B);
    const conv = list.conversations.find((c) => c.conversationId === msg.conversationId);
    assert.equal(conv.unreadCount, 0, "social.conversation marks the thread read for the reader");
  });

  it("D3 conversation: C is refused 'not a participant', no body", () => {
    const { actions, msg } = setup();
    const read = actions.get("social.conversation")(ctx(C), null, { threadKey: msg.conversationId });
    assert.equal(read.ok, false);
    assert.match(read.error, /not a participant/);
    noBodyNoMeta(read, "D3");
  });

  it("D4 SPOOF (HTTP-shaped, expected PASS on pristine): identity fields in the input are ignored", () => {
    const { actions, msg } = setup();
    // C presents A's id in the action INPUT; the ctx is built the way
    // makeCtx builds it (actor from the session only). SB-10: the input
    // cannot reach the actor.
    const read = actions.get("social.conversation")(ctx(C), null, {
      threadKey: msg.conversationId, userId: A, with: A, actor: { userId: A },
    });
    assert.equal(read.ok, false, "input-carried identity must not be honoured");
    noBodyNoMeta(read, "D4");
    const sent = actions.get("social.sendMessage")(ctx(C), null, { to: B, body: `${TERM} from C`, fromUserId: A });
    assert.equal(sent.ok, true);
    assert.equal(sent.result.message.from, C, "the sender is the session actor, never the input");
  });

  it("SB-12 TARGET: a hand-built ctx carrying userId without actor must not be honoured", () => {
    const { actions, msg } = setup();
    // No production path builds this ctx (SB-10 verdict) — but the
    // ctx?.userId fallback in social.js actor() honours it today. SB-12
    // removes the fallback; this case is red until then, by design.
    const read = actions.get("social.conversation")({ userId: A, db: null }, null, { threadKey: msg.conversationId });
    assert.equal(read.ok, false, "ctx.userId fallback must not grant A's identity");
    noBodyNoMeta(read, "SB-12 TARGET");
  });
});

// ── Lens-action surfaces: message domain (channels + per-user stores) ───────

describe("SB-11 message lens actions", () => {
  function setup() {
    const STATE = freshSTATE();
    const actions = captureActions(registerMessageActions);
    return { STATE, actions };
  }
  const ctx = (userId) => ({ actor: { userId }, db: null });

  it("M1 shared dm channel: B (member) reads, C is refused read and send", () => {
    const { actions } = setup();
    const created = actions.get("message.channels-create")(ctx(A), null, {
      kind: "dm", name: "a-b", participants: [B],
    });
    assert.equal(created.ok, true);
    const channelId = created.result.channel.id;
    const sent = actions.get("message.messages-send")(ctx(A), null, { channelId, body: BODY });
    assert.equal(sent.ok, true);
    const readB = actions.get("message.messages-list")(ctx(B), null, { channelId });
    assert.equal(readB.ok, true);
    assert.ok(readB.result.messages.some((m) => m.body === BODY));
    const readC = actions.get("message.messages-list")(ctx(C), null, { channelId });
    assert.equal(readC.ok, false);
    assert.match(readC.error, /not a participant/);
    noBodyNoMeta(readC, "M1 read");
    const sendC = actions.get("message.messages-send")(ctx(C), null, { channelId, body: "intrusion" });
    assert.equal(sendC.ok, false);
  });

  it("M2 search is actor-scoped: C cannot find A's indexed words", () => {
    const { actions } = setup();
    const idx = actions.get("message.index-message")(ctx(A), null, {
      messageId: "m-idx-1", body: `${TERM} hello`, sender: A, ts: new Date().toISOString(),
    });
    assert.equal(idx.ok, true);
    const hitsA = actions.get("message.search-messages")(ctx(A), null, { query: TERM });
    assert.ok(hitsA.result.hits.length >= 1, "A finds its own indexed message");
    const hitsC = actions.get("message.search-messages")(ctx(C), null, { query: TERM });
    assert.equal(hitsC.result.hits.length, 0);
    noBodyNoMeta(hitsC, "M2");
  });

  it("SB-13 TARGET: two distinct anon callers must not share the per-user stores", () => {
    const { actions } = setup();
    // The live path (premise correction, CB-0633): write-classified actions
    // are already refused for anon by the registrar guard — but index-message
    // persists into the per-user search corpus without a write-classified
    // name, and the own-store reads (search, saved-list) stay open, so one
    // anon caller could index and another could search it back out.
    const anon1 = { actor: { userId: "anon" }, db: null };
    const anon2 = { actor: { userId: "anon" }, db: null };
    const idx = actions.get("message.index-message")(anon1, null, {
      messageId: "m-anon-1", body: `${TERM} anon corpus`, sender: A, ts: new Date().toISOString(),
    });
    assert.equal(idx.ok, false, "indexing under the shared anon key must be refused");
    const hits = actions.get("message.search-messages")(anon2, null, { query: TERM });
    assert.equal(hits.ok, false, "searching under the shared anon key must be refused");
    const savedList = actions.get("message.saved-list")(anon2, null, {});
    assert.equal(savedList.ok, false, "the saved store refuses the shared anon key");
  });
});

// ── Export surface ──────────────────────────────────────────────────────────

describe("SB-11 export: DM content has no export surface", () => {
  it("E1 no provider is registered for social or message; a lens export carries no DM body", async () => {
    const STATE = freshSTATE();
    captureActions(registerSocialActions);
    captureActions(registerMessageActions);
    seedPair(STATE);
    assert.equal(hasLensExportProvider("social"), false);
    assert.equal(hasLensExportProvider("message"), false);
    const runMacro = async () => ({ ok: true, artifacts: [] });
    for (const domain of ["social", "message"]) {
      const out = await collectLensExport({ runMacro, domain, ctx: { actor: { userId: A } } });
      noBodyNoMeta(out, `E1 ${domain}`);
    }
  });
});

// ── Realtime: the socket fan-out ────────────────────────────────────────────

describe("SB-11 realtime: DM events reach only the recipient, without the body", () => {
  it("S1 the notification fan-out targets B only and carries no body", () => {
    const STATE = freshSTATE();
    const emits = [];
    setSocialEmitter((uid, evt, payload) => emits.push({ uid, evt, payload }));
    try {
      seedPair(STATE);
    } finally {
      setSocialEmitter(null);
    }
    assert.ok(emits.length >= 1, "the recipient notification fires");
    assert.ok(emits.every((e) => e.uid === B), "every emit is addressed to the recipient's user room only");
    assert.ok(!emits.some((e) => e.uid === C), "C receives nothing");
    for (const e of emits) noBodyNoMeta(e.payload, "S1");
  });
});

// ── Router surfaces (express + better-sqlite3; skip where unavailable) ─────

describe("SB-11 router: social-core /dm routes", () => {
  let harness = null;
  before(async () => {
    try {
      const express = (await import("express")).default;
      const Database = (await import("better-sqlite3")).default;
      const { up } = await import("../migrations/482_social_canonical_store.js");
      const createSocialCoreRoutes = (await import("../routes/social-core.js")).default;
      harness = { express, Database, up, createSocialCoreRoutes };
    } catch {
      harness = null;
    }
  });

  function mount(authMode) {
    const { express, Database, up, createSocialCoreRoutes } = harness;
    const db = new Database(":memory:");
    up(db);
    const STATE = { db, dtus: new Map() };
    globalThis._concordSTATE = STATE;
    globalThis._concordSaveStateDebounced = () => {};
    const requireAuth = () => (req, res, next) => {
      const u = req.headers["x-test-user"];
      if (u) req.user = { id: u };
      if (authMode === "secured" && !u) {
        return res.status(401).json({ ok: false, error: "auth required" });
      }
      return next();
    };
    const app = express();
    app.use(express.json());
    app.use("/api/social", createSocialCoreRoutes({ db, requireAuth }));
    return { app, STATE };
  }

  async function withServer(app, fn) {
    const server = app.listen(0);
    await new Promise((r) => server.once("listening", r));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      return await fn(base);
    } finally {
      server.close();
    }
  }
  const call = (base, method, path, user, body) => fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  it("R1 secured: B reads over HTTP, C gets the 404 shape, anon gets 401", async (t) => {
    if (!harness) return t.skip("express/better-sqlite3 unavailable in this env — CI runs this leg");
    const { app, STATE } = mount("secured");
    upsertProfile(STATE, A, { displayName: "A" });
    upsertProfile(STATE, B, { displayName: "B" });
    await withServer(app, async (base) => {
      const sent = await call(base, "POST", "/api/social/dm", A, { toUserId: B, content: BODY });
      assert.equal(sent.status, 200);
      const { message } = await sent.json();
      const convId = message.conversationId;
      const asB = await call(base, "GET", `/api/social/dm/${convId}`, B);
      assert.equal(asB.status, 200);
      assert.ok((await asB.text()).includes(BODY));
      const asC = await call(base, "GET", `/api/social/dm/${convId}`, C);
      assert.equal(asC.status, 404);
      assert.ok(!(await asC.text()).includes(BODY), "C's refusal carries no body");
      const asAnon = await call(base, "GET", `/api/social/dm/${convId}`, null);
      assert.equal(asAnon.status, 401);
      const read = await call(base, "POST", "/api/social/dm/recall", C, { messageId: message.id });
      assert.notEqual(read.status, 200, "C cannot recall A's message over HTTP");
    });
  });

  it("R2 public-mode pass-through: a session-less caller still gets the handler's 401 (router set)", async (t) => {
    if (!harness) return t.skip("express/better-sqlite3 unavailable in this env — CI runs this leg");
    const { app, STATE } = mount("public");
    const msg = seedPair(STATE);
    await withServer(app, async (base) => {
      const asAnon = await call(base, "GET", `/api/social/dm/${msg.conversationId}`, null);
      assert.equal(asAnon.status, 401, "the router handlers re-check req.user?.id in every mode");
    });
  });
});
