// ingest-full-build.test.js — B7's full-build slices for the Ingest lens
// (F-C row 7): IG-S1a retrieval (listIngested / getIngested), IG-S1b the
// server ingest verb with content-hash dedup (ingestText), IG-S2 sync
// honesty (endpoint fetch, source labelling, failed runs, replay totals),
// IG-S4's server half (rotation carries the webhook counters), IG-S5's
// server half (parseDocument / extractEntities / batchStatus detail).
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import registerIngestActions from "../domains/ingest.js";
import { __setPublicFetchTestTransport } from "../lib/public-fetch.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ingest.${name}`);
  if (!fn) throw new Error(`ingest.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerIngestActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; __setPublicFetchTestTransport(null); });
afterEach(() => { __setPublicFetchTestTransport(null); });

let dtuSeq = 0;
// A dtu.create stand-in with the real macro's contract: stamps an id and
// the caller as author, stores the row in STATE.dtus (the canonical map).
function makeCtx(userId) {
  return {
    actor: { userId }, userId,
    macro: {
      run: async (domain, action, input) => {
        assert.equal(domain, "dtu");
        assert.equal(action, "create");
        const id = `dtu_test_${++dtuSeq}`;
        const S = globalThis._concordSTATE || (globalThis._concordSTATE = {});
        if (!(S.dtus instanceof Map)) S.dtus = new Map();
        S.dtus.set(id, {
          id, title: input.title, content: input.content,
          domain: input.domain, tags: input.tags,
          author: userId, createdAt: 1700000000000 + dtuSeq,
        });
        return { ok: true, result: { id } };
      },
    },
  };
}
const ctxA = () => makeCtx("ingest_user_a");
const ctxB = () => makeCtx("ingest_user_b");

function seedDtu(id, row) {
  const S = globalThis._concordSTATE || (globalThis._concordSTATE = {});
  if (!(S.dtus instanceof Map)) S.dtus = new Map();
  S.dtus.set(id, { id, ...row });
}

function restConnection(ctx) {
  const r = call("configureConnector", ctx, {
    connectorId: "rest-api",
    config: { baseUrl: "https://fixture.example", path: "/posts", method: "GET" },
  });
  assert.equal(r.ok, true, r.error);
  return r.result.connectionId;
}

describe("IG-S1b ingestText — server chunking, attribution, dedup receipt", () => {
  it("creates one DTU per chunk, stamped domain 'ingest' + tag 'ingested'", async () => {
    const ctx = ctxA();
    const text = "a".repeat(600); // 500/50 chunking -> 2 chunks
    const r = await call("ingestText", ctx, { text, title: "My Doc", chunkSize: 500, chunkOverlap: 50 });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.totalChunks, 2);
    assert.equal(r.result.createdCount, 2);
    assert.equal(r.result.dedupedCount, 0);
    const stored = [...globalThis._concordSTATE.dtus.values()];
    assert.equal(stored.length, 2);
    assert.ok(stored.every((d) => d.domain === "ingest" && d.tags.includes("ingested")));
    assert.equal(stored[0].title, "My Doc (chunk 1 of 2)");
  });

  it("a repeat ingest dedups entire — the receipt distinguishes it", async () => {
    const ctx = ctxA();
    const text = "unique content for dedup";
    const first = await call("ingestText", ctx, { text, title: "Doc" });
    assert.equal(first.result.createdCount, 1);
    const second = await call("ingestText", ctx, { text, title: "Doc" });
    assert.equal(second.ok, true);
    assert.equal(second.result.createdCount, 0);
    assert.equal(second.result.dedupedCount, 1);
    assert.equal(second.result.deduped[0].dtuId, first.result.created[0].dtuId);
    assert.equal(globalThis._concordSTATE.dtus.size, 1);
  });

  it("dedup is per-caller — another user's identical text still creates", async () => {
    const text = "shared text";
    await call("ingestText", ctxA(), { text });
    const rb = await call("ingestText", ctxB(), { text });
    assert.equal(rb.result.createdCount, 1);
    assert.equal(rb.result.dedupedCount, 0);
  });

  it("refuses empty text", async () => {
    const r = await call("ingestText", ctxA(), { text: "   " });
    assert.equal(r.ok, false);
  });
});

describe("IG-S1a listIngested / getIngested — the retrieval path", () => {
  it("lists only the caller's ingested DTUs, with a true total", async () => {
    const ctx = ctxA();
    await call("ingestText", ctx, { text: "alpha body" });
    seedDtu("dtu_manual", { title: "Filed In", content: "beta body", domain: "ingest", tags: [], author: "ingest_user_a", createdAt: 1700000009999 });
    seedDtu("dtu_other_domain", { title: "Music Note", content: "gamma", domain: "music", tags: [], author: "ingest_user_a", createdAt: 1700000010000 });
    seedDtu("dtu_someone_elses", { title: "Not Mine", content: "delta", domain: "ingest", tags: ["ingested"], author: "ingest_user_b", createdAt: 1700000010001 });
    const r = await call("listIngested", ctx, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.total, 2);
    assert.deepEqual(r.result.dtus.map((d) => d.title).sort(), ["Filed In", "Ingested chunk 1"]);
  });

  it("search filters by title and content", async () => {
    const ctx = ctxA();
    await call("ingestText", ctx, { text: "the needle lives here", title: "Haystack" });
    await call("ingestText", ctx, { text: "plain straw", title: "Other" });
    const byContent = await call("listIngested", ctx, { q: "needle" });
    assert.equal(byContent.result.total, 1);
    assert.equal(byContent.result.dtus[0].title, "Haystack");
    const byTitle = await call("listIngested", ctx, { q: "other" });
    assert.equal(byTitle.result.total, 1);
  });

  it("getIngested returns the caller's content; anything else is not-found", async () => {
    const ctx = ctxA();
    const made = await call("ingestText", ctx, { text: "read me back", title: "Readable" });
    const id = made.result.created[0].dtuId;
    const got = await call("getIngested", ctx, { dtuId: id });
    assert.equal(got.ok, true);
    assert.equal(got.result.content, "read me back");
    seedDtu("dtu_foreign", { title: "Foreign", content: "secret", domain: "ingest", tags: ["ingested"], author: "ingest_user_b" });
    assert.equal((await call("getIngested", ctx, { dtuId: "dtu_foreign" })).ok, false);
    seedDtu("dtu_plain", { title: "Plain", content: "not ingested", domain: "music", tags: [], author: "ingest_user_a" });
    assert.equal((await call("getIngested", ctx, { dtuId: "dtu_plain" })).ok, false);
  });
});

describe("IG-S2 runSync — endpoint fetch, source labels, replay totals", () => {
  it("a REST connection syncs the endpoint its config names (known count)", async () => {
    const ctx = ctxA();
    const id = restConnection(ctx);
    __setPublicFetchTestTransport(async (url) => {
      assert.match(String(url), /fixture\.example\/posts/);
      return {
        ok: true, status: 200,
        headers: { get: () => "application/json" },
        text: async () => JSON.stringify([
          { id: 1, updated_at: "2026-01-01" },
          { id: 2, updated_at: "2026-01-02" },
          { id: 3, updated_at: "2026-01-03" },
        ]),
      };
    });
    const r = await call("runSync", ctx, { connectionId: id });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.result.source, "endpoint");
    assert.equal(r.result.recordsLoaded, 3);
    assert.equal(r.result.newCursor, "2026-01-03");
  });

  it("a caller-supplied payload run is labelled a payload run", async () => {
    const ctx = ctxA();
    const id = restConnection(ctx);
    const r = await call("runSync", ctx, { connectionId: id, records: [{ id: 9, updated_at: "2026-02-01" }] });
    assert.equal(r.ok, true);
    assert.equal(r.result.source, "payload");
  });

  it("a failed fetch lands as a failed run with the error named", async () => {
    const ctx = ctxA();
    const id = restConnection(ctx);
    __setPublicFetchTestTransport(async () => ({
      ok: false, status: 500, headers: { get: () => null }, text: async () => "boom",
    }));
    const r = await call("runSync", ctx, { connectionId: id });
    assert.equal(r.ok, false);
    assert.match(r.error, /HTTP 500/);
    const log = await call("listSyncRuns", ctx, {});
    assert.equal(log.result.count, 1);
    assert.equal(log.result.runs[0].status, "failed");
    assert.equal(log.result.totalFailures, 1);
  });

  it("a private/loopback endpoint is refused by the SSRF guard, and logged", async () => {
    const ctx = ctxA();
    const r0 = call("configureConnector", ctx, {
      connectorId: "rest-api",
      config: { baseUrl: "http://127.0.0.1:9", path: "/x", method: "GET" },
    });
    const r = await call("runSync", ctx, { connectionId: r0.result.connectionId });
    assert.equal(r.ok, false);
    assert.match(r.error, /not allowed/i);
    const log = await call("listSyncRuns", ctx, {});
    assert.equal(log.result.runs[0].status, "failed");
  });

  it("replay no longer double-counts cumulative totals", async () => {
    const ctx = ctxA();
    const id = restConnection(ctx);
    await call("runSync", ctx, { connectionId: id, records: [{ a: 1 }, { a: 2 }] });
    const beforeLog = await call("listSyncRuns", ctx, {});
    assert.equal(beforeLog.result.totalRecordsLoaded, 2);
    const runId = beforeLog.result.runs[0].id;
    await call("replaySyncRun", ctx, { runId });
    const afterLog = await call("listSyncRuns", ctx, {});
    assert.equal(afterLog.result.count, 2);
    assert.equal(afterLog.result.totalRecordsLoaded, 2);
    assert.equal(afterLog.result.totalByteVolume, beforeLog.result.totalByteVolume);
  });
});

describe("IG-S4 rotation — the counters belong to the user, not the token", () => {
  it("rotation carries recordsReceived + lastReceivedAt across", async () => {
    const ctx = ctxA();
    const ep1 = await call("getWebhookEndpoint", ctx, {});
    await call("pushRecord", ctx, { records: [{ event: "a" }] });
    const ep2 = await call("getWebhookEndpoint", ctx, { rotate: true });
    assert.notEqual(ep2.result.token, ep1.result.token);
    assert.equal(ep2.result.recordsReceived, 1);
    assert.ok(ep2.result.lastReceivedAt);
    const list = await call("listWebhookRecords", ctx, {});
    assert.equal(list.result.count, 1);
  });
});

describe("IG-S5 analysis detail — parse / entities / batch", () => {
  it("parseDocument does not split sentences on decimal points; averages are real", async () => {
    const res = ACTIONS.get("ingest.parseDocument")(ctxA(), { data: { text: "Pi equals 3.14159 exactly. The price is 2.50 dollars today. Concord has four letters in ego. Done now." }, meta: {} }, {});
    assert.equal(res.result.wordCount, 18);
    assert.equal(res.result.sentenceCount, 4);
    assert.equal(res.result.avgWordsPerSentence, 4.5);
  });

  it("extractEntities captures plain multi-digit and single-digit numbers; count == list", async () => {
    const res = ACTIONS.get("ingest.extractEntities")(ctxA(), { data: { text: "In 2024 the crew logged 5 trips, 42 nails, a $1,250.50 invoice and marker 1030 near route 87." }, meta: {} }, {});
    for (const n of ["2024", "5", "42", "$1,250.50", "1030", "87"]) {
      assert.ok(res.result.numbers.includes(n), `missing ${n} in ${JSON.stringify(res.result.numbers)}`);
    }
    assert.equal(res.result.summary.numberCount, res.result.numbers.length);
  });

  it("batchStatus buckets common status words (complete / active)", async () => {
    const res = ACTIONS.get("ingest.batchStatus")(ctxA(), { data: { items: [{ id: "a", status: "complete" }, { id: "b", status: "active" }] }, meta: {} }, {});
    assert.equal(res.result.totalItems, 2);
    assert.equal(res.result.completed, 1);
    assert.equal(res.result.inProgress, 1);
    assert.equal(res.result.completionRate, 50);
  });
});
