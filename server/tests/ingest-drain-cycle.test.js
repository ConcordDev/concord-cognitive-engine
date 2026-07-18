/**
 * Tier-2 contract tests for the WAVE4 ingest row: a real scheduled drain of
 * due connector-backed ingest schedules.
 *
 * server/domains/ingest.js already models the full ELT surface (catalog /
 * connections / schedules / sync-run log / webhooks) including a real
 * computed `nextRunAt` per schedule, but nothing ever walked due schedules
 * on its own. server/emergent/ingest-drain-cycle.js is that heartbeat.
 *
 * These tests pin:
 *   - a due, OAuth-connector-backed schedule is drained via a stubbed
 *     connector reader (no real network/token plumbing exercised) and its
 *     connection cursor + sync-run log advance exactly like a manual
 *     ingest.runSync would;
 *   - a non-due schedule (nextRunAt in the future) is left completely
 *     untouched;
 *   - a disabled schedule is never drained even if overdue;
 *   - a schedule backed by an unwired source (postgres — credentials-auth,
 *     needs a per-source credential driver) is skipped every cycle with a
 *     specific, honest reason and never marked drained;
 *   - a push-driven (webhook) source is never polled — it reports the real
 *     count of records already received via push;
 *   - the cycle NEVER throws: a malformed schedule record, a throwing
 *     connector reader, or a wholly-absent STATE all degrade to an honest
 *     per-schedule skip/error instead of crashing the heartbeat;
 *   - a zero-schedule cycle is a harmless no-op;
 *   - work is bounded per cycle via CONCORD_INGEST_DRAIN_BATCH.
 *
 * Run: node --test server/tests/ingest-drain-cycle.test.js
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";

process.env.NODE_ENV = process.env.NODE_ENV || "test";
// This suite never opens a real sqlite handle (connector readers are always
// stubbed via opts.readers), but DB_PATH is isolated defensively per the
// project convention so nothing in the import graph can touch a shared dev
// DB if that ever changes.
if (!process.env.DB_PATH) {
  process.env.DB_PATH = path.join(os.tmpdir(), `concord-ingest-drain-${process.pid}-${Date.now()}.db`);
}

import registerIngestActions, { getIngestState, userMap, CATALOG_BY_ID } from "../domains/ingest.js";
import { runIngestDrainCycle } from "../emergent/ingest-drain-cycle.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`ingest.${name}`);
  if (!fn) throw new Error(`ingest.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}
before(() => { registerIngestActions(register); });

beforeEach(() => { globalThis._concordSTATE = {}; });

const USER = "drain_user";
const ctx = { actor: { userId: USER }, userId: USER };

function makeConnection(connectorId, config = {}) {
  const r = call("configureConnector", ctx, { connectorId, config });
  assert.equal(r.ok, true, r.error);
  return r.result.connectionId;
}

function configureConnection(connectionId) {
  // Non-OAuth connectors (postgres/s3/stripe/rest-api) come back
  // status:'configured' already; OAuth ones (gmail/slack/google-sheets/
  // github) start 'pending_oauth' until a handshake completes — tests that
  // want to exercise a real drain flip it to 'configured' directly, the
  // same state a completed OAuth callback would leave it in.
  const state = getIngestState();
  const conn = userMap(state.connections, USER).get(connectionId);
  conn.status = "configured";
  return conn;
}

function makeSchedule(connectionId, opts = {}) {
  const r = call("scheduleSync", ctx, {
    connectionId, cadence: opts.cadence || "hourly", mode: opts.mode || "incremental",
  });
  assert.equal(r.ok, true, r.error);
  return r.result.scheduleId;
}

function forceDue(scheduleId) {
  const state = getIngestState();
  const sched = userMap(state.schedules, USER).get(scheduleId);
  sched.nextRunAt = Date.now() - 1000;
  return sched;
}

const GMAIL_CONFIG = { defaultFrom: "a@b.com" };

describe("runIngestDrainCycle — zero-work + never-throw", () => {
  it("is a harmless no-op with zero schedules anywhere", async () => {
    const r = await runIngestDrainCycle({ db: null });
    assert.equal(r.ok, true);
    assert.equal(r.dueCount, 0);
    assert.equal(r.processed, 0);
    assert.equal(r.drained, 0);
  });

  it("never throws when the ingest STATE is entirely absent", async () => {
    globalThis._concordSTATE = undefined;
    let threw = false;
    let r;
    try { r = await runIngestDrainCycle({ db: null }); } catch { threw = true; }
    assert.equal(threw, false);
    assert.equal(r.ok, true);
  });

  it("never throws on a malformed schedule record (missing connection/intervalMs)", async () => {
    const state = getIngestState();
    const schedules = userMap(state.schedules, USER);
    schedules.set("broken", {
      id: "broken", enabled: true, nextRunAt: Date.now() - 1, connectionId: "ghost-conn",
      // no intervalMs, no connectorName, no mode — a truly malformed row.
    });
    let threw = false;
    let r;
    try { r = await runIngestDrainCycle({ db: null }); } catch { threw = true; }
    assert.equal(threw, false);
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 1);
    const sched = schedules.get("broken");
    assert.equal(sched.lastDrainStatus, "skipped");
    assert.equal(sched.lastDrainReason, "connection_missing");
    // Cadence still advanced via the DEFAULT_INTERVAL_MS fallback — a
    // broken schedule doesn't hot-loop every tick forever.
    assert.ok(sched.nextRunAt > Date.now());
  });

  it("never throws when a connector reader itself throws", async () => {
    const connId = makeConnection("gmail", GMAIL_CONFIG);
    configureConnection(connId);
    const schedId = makeSchedule(connId);
    forceDue(schedId);

    let threw = false;
    let r;
    try {
      r = await runIngestDrainCycle({ db: null }, {
        readers: { gmail: async () => { throw new Error("boom"); } },
      });
    } catch { threw = true; }
    assert.equal(threw, false);
    assert.equal(r.ok, true);
    assert.equal(r.errored, 1);

    const state = getIngestState();
    const sched = userMap(state.schedules, USER).get(schedId);
    assert.equal(sched.lastDrainStatus, "error");
    assert.match(sched.lastDrainReason, /reader_threw/);
  });
});

describe("runIngestDrainCycle — due detection", () => {
  it("leaves a non-due schedule (nextRunAt in the future) completely untouched", async () => {
    const connId = makeConnection("gmail", GMAIL_CONFIG);
    configureConnection(connId);
    const schedId = makeSchedule(connId); // nextRunAt = now + intervalMs, not due
    const state = getIngestState();
    const before_ = { ...userMap(state.schedules, USER).get(schedId) };

    const r = await runIngestDrainCycle({ db: null }, {
      readers: { gmail: async () => { throw new Error("must not be called — schedule is not due"); } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.dueCount, 0);

    const after = userMap(state.schedules, USER).get(schedId);
    assert.equal(after.runCount, before_.runCount);
    assert.equal(after.nextRunAt, before_.nextRunAt);
    assert.equal(after.lastDrainStatus, undefined);
  });

  it("does not drain a disabled schedule even if its nextRunAt is overdue", async () => {
    const connId = makeConnection("gmail", GMAIL_CONFIG);
    configureConnection(connId);
    const schedId = makeSchedule(connId);
    const sched = forceDue(schedId);
    sched.enabled = false;

    const r = await runIngestDrainCycle({ db: null }, {
      readers: { gmail: async () => { throw new Error("must not be called — schedule is disabled"); } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.dueCount, 0);
  });

  it("bounds work per cycle via CONCORD_INGEST_DRAIN_BATCH", async () => {
    process.env.CONCORD_INGEST_DRAIN_BATCH = "2";
    try {
      for (let i = 0; i < 5; i++) {
        const connId = makeConnection("gmail", GMAIL_CONFIG);
        configureConnection(connId);
        const schedId = makeSchedule(connId);
        forceDue(schedId);
      }
      let callCount = 0;
      const r = await runIngestDrainCycle({ db: null }, {
        readers: {
          gmail: async () => {
            callCount++;
            return { ok: true, scanned: 0, extracted: 0, records: [], cursorField: null, newCursor: null };
          },
        },
      });
      assert.equal(r.ok, true);
      assert.equal(r.dueCount, 5);
      assert.equal(r.processed, 2);
      assert.equal(callCount, 2);
    } finally {
      delete process.env.CONCORD_INGEST_DRAIN_BATCH;
    }
  });
});

describe("runIngestDrainCycle — real drain of an OAuth-connector-backed schedule", () => {
  it("drains a due schedule via a stubbed connector reader and advances the cursor", async () => {
    const connId = makeConnection("gmail", GMAIL_CONFIG);
    configureConnection(connId);
    const schedId = makeSchedule(connId, { mode: "incremental" });
    forceDue(schedId);

    let calls = 0;
    const r = await runIngestDrainCycle({ db: null }, {
      readers: {
        gmail: async (_db, userId, connection, schedule) => {
          calls++;
          assert.equal(userId, USER);
          assert.equal(connection.id, connId);
          assert.equal(schedule.id, schedId);
          return {
            ok: true, scanned: 3, extracted: 2,
            records: [{ id: "m1" }, { id: "m2" }],
            cursorField: "internalDate", newCursor: 1_700_000_000_000,
          };
        },
      },
    });
    assert.equal(r.ok, true);
    assert.equal(r.drained, 1);
    assert.equal(r.skipped, 0);
    assert.equal(r.errored, 0);
    assert.equal(calls, 1);

    const state = getIngestState();
    const sched = userMap(state.schedules, USER).get(schedId);
    assert.equal(sched.lastDrainStatus, "drained");
    assert.equal(sched.lastDrainReason, null);
    assert.equal(sched.lastDrainRecordCount, 2);
    assert.ok(sched.nextRunAt > Date.now(), "cadence must advance past now");
    assert.equal(sched.runCount, 1);

    const conn = userMap(state.connections, USER).get(connId);
    assert.equal(conn.cursor, 1_700_000_000_000);
    assert.ok(conn.lastSyncAt);

    // The drain wrote a real sync-run log entry, visible through the same
    // macro a manual run would populate.
    const runs = call("listSyncRuns", ctx, {});
    assert.equal(runs.result.count, 1);
    assert.equal(runs.result.runs[0].mode, "scheduled");
    assert.equal(runs.result.runs[0].recordsLoaded, 2);
    assert.equal(runs.result.runs[0].newCursor, 1_700_000_000_000);
  });

  it("a second drain only advances the cursor further (real incremental behavior)", async () => {
    const connId = makeConnection("gmail", GMAIL_CONFIG);
    configureConnection(connId);
    const schedId = makeSchedule(connId, { mode: "incremental" });
    forceDue(schedId);

    let cursorSeen = null;
    await runIngestDrainCycle({ db: null }, {
      readers: {
        gmail: async () => ({
          ok: true, scanned: 1, extracted: 1, records: [{ id: "m1" }],
          cursorField: "internalDate", newCursor: 100,
        }),
      },
    });
    forceDue(schedId);
    await runIngestDrainCycle({ db: null }, {
      readers: {
        gmail: async (_db, _userId, connection) => {
          cursorSeen = connection.cursor;
          return {
            ok: true, scanned: 1, extracted: 1, records: [{ id: "m2" }],
            cursorField: "internalDate", newCursor: 200,
          };
        },
      },
    });
    assert.equal(cursorSeen, 100, "the reader must see the cursor the first drain advanced to");
    const state = getIngestState();
    assert.equal(userMap(state.connections, USER).get(connId).cursor, 200);
    assert.equal(call("listSyncRuns", ctx, {}).result.count, 2);
  });
});

describe("runIngestDrainCycle — unsupported / gated sources are honestly skipped", () => {
  it("skips a postgres-backed schedule with the credential-driver-gated reason, never drains it", async () => {
    const connId = makeConnection("postgres", {
      host: "h", port: 5432, database: "d", username: "u", password: "p", table: "t",
    });
    const schedId = makeSchedule(connId);
    forceDue(schedId);

    const r = await runIngestDrainCycle({ db: null });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, 1);
    assert.equal(r.drained, 0);

    const state = getIngestState();
    const sched = userMap(state.schedules, USER).get(schedId);
    assert.equal(sched.lastDrainStatus, "skipped");
    assert.equal(sched.lastDrainReason, "gated_credential_driver_required:postgres");
    // The connection's cursor must be untouched — nothing was actually pulled.
    assert.equal(userMap(state.connections, USER).get(connId).cursor, null);
  });

  it("skips an s3-backed schedule with the same gated reason", async () => {
    const connId = makeConnection("s3", {
      bucket: "b", region: "us-east-1", accessKeyId: "k", secretAccessKey: "s", format: "csv",
    });
    const schedId = makeSchedule(connId);
    forceDue(schedId);
    const r = await runIngestDrainCycle({ db: null });
    assert.equal(r.skipped, 1);
    const sched = userMap(getIngestState().schedules, USER).get(schedId);
    assert.equal(sched.lastDrainReason, "gated_credential_driver_required:s3");
  });

  it("skips an api-key connector (stripe) with an unsupported-auth-model reason, not the DB/S3 reason", async () => {
    const connId = makeConnection("stripe", { apiKey: "sk_test", resource: "charges" });
    const schedId = makeSchedule(connId);
    forceDue(schedId);
    const r = await runIngestDrainCycle({ db: null });
    assert.equal(r.skipped, 1);
    const sched = userMap(getIngestState().schedules, USER).get(schedId);
    assert.equal(sched.lastDrainReason, "unsupported_auth_model:api-key:stripe");
  });

  it("skips a schedule whose OAuth handshake never completed", async () => {
    const connId = makeConnection("github", { owner: "o", repo: "r", stream: "issues" });
    // Deliberately do NOT call configureConnection() — status stays 'pending_oauth'.
    const schedId = makeSchedule(connId);
    forceDue(schedId);
    const r = await runIngestDrainCycle({ db: null }, {
      readers: { github: async () => { throw new Error("must not be called — oauth incomplete"); } },
    });
    assert.equal(r.skipped, 1);
    const sched = userMap(getIngestState().schedules, USER).get(schedId);
    assert.equal(sched.lastDrainReason, "oauth_not_completed");
  });
});

describe("runIngestDrainCycle — push-driven (webhook) sources are never polled", () => {
  it("reports the real received-count since last check instead of fabricating a pull", async () => {
    // No catalog connector declares auth:'webhook' today (webhook push is a
    // separate, connection-less substrate in ingest.js) — register a
    // temporary catalog entry so the honest push-path branch is exercised
    // directly rather than left as untested dead code.
    CATALOG_BY_ID.set("test-webhook-src", { id: "test-webhook-src", auth: "webhook", category: "push" });
    try {
      call("getWebhookEndpoint", ctx, {});
      const push = call("pushRecord", ctx, { records: [{ event: "a" }, { event: "b" }], source: "test" });
      assert.equal(push.ok, true);

      const state = getIngestState();
      const connId = "conn_webhook_test";
      userMap(state.connections, USER).set(connId, {
        id: connId, connectorId: "test-webhook-src", connectorName: "Test Webhook",
        status: "configured", incremental: false, config: {}, createdAt: Date.now(), lastSyncAt: null, cursor: null,
      });
      const schedId = "sched_webhook_test";
      userMap(state.schedules, USER).set(schedId, {
        id: schedId, connectionId: connId, connectorName: "Test Webhook",
        cadence: "hourly", intervalMs: 60 * 60 * 1000, mode: "incremental",
        enabled: true, createdAt: Date.now() - 10_000, lastRunAt: Date.now() - 5_000,
        nextRunAt: Date.now() - 1000, runCount: 0,
      });

      const r = await runIngestDrainCycle({ db: null }, {
        readers: { gmail: async () => { throw new Error("must not be called for a push source"); } },
      });
      assert.equal(r.ok, true);
      assert.equal(r.pushed, 1);
      assert.equal(r.drained, 0);

      const sched = userMap(state.schedules, USER).get(schedId);
      assert.equal(sched.lastDrainStatus, "push_reviewed");
      assert.equal(sched.lastDrainReason, null);
      assert.equal(sched.lastDrainRecordCount, 2);
    } finally {
      CATALOG_BY_ID.delete("test-webhook-src");
    }
  });
});
