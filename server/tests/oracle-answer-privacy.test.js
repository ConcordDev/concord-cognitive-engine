/**
 * Oracle answers are a signed-in user's prompt and the generated answer.
 * record() used to persist them with no owner and no visibility, so the
 * private-read gate treated them as public and GET /api/dtus listed them
 * to anonymous callers.
 *
 * This creates the row through oracle.solve (the same function chat's
 * routeThroughOracle calls with the requester's user id) and asserts
 * anonymous and a second member cannot list or read it, while the owner can.
 *
 * On current main the anonymous dtu.get of that row returns ok:true.
 *
 * Run:
 *   NODE_ENV=test node --test --import=./tests/preload/no-egress.mjs --test-timeout=300000 tests/oracle-answer-privacy.test.js
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createOracleEngine } from "../lib/oracle-engine.js";
import { forgeFromMessage, acceleratedChatPromotion } from "../lib/conversation-enrichment.js";
import { compressRollingWindow, WINDOW_THRESHOLD } from "../lib/conversation-memory.js";
import { wrapAsDTU } from "../lib/inline-dtu-forge.js";
import { load } from "./depth/_harness.js";
import registerDtuRoutes from "../routes/dtus.js";
import registerHelpersExtendedRoutes from "../routes/helpers-extended.js";
import createOracleRoutes from "../routes/oracle.js";

const OWNER = "oracle-priv-owner-a";
const OTHER = "oracle-priv-owner-b";
const MARKER = `oracle-privacy-LR4267-${Date.now()}`;
const PUBLIC_ID = "oracle-priv-public-control";
const LEGACY_ID = "oracle-priv-legacy-ownerless";

const brain = {
  async query() {
    return { content: `stub answer for ${MARKER}` };
  },
};

function containsMarker(value) {
  return JSON.stringify(value ?? null).includes(MARKER);
}

describe("oracle.solve ownership", () => {
  it("persists a real user's answer as their private DTU and skips ownerless writes", async () => {
    const store = new Map();
    const oracle = createOracleEngine({ dtuStore: store, brain });
    const out = await oracle.solve(MARKER, { userId: OWNER });
    assert.equal(out.query, MARKER);
    assert.ok(out.recordedDTU, "solve should persist when the requester is a real user");
    const dtu = store.get(out.recordedDTU);
    assert.equal(dtu.type, "oracle_answer");
    assert.equal(dtu.visibility, "private");
    assert.equal(dtu.privacy, "private");
    assert.equal(dtu.scope, "user");
    assert.equal(dtu.ownerId, OWNER);
    assert.equal(dtu.author, OWNER);
    assert.equal(dtu.core.query, MARKER);

    const before = store.size;
    const anon = await oracle.solve(`${MARKER}-anon`, { userId: "anon" });
    assert.equal(anon.recordedDTU, null);
    const missing = await oracle.solve(`${MARKER}-none`, {});
    assert.equal(missing.recordedDTU, null);
    const founder = await oracle.solve(`${MARKER}-founder`, { userId: "founder" });
    assert.equal(founder.recordedDTU, null);
    assert.equal(store.size, before);
  });

  it("does not feed another user's private oracle answer into retrieval", async () => {
    const store = new Map();
    const oracle = createOracleEngine({ dtuStore: store, brain });
    await oracle.solve(MARKER, { userId: OWNER });
    store.set(PUBLIC_ID, {
      id: PUBLIC_ID,
      type: "note",
      tier: "regular",
      visibility: "public",
      scope: "global",
      title: PUBLIC_ID,
      human: { summary: "public control" },
      tags: [],
    });

    const asOther = await oracle.retrieve(MARKER, { primaryDomains: [] }, OTHER);
    assert.equal(containsMarker(asOther), false);
    assert.ok(asOther.dtus.some((d) => d.id === PUBLIC_ID));

    const asOwner = await oracle.retrieve(MARKER, { primaryDomains: [] }, OWNER);
    assert.equal(containsMarker(asOwner.priorAnswers), true);
  });
});

describe("sibling prompt captures", () => {
  it("forges and promotions are private to the requesting user", () => {
    const state = { dtus: new Map(), shadowDtus: new Map() };
    const forged = forgeFromMessage(state, {
      messageContent: `${MARKER} forged from the chat composer`,
      sessionId: "s-forge",
      userId: OWNER,
    });
    const forgedDtu = state.dtus.get(forged.dtuId);
    assert.equal(forgedDtu.visibility, "private");
    assert.equal(forgedDtu.ownerId, OWNER);
    assert.ok(forgedDtu.content.includes(MARKER));

    state.shadowDtus.set("out1", {
      id: "out1",
      tier: "shadow",
      content: `${MARKER} ${"x".repeat(220)}`,
      tags: ["shadow", "chat-output", "session:s-promo"],
      machine: { kind: "chat_output", sessionId: "s-promo", confidence: 0.9, workingSetDtuIds: [] },
      meta: {},
      human: { summary: MARKER },
    });
    const promo = acceleratedChatPromotion(state, "s-promo", OWNER);
    assert.equal(promo.promoted, 1);
    const promoted = state.dtus.get("out1");
    assert.equal(promoted.visibility, "private");
    assert.equal(promoted.ownerId, OWNER);

    const wrapped = wrapAsDTU({
      title: "Forged note",
      content: `${MARKER} forged artifact`,
      format: "document",
      userId: OWNER,
    });
    assert.equal(wrapped.scope, "local");
    assert.equal(wrapped.visibility, "private");
    assert.equal(wrapped.ownerId, OWNER);
  });

  it("refuses to compress a window that has no real owner", async () => {
    const messages = Array.from({ length: WINDOW_THRESHOLD }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: i % 2 === 0 ? `${MARKER} sailing vessels question` : "ack",
    }));
    const state = {
      sessions: new Map([["s-anon", { messages: messages.map((m) => ({ ...m })) }]]),
      dtus: new Map(),
    };
    const refused = await compressRollingWindow(state, "s-anon", {});
    assert.equal(refused.ok, false);
    assert.equal(refused.error, "owner_required");
    assert.equal(state.sessions.get("s-anon").messages.length, WINDOW_THRESHOLD);
    assert.equal(state.dtus.size, 0);
  });

  it("compresses a user's window into a private memory and a private per-owner mega", async () => {
    async function compressOwned(userId, sessionId) {
      const state = shared;
      const sess = {
        messages: Array.from({ length: WINDOW_THRESHOLD }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: i % 2 === 0 ? `${MARKER} sailing vessels question about private charts` : "ack",
        })),
      };
      state.sessions.set(sessionId, sess);
      for (let n = 0; n < 5; n++) {
        while (sess.messages.length < WINDOW_THRESHOLD) {
          sess.messages.push({ role: "user", content: `${MARKER} sailing vessels question about private charts` });
          sess.messages.push({ role: "assistant", content: "ack" });
        }
        const out = await compressRollingWindow(state, sessionId, { userId });
        assert.equal(out.ok, true, out.error || "compress failed");
      }
    }

    const shared = { sessions: new Map(), dtus: new Map() };
    await compressOwned(OWNER, "s-a");
    const mine = [...shared.dtus.values()].filter((d) => d.machine?.kind === "conversation_memory" && d.ownerId === OWNER);
    assert.ok(mine.length >= 1);
    assert.ok(mine.every((d) => d.visibility === "private" && d.ownerId === OWNER));
    assert.ok(mine.some((d) => containsMarker(d.human) || containsMarker(d.machine?.insights)));

    const megaA = [...shared.dtus.values()].filter((d) => d.machine?.kind === "conversation_memory_mega" && d.ownerId === OWNER);
    assert.ok(megaA.length >= 1);
    assert.ok(megaA.every((d) => d.visibility === "private" && d.id.startsWith("convmega_") && d.id.length === "convmega_".length + 16));

    await compressOwned(OTHER, "s-b");
    const megaB = [...shared.dtus.values()].filter((d) => d.machine?.kind === "conversation_memory_mega" && d.ownerId === OTHER);
    assert.ok(megaB.length >= 1);
    const idsA = new Set(megaA.map((d) => d.id));
    assert.ok(megaB.every((d) => !idsA.has(d.id)));
    for (const mega of megaA) {
      const live = shared.dtus.get(mega.id);
      assert.equal(live.ownerId, OWNER);
      assert.ok(!(live.machine?.sourceDtuIds || []).some((id) => {
        const row = shared.dtus.get(id);
        return row && row.ownerId === OTHER;
      }));
    }
  });
});

describe("oracle answer reads through the DTU API", () => {
  let runMacro, makeCtx, STATE;
  let http;
  let oracleId;

  function fakeReq(user) {
    return {
      user: user || undefined,
      ip: "127.0.0.1",
      method: "GET",
      path: "/api/dtus/x",
      headers: {},
      query: {},
      get: () => "",
    };
  }
  function anonCtx() { return makeCtx(fakeReq(null)); }
  function userCtx(id) { return makeCtx(fakeReq({ id, role: "member" })); }

  before(async () => {
    ({ runMacro, makeCtx, STATE } = await load());
    const oracle = createOracleEngine({ dtuStore: STATE.dtus, brain, db: STATE.db });
    const out = await oracle.solve(MARKER, { userId: OWNER });
    oracleId = out.recordedDTU;
    assert.ok(oracleId);

    const now = new Date().toISOString();
    STATE.dtus.set(PUBLIC_ID, {
      id: PUBLIC_ID,
      tier: "regular",
      type: "note",
      visibility: "public",
      scope: "global",
      title: PUBLIC_ID,
      human: { summary: "public control row" },
      core: {},
      machine: { kind: "note" },
      createdAt: now,
    });
    STATE.dtus.set(LEGACY_ID, {
      id: LEGACY_ID,
      tier: "regular",
      type: "oracle_answer",
      human: { summary: "legacy ownerless oracle answer" },
      core: { query: "legacy-not-the-marker", answer: "legacy" },
      machine: { kind: "oracle_answer" },
      tags: ["oracle_answer"],
      createdAt: now,
    });

    http = await startHttp({ STATE, makeCtx, runMacro });
  });

  after(async () => {
    if (http) await http.close();
  });

  function leaked(dtus) {
    return (dtus || []).some((d) => d?.id === oracleId || containsMarker(d));
  }

  it("dtu.get / dtu.list / dtu.lineage / dtu.recent hide the row from anonymous and from another member", async () => {
    for (const ctx of [anonCtx(), userCtx(OTHER)]) {
      const got = await runMacro("dtu", "get", { id: oracleId }, ctx);
      assert.equal(got.ok, false);
      assert.equal(containsMarker(got), false);

      const listed = await runMacro("dtu", "list", { limit: 5000 }, ctx);
      assert.equal(listed.ok, true);
      assert.equal(leaked(listed.dtus), false);
      assert.ok(listed.dtus.some((d) => d.id === PUBLIC_ID));
      assert.ok(listed.dtus.some((d) => d.id === LEGACY_ID));

      const lineage = await runMacro("dtu", "lineage", { id: oracleId }, ctx);
      assert.equal(lineage.ok, false);
      assert.equal(containsMarker(lineage), false);

      const recent = await runMacro("dtu", "recent", { limit: 100 }, ctx);
      assert.equal(leaked(recent.dtus), false);
    }

    const own = await runMacro("dtu", "get", { id: oracleId }, userCtx(OWNER));
    assert.equal(own.ok, true);
    assert.equal(own.dtu.core.query, MARKER);
    assert.equal(own.dtu.ownerId, OWNER);

    const ownList = await runMacro("dtu", "list", { limit: 5000 }, userCtx(OWNER));
    assert.ok(ownList.dtus.some((d) => d.id === oracleId));

    const legacy = await runMacro("dtu", "get", { id: LEGACY_ID }, anonCtx());
    assert.equal(legacy.ok, true);
  });

  it("HTTP list, by-id, lineage, related, history, search, and recent follow the same gate", async () => {
    for (const userId of [null, OTHER]) {
      const byId = await http.get(`/api/dtus/${oracleId}`, { userId });
      assert.equal(byId.status, 404);
      assert.equal(containsMarker(byId.body), false);

      const list = await http.get("/api/dtus?limit=5000", { userId });
      assert.equal(list.status, 200);
      assert.equal(leaked(list.body?.dtus), false);

      for (const path of ["lineage", "related", "history"]) {
        const res = await http.get(`/api/dtus/${oracleId}/${path}`, { userId });
        assert.equal(res.status, 404, path);
        assert.equal(containsMarker(res.body), false, path);
      }

      const search = await http.get(`/api/dtus/search?q=${encodeURIComponent(MARKER)}`, { userId });
      assert.equal(search.status, 200);
      assert.equal((search.body?.results || []).some((d) => d.id === oracleId), false);
      assert.equal(containsMarker(search.body), false);

      const recent = await http.get("/api/dtus/recent?limit=100", { userId });
      assert.equal((recent.body?.dtus || []).some((d) => d.id === oracleId), false);
    }

    const own = await http.get(`/api/dtus/${oracleId}`, { userId: OWNER });
    assert.equal(own.status, 200);
    assert.equal(own.body?.dtu?.core?.query, MARKER);

    const ownSearch = await http.get(`/api/dtus/search?q=${encodeURIComponent(MARKER)}`, { userId: OWNER });
    assert.ok((ownSearch.body?.results || []).some((d) => d.id === oracleId));

    const origList = STATE.dtus.list;
    STATE.dtus.list = ({ type, limit }) => [...STATE.dtus.values()]
      .filter((d) => !type || d.type === type)
      .slice(0, limit || 10);
    try {
      const anonRecent = await http.get("/api/oracle/recent", {});
      assert.equal(anonRecent.status, 401);

      const otherRecent = await http.get("/api/oracle/recent?limit=50", { userId: OTHER });
      assert.equal(otherRecent.status, 200);
      assert.equal((otherRecent.body?.items || []).some((d) => d.id === oracleId), false);
      assert.ok((otherRecent.body?.items || []).some((d) => d.id === LEGACY_ID));

      const ownRecent = await http.get("/api/oracle/recent?limit=50", { userId: OWNER });
      assert.ok((ownRecent.body?.items || []).some((d) => d.id === oracleId));
    } finally {
      if (origList) STATE.dtus.list = origList;
      else delete STATE.dtus.list;
    }
  });
});

async function startHttp({ STATE, makeCtx, runMacro }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user");
    if (uid) req.user = { id: uid, role: "member" };
    next();
  });
  const passthrough = () => (_req, _res, next) => next();
  registerHelpersExtendedRoutes(app, {
    db: STATE.db,
    STATE,
    makeCtx,
    runMacro,
    saveStateDebounced: () => {},
    dtusArray: () => [...STATE.dtus.values()],
    uid: (prefix) => `${prefix}_test`,
    requireAuth: passthrough,
    requireRole: () => passthrough(),
  });
  registerDtuRoutes(app, {
    STATE,
    makeCtx,
    runMacro,
    dtuForClient: (d) => d,
    dtusArray: () => [...STATE.dtus.values()],
    userVisibleDTUs: () => [],
    _withAck: (out) => out,
    _saveStateDebounced: () => {},
    validate: passthrough,
    requireRole: () => passthrough(),
  });
  app.use("/api/oracle", createOracleRoutes({
    STATE,
    requireAuth: (req, res, next) => {
      if (!req.user?.id) return res.status(401).json({ ok: false, error: "auth" });
      next();
    },
    dtuStore: STATE.dtus,
    domainHandlers: {},
  }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const port = server.address().port;

  async function get(path, opts = {}) {
    const headers = {};
    if (opts.userId) headers["x-test-user"] = opts.userId;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }
    return { status: res.status, body };
  }

  return { get, close: () => new Promise((resolve) => server.close(resolve)) };
}
