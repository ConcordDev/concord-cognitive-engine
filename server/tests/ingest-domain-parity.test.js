// Contract tests for server/domains/ingest.js — the ELT-pipeline macros:
// connector catalog, scheduled / incremental sync, field-mapping transforms,
// sync-run logs + replay, dedup config, OCR ingestion, webhook push.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerIngestActions from "../domains/ingest.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ingest.${name}`);
  if (!fn) throw new Error(`ingest.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerIngestActions(register); });

// Fresh per-user pipeline state before each test.
beforeEach(() => {
  globalThis._concordSTATE = {};
});

const ctxA = { actor: { userId: "ingest_user_a" }, userId: "ingest_user_a" };
const ctxB = { actor: { userId: "ingest_user_b" }, userId: "ingest_user_b" };

function makeConnection(ctx = ctxA, connectorId = "postgres") {
  const cfg = {
    postgres: { host: "h", port: 5432, database: "d", username: "u", password: "p", table: "t" },
    "rest-api": { baseUrl: "https://x", path: "/v1", method: "GET" },
    "google-sheets": { spreadsheetId: "s", sheetName: "Sheet1" },
  }[connectorId];
  const r = call("configureConnector", ctx, { connectorId, config: cfg });
  assert.equal(r.ok, true, r.error);
  return r.result.connectionId;
}

describe("ingest.listConnectors", () => {
  it("returns the static catalog", () => {
    const r = call("listConnectors", ctxA, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.count >= 5);
    assert.ok(r.result.connectors.some((c) => c.id === "postgres"));
    assert.ok(r.result.connectors.some((c) => c.requiresOAuth));
    assert.ok(Array.isArray(r.result.categories));
  });
});

describe("ingest.configureConnector / listConnections / deleteConnection", () => {
  it("rejects unknown connector", () => {
    const r = call("configureConnector", ctxA, { connectorId: "nope", config: {} });
    assert.equal(r.ok, false);
  });

  it("rejects missing required fields", () => {
    const r = call("configureConnector", ctxA, { connectorId: "postgres", config: {} });
    assert.equal(r.ok, false);
    assert.match(r.error, /Missing required fields/);
  });

  it("creates a connection and lists it with redacted secrets", () => {
    const id = makeConnection(ctxA);
    const list = call("listConnections", ctxA, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    const conn = list.result.connections[0];
    assert.equal(conn.id, id);
    assert.equal(conn.config.password, "••••••••");
    assert.equal(conn.config.host, "h");
  });

  it("OAuth connectors get a pending status + authorize URL", () => {
    const r = call("configureConnector", ctxA, {
      connectorId: "google-sheets",
      config: { spreadsheetId: "s", sheetName: "Sheet1" },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.status, "pending_oauth");
    assert.match(r.result.oauthUrl, /oauth\/google\/authorize/);
  });

  it("connections are per-user isolated", () => {
    makeConnection(ctxA);
    assert.equal(call("listConnections", ctxB, {}).result.count, 0);
  });

  it("deletes a connection", () => {
    const id = makeConnection(ctxA);
    const r = call("deleteConnection", ctxA, { connectionId: id });
    assert.equal(r.ok, true);
    assert.equal(call("listConnections", ctxA, {}).result.count, 0);
  });
});

describe("ingest.scheduleSync / listSchedules / toggleSchedule / deleteSchedule", () => {
  it("rejects schedule on a missing connection", () => {
    const r = call("scheduleSync", ctxA, { connectionId: "ghost", cadence: "daily" });
    assert.equal(r.ok, false);
  });

  it("rejects an unknown cadence", () => {
    const id = makeConnection(ctxA);
    const r = call("scheduleSync", ctxA, { connectionId: id, cadence: "yearly" });
    assert.equal(r.ok, false);
  });

  it("creates a schedule with a real nextRunAt", () => {
    const id = makeConnection(ctxA);
    const r = call("scheduleSync", ctxA, { connectionId: id, cadence: "hourly", mode: "incremental" });
    assert.equal(r.ok, true);
    assert.equal(r.result.cadence, "hourly");
    assert.ok(r.result.nextRunAt > Date.now());
    const list = call("listSchedules", ctxA, {});
    assert.equal(list.result.count, 1);
  });

  it("toggles and deletes a schedule", () => {
    const id = makeConnection(ctxA);
    const sid = call("scheduleSync", ctxA, { connectionId: id, cadence: "daily" }).result.scheduleId;
    const off = call("toggleSchedule", ctxA, { scheduleId: sid, enabled: false });
    assert.equal(off.result.enabled, false);
    const del = call("deleteSchedule", ctxA, { scheduleId: sid });
    assert.equal(del.ok, true);
    assert.equal(call("listSchedules", ctxA, {}).result.count, 0);
  });

  it("deleting a connection cascades to its schedules", () => {
    const id = makeConnection(ctxA);
    call("scheduleSync", ctxA, { connectionId: id, cadence: "daily" });
    call("deleteConnection", ctxA, { connectionId: id });
    assert.equal(call("listSchedules", ctxA, {}).result.count, 0);
  });
});

describe("ingest.runSync (incremental cursor deltas)", () => {
  it("rejects sync without records", () => {
    const id = makeConnection(ctxA);
    const r = call("runSync", ctxA, { connectionId: id, records: [] });
    assert.equal(r.ok, false);
  });

  it("loads all records on the first run and advances the cursor", () => {
    const id = makeConnection(ctxA);
    const r = call("runSync", ctxA, {
      connectionId: id,
      records: [
        { id: 1, updated_at: "2026-01-01" },
        { id: 2, updated_at: "2026-01-02" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.recordsLoaded, 2);
    assert.equal(r.result.newCursor, "2026-01-02");
  });

  it("a second incremental run only loads records past the stored cursor", () => {
    const id = makeConnection(ctxA);
    call("runSync", ctxA, { connectionId: id, records: [{ id: 1, updated_at: "2026-01-01" }] });
    const r2 = call("runSync", ctxA, {
      connectionId: id,
      records: [
        { id: 1, updated_at: "2026-01-01" },
        { id: 2, updated_at: "2026-01-03" },
      ],
    });
    assert.equal(r2.result.recordsExtracted, 1);
    assert.equal(r2.result.recordsLoaded, 1);
    assert.equal(r2.result.newCursor, "2026-01-03");
  });

  it("dedup removes identical records inside a run", () => {
    const id = makeConnection(ctxA);
    const r = call("runSync", ctxA, {
      connectionId: id,
      mode: "full",
      records: [{ a: 1 }, { a: 1 }, { a: 2 }],
    });
    assert.equal(r.result.recordsLoaded, 2);
    assert.equal(r.result.duplicatesRemoved, 1);
  });
});

describe("ingest.listSyncRuns / replaySyncRun", () => {
  it("logs runs with row/byte totals", () => {
    const id = makeConnection(ctxA);
    call("runSync", ctxA, { connectionId: id, mode: "full", records: [{ a: 1 }] });
    const log = call("listSyncRuns", ctxA, {});
    assert.equal(log.ok, true);
    assert.equal(log.result.count, 1);
    assert.equal(log.result.totalRecordsLoaded, 1);
    assert.ok(log.result.totalByteVolume > 0);
  });

  it("rejects replay of an unknown run", () => {
    const r = call("replaySyncRun", ctxA, { runId: "ghost" });
    assert.equal(r.ok, false);
  });

  it("replays a logged run", () => {
    const id = makeConnection(ctxA);
    call("runSync", ctxA, { connectionId: id, mode: "full", records: [{ a: 1 }] });
    const runId = call("listSyncRuns", ctxA, {}).result.runs[0].id;
    const replay = call("replaySyncRun", ctxA, { runId });
    assert.equal(replay.ok, true);
    assert.equal(replay.result.replayOf, runId);
    assert.equal(call("listSyncRuns", ctxA, {}).result.count, 2);
  });
});

describe("ingest.previewTransform / saveMapping / getMapping", () => {
  it("rejects preview without a sample", () => {
    const r = call("previewTransform", ctxA, { sample: [], mapping: [] });
    assert.equal(r.ok, false);
  });

  it("renames, casts and derives fields in a preview", () => {
    const r = call("previewTransform", ctxA, {
      sample: [{ name: "Ada", amount: "42" }],
      mapping: [
        { action: "rename", from: "name", to: "fullName" },
        { action: "cast", from: "amount", castTo: "number" },
        { action: "derive", to: "source", value: "ingest" },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.preview[0].after.fullName, "Ada");
    assert.equal(r.result.preview[0].after.amount, 42);
    assert.equal(r.result.preview[0].after.source, "ingest");
    assert.ok(r.result.derivedFields.includes("source"));
  });

  it("rejects mappings with an invalid action", () => {
    const id = makeConnection(ctxA);
    const r = call("saveMapping", ctxA, { connectionId: id, mapping: [{ action: "explode" }] });
    assert.equal(r.ok, false);
  });

  it("saves and reads back a mapping for a connection", () => {
    const id = makeConnection(ctxA);
    const mapping = [{ action: "drop", from: "secret" }];
    const save = call("saveMapping", ctxA, { connectionId: id, mapping });
    assert.equal(save.ok, true);
    assert.equal(save.result.ruleCount, 1);
    const get = call("getMapping", ctxA, { connectionId: id });
    assert.equal(get.result.mapping[0].action, "drop");
  });

  it("a saved mapping is applied by runSync", () => {
    const id = makeConnection(ctxA);
    call("saveMapping", ctxA, { connectionId: id, mapping: [{ action: "drop", from: "secret" }] });
    const r = call("runSync", ctxA, {
      connectionId: id,
      mode: "full",
      records: [{ keep: 1, secret: "x" }],
    });
    assert.equal(r.result.records[0].secret, undefined);
    assert.equal(r.result.records[0].keep, 1);
  });
});

describe("ingest.getDedupConfig / setDedupConfig", () => {
  it("returns a default config", () => {
    const r = call("getDedupConfig", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.enabled, true);
  });

  it("persists a custom dedup config", () => {
    const set = call("setDedupConfig", ctxA, { enabled: false, threshold: 0.8, strategy: "key-field", keyField: "uid" });
    assert.equal(set.ok, true);
    assert.equal(set.result.enabled, false);
    assert.equal(set.result.strategy, "key-field");
    assert.equal(set.result.keyField, "uid");
    assert.equal(call("getDedupConfig", ctxA, {}).result.threshold, 0.8);
  });

  it("disabling dedup keeps duplicate records in a sync", () => {
    call("setDedupConfig", ctxA, { enabled: false });
    const id = makeConnection(ctxA);
    const r = call("runSync", ctxA, { connectionId: id, mode: "full", records: [{ a: 1 }, { a: 1 }] });
    assert.equal(r.result.recordsLoaded, 2);
    assert.equal(r.result.duplicatesRemoved, 0);
  });
});

describe("ingest.ocrIngest", () => {
  it("rejects an empty OCR payload", () => {
    const r = call("ocrIngest", ctxA, {});
    assert.equal(r.ok, false);
  });

  it("structures multi-page OCR text with headings and chunks", () => {
    const r = call("ocrIngest", ctxA, {
      pages: [
        "# Title One\nSome body text on page one.",
        { text: "SECTION HEADING\nMore text on the second page.", confidence: 0.4 },
      ],
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.pageCount, 2);
    assert.ok(r.result.totalWords > 0);
    assert.ok(r.result.headings.length >= 1);
    assert.ok(r.result.chunkCount >= 1);
    assert.deepEqual(r.result.lowConfidencePages, [2]);
  });
});

describe("ingest.getWebhookEndpoint / pushRecord / listWebhookRecords", () => {
  it("mints a stable webhook endpoint", () => {
    const r = call("getWebhookEndpoint", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.url, /\/api\/ingest\/webhook\//);
    // A second call without rotate returns the same token.
    assert.equal(call("getWebhookEndpoint", ctxA, {}).result.token, r.result.token);
  });

  it("rotates the token on demand", () => {
    const t1 = call("getWebhookEndpoint", ctxA, {}).result.token;
    const t2 = call("getWebhookEndpoint", ctxA, { rotate: true }).result.token;
    assert.notEqual(t1, t2);
  });

  it("rejects a push before an endpoint exists", () => {
    const r = call("pushRecord", ctxB, { records: [{ a: 1 }] });
    assert.equal(r.ok, false);
  });

  it("accepts pushed records and lists them", () => {
    call("getWebhookEndpoint", ctxA, {});
    const push = call("pushRecord", ctxA, { records: [{ event: "x" }, { event: "y" }], source: "test" });
    assert.equal(push.ok, true);
    assert.equal(push.result.accepted, 2);
    const list = call("listWebhookRecords", ctxA, {});
    assert.equal(list.result.count, 2);
    assert.equal(list.result.records[0].payload.event, "y");
  });
});

describe("ingest legacy workbench macros", () => {
  it("parseDocument detects format and counts", () => {
    const r = ACTIONS.get("ingest.parseDocument")(
      ctxA, { data: { text: "# Heading\n\nFirst sentence. Second one." }, meta: {} }, {},
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.format, "markdown");
    assert.ok(r.result.wordCount > 0);
  });

  it("extractEntities pulls emails and urls", () => {
    const r = ACTIONS.get("ingest.extractEntities")(
      ctxA, { data: { text: "mail me at a@b.com or visit https://x.io" }, meta: {} }, {},
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.summary.emailCount, 1);
    assert.equal(r.result.summary.urlCount, 1);
  });

  it("validateSchema reports valid / invalid records", () => {
    const r = ACTIONS.get("ingest.validateSchema")(
      ctxA,
      { data: { records: [{ id: 1, name: "a" }, { id: 2 }], expectedFields: ["id", "name"] }, meta: {} },
      {},
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.validRecords, 1);
    assert.equal(r.result.invalidRecords, 1);
  });

  it("batchStatus summarizes batch item statuses", () => {
    const r = ACTIONS.get("ingest.batchStatus")(
      ctxA,
      { data: { items: [{ status: "completed" }, { status: "failed", error: "boom" }] }, meta: {} },
      {},
    );
    assert.equal(r.ok, true);
    assert.equal(r.result.completed, 1);
    assert.equal(r.result.failed, 1);
    assert.equal(r.result.recentErrors.length, 1);
  });
});
