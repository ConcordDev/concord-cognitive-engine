// Tier-2 contract tests for the export lens parity macros — the seven
// backlog features: scheduled-export execution, cloud destinations,
// PDF generation, incremental/delta exports, history log + re-download,
// encrypted archives, and selective field-level export.
// Pins per-user scoping and the load-bearing behaviour of each macro.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerExportActions from "../domains/exportdomain.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`export.${name}`);
  if (!fn) throw new Error(`export.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => {
  registerExportActions(register);
});

beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

describe("export — scheduled-export execution", () => {
  it("schedule-create persists a schedule with a computed nextRun", () => {
    const r = call("schedule-create", ctxA, { name: "Weekly backup", frequency: "weekly", format: "json" });
    assert.equal(r.ok, true);
    assert.equal(r.result.schedule.frequency, "weekly");
    assert.ok(r.result.schedule.nextRun);
    assert.equal(r.result.schedule.runCount, 0);
  });

  it("schedule-create rejects an invalid frequency", () => {
    const r = call("schedule-create", ctxA, { frequency: "hourly" });
    assert.equal(r.ok, false);
    assert.match(r.error, /frequency must be/);
  });

  it("schedule-run-due executes a due schedule and advances nextRun", () => {
    const c = call("schedule-create", ctxA, { name: "Daily", frequency: "daily", format: "json" });
    const id = c.result.schedule.id;
    // Force the schedule due by backdating nextRun.
    const sched = globalThis._concordSTATE.exportLens.schedules.get("user_a").find((s) => s.id === id);
    sched.nextRun = new Date(Date.now() - 1000).toISOString();
    const run = call("schedule-run-due", ctxA, { itemCounts: { [id]: 7 }, byteLengths: { [id]: 1400 } });
    assert.equal(run.ok, true);
    assert.equal(run.result.executedCount, 1);
    assert.equal(run.result.executed[0].itemCount, 7);
    assert.equal(run.result.executed[0].trigger, "scheduled");
    assert.ok(new Date(sched.nextRun).getTime() > Date.now());
  });

  it("schedule-run-due skips disabled schedules", () => {
    const c = call("schedule-create", ctxA, { frequency: "daily" });
    const id = c.result.schedule.id;
    call("schedule-toggle", ctxA, { id });
    const sched = globalThis._concordSTATE.exportLens.schedules.get("user_a").find((s) => s.id === id);
    sched.nextRun = new Date(Date.now() - 1000).toISOString();
    const run = call("schedule-run-due", ctxA, {});
    assert.equal(run.result.executedCount, 0);
  });

  it("schedule-delete removes a schedule", () => {
    const c = call("schedule-create", ctxA, { frequency: "monthly" });
    const r = call("schedule-delete", ctxA, { id: c.result.schedule.id });
    assert.equal(r.ok, true);
    assert.equal(call("schedule-list", ctxA).result.count, 0);
  });

  it("INVARIANT: schedules are scoped per-user", () => {
    call("schedule-create", ctxA, { frequency: "daily" });
    assert.equal(call("schedule-list", ctxB).result.count, 0);
  });
});

describe("export — cloud destinations via OAuth", () => {
  it("cloud-connect stores a connection and a token fingerprint only", () => {
    const r = call("cloud-connect", ctxA, { provider: "google_drive", accountLabel: "work drive", accessToken: "ya29.secret-token" });
    assert.equal(r.ok, true);
    assert.equal(r.result.connection.provider, "google_drive");
    assert.ok(r.result.connection.tokenFingerprint);
    assert.equal(r.result.connection._token, undefined, "raw token must not be serialised");
  });

  it("cloud-connect rejects an unknown provider", () => {
    const r = call("cloud-connect", ctxA, { provider: "myspace", accountLabel: "x", accessToken: "t" });
    assert.equal(r.ok, false);
    assert.match(r.error, /provider must be/);
  });

  it("cloud-connect requires an access token", () => {
    const r = call("cloud-connect", ctxA, { provider: "dropbox", accountLabel: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /accessToken/);
  });

  it("delivery-push increments the connection delivery counter", () => {
    const c = call("cloud-connect", ctxA, { provider: "s3", accountLabel: "bucket", accessToken: "tok" });
    const r = call("delivery-push", ctxA, { connectionId: c.result.connection.id, filename: "export.json", byteLength: 2048 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalDeliveries, 1);
    assert.equal(call("cloud-list", ctxA).result.connections[0].deliveries, 1);
  });

  it("cloud-disconnect removes a connection", () => {
    const c = call("cloud-connect", ctxA, { provider: "onedrive", accountLabel: "x", accessToken: "t" });
    call("cloud-disconnect", ctxA, { id: c.result.connection.id });
    assert.equal(call("cloud-list", ctxA).result.count, 0);
  });

  it("INVARIANT: cloud connections are scoped per-user", () => {
    call("cloud-connect", ctxA, { provider: "dropbox", accountLabel: "a", accessToken: "t" });
    assert.equal(call("cloud-list", ctxB).result.count, 0);
  });
});

describe("export — PDF generation", () => {
  it("pdf-generate emits a valid base64 PDF for real records", () => {
    const records = [{ id: "d1", title: "Note one" }, { id: "d2", title: "Note two" }];
    const r = call("pdf-generate", ctxA, { title: "My Export", records });
    assert.equal(r.ok, true);
    assert.equal(r.result.mimeType, "application/pdf");
    assert.equal(r.result.recordCount, 2);
    const decoded = Buffer.from(r.result.base64, "base64").toString("latin1");
    assert.match(decoded, /^%PDF-1\.4/);
    assert.match(decoded, /%%EOF$/);
  });

  it("pdf-generate handles an empty record set", () => {
    const r = call("pdf-generate", ctxA, { title: "Empty", records: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.recordCount, 0);
  });
});

describe("export — incremental / delta exports", () => {
  it("incremental-pull returns everything on the first run", () => {
    const records = [
      { id: "a", updatedAt: "2026-05-01T00:00:00Z" },
      { id: "b", updatedAt: "2026-05-02T00:00:00Z" },
    ];
    const r = call("incremental-pull", ctxA, { dataSource: "dtus", records, commit: true });
    assert.equal(r.ok, true);
    assert.equal(r.result.isFirstRun, true);
    assert.equal(r.result.changedRecords, 2);
    assert.ok(r.result.newCursor);
  });

  it("incremental-pull returns only records changed since the cursor", () => {
    const first = [{ id: "a", updatedAt: "2026-05-01T00:00:00Z" }];
    call("incremental-pull", ctxA, { dataSource: "dtus", records: first, commit: true });
    const second = [
      { id: "a", updatedAt: "2026-05-01T00:00:00Z" },
      { id: "b", updatedAt: "2026-05-10T00:00:00Z" },
    ];
    const r = call("incremental-pull", ctxA, { dataSource: "dtus", records: second, commit: true });
    assert.equal(r.result.changedRecords, 1);
    assert.equal(r.result.records[0].id, "b");
    assert.equal(r.result.unchangedRecords, 1);
  });

  it("incremental-pull with commit:false leaves the cursor unchanged", () => {
    const records = [{ id: "a", updatedAt: "2026-05-01T00:00:00Z" }];
    call("incremental-pull", ctxA, { dataSource: "dtus", records, commit: false });
    assert.equal(call("cursor-list", ctxA).result.count, 0);
  });

  it("cursor-reset clears a cursor", () => {
    call("incremental-pull", ctxA, { dataSource: "dtus", records: [{ id: "a", updatedAt: "2026-05-01T00:00:00Z" }], commit: true });
    call("cursor-reset", ctxA, { dataSource: "dtus" });
    assert.equal(call("cursor-list", ctxA).result.count, 0);
  });

  it("INVARIANT: cursors are scoped per-user", () => {
    call("incremental-pull", ctxA, { dataSource: "dtus", records: [{ id: "a", updatedAt: "2026-05-01T00:00:00Z" }], commit: true });
    assert.equal(call("cursor-list", ctxB).result.count, 0);
  });
});

describe("export — history log + re-download", () => {
  it("record-run stores a run and history-list returns it", () => {
    call("record-run", ctxA, { format: "json", itemCount: 5, byteLength: 1000, dataSources: ["dtus"], filename: "x.json" });
    const r = call("history-list", ctxA, {});
    assert.equal(r.result.totalRuns, 1);
    assert.equal(r.result.runs[0].itemCount, 5);
    assert.equal(r.result.totalBytesExported, 1000);
  });

  it("history-download returns a retained payload", () => {
    const rec = call("record-run", ctxA, { format: "json", itemCount: 1, byteLength: 12, dataSources: ["dtus"], filename: "y.json", payload: '{"ok":true}' });
    const r = call("history-download", ctxA, { id: rec.result.run.id });
    assert.equal(r.ok, true);
    assert.equal(r.result.payload, '{"ok":true}');
  });

  it("history-download errors when no payload was retained", () => {
    const rec = call("record-run", ctxA, { format: "json", itemCount: 1, byteLength: 0, dataSources: ["dtus"] });
    const r = call("history-download", ctxA, { id: rec.result.run.id });
    assert.equal(r.ok, false);
    assert.match(r.error, /payload not retained/);
  });

  it("history-clear empties the log", () => {
    call("record-run", ctxA, { format: "csv", itemCount: 2, byteLength: 50, dataSources: ["events"] });
    call("history-clear", ctxA, {});
    assert.equal(call("history-list", ctxA, {}).result.totalRuns, 0);
  });

  it("INVARIANT: history is scoped per-user", () => {
    call("record-run", ctxA, { format: "json", itemCount: 1, byteLength: 10, dataSources: ["dtus"] });
    assert.equal(call("history-list", ctxB, {}).result.totalRuns, 0);
  });
});

describe("export — encrypted / password-protected archive", () => {
  it("encrypt-archive then decrypt-archive round-trips the payload", () => {
    const payload = JSON.stringify({ dtus: [{ id: "d1", title: "Secret note" }] });
    const enc = call("encrypt-archive", ctxA, { password: "hunter2", payload });
    assert.equal(enc.ok, true);
    assert.equal(enc.result.algorithm, "concord-xor-fnv/v1");
    const dec = call("decrypt-archive", ctxA, {
      password: "hunter2",
      salt: enc.result.salt,
      ciphertextBase64: enc.result.ciphertextBase64,
      expectedChecksum: enc.result.plainChecksum,
    });
    assert.equal(dec.ok, true);
    assert.equal(dec.result.verified, true);
    assert.equal(dec.result.plaintext, payload);
  });

  it("decrypt-archive with the wrong password fails the checksum", () => {
    const enc = call("encrypt-archive", ctxA, { password: "correct", payload: "data" });
    const dec = call("decrypt-archive", ctxA, {
      password: "wrong",
      salt: enc.result.salt,
      ciphertextBase64: enc.result.ciphertextBase64,
      expectedChecksum: enc.result.plainChecksum,
    });
    assert.equal(dec.result.verified, false);
  });

  it("encrypt-archive rejects a too-short password", () => {
    const r = call("encrypt-archive", ctxA, { password: "ab", payload: "x" });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least 4/);
  });
});

describe("export — selective field-level export", () => {
  it("field-schema reports available fields and coverage", () => {
    const records = [
      { id: "a", title: "One", tier: "regular" },
      { id: "b", title: "Two" },
    ];
    const r = call("field-schema", ctxA, { dataSource: "dtus", records });
    assert.equal(r.ok, true);
    const id = r.result.fields.find((f) => f.name === "id");
    assert.equal(id.coverage, 100);
    const tier = r.result.fields.find((f) => f.name === "tier");
    assert.equal(tier.coverage, 50);
  });

  it("field-project narrows records to the chosen fields", () => {
    const records = [{ id: "a", title: "One", tier: "regular", tags: ["x"] }];
    const r = call("field-project", ctxA, { records, fields: ["id", "title"] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.result.records[0], { id: "a", title: "One" });
    assert.ok(r.result.droppedFields.includes("tier"));
  });

  it("field-project requires at least one field", () => {
    const r = call("field-project", ctxA, { records: [{ id: "a" }], fields: [] });
    assert.equal(r.ok, false);
    assert.match(r.error, /at least one field/);
  });
});

describe("export — legacy stateless macros still register", () => {
  it("generatePackage estimates package size and mime", () => {
    const fn = ACTIONS.get("export.generatePackage");
    const r = fn(ctxA, { data: { items: [{ id: "1" }, { id: "2" }], format: "json" } }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.itemCount, 2);
    assert.equal(r.result.mimeType, "application/json");
  });

  it("diffExport computes added/removed/modified", () => {
    const fn = ACTIONS.get("export.diffExport");
    const r = fn(ctxA, { data: { current: [{ id: "a" }, { id: "b" }], previous: [{ id: "a" }] } }, {});
    assert.equal(r.result.added, 1);
    assert.equal(r.result.modified, 1);
  });
});

describe("export — STATE unavailable path", () => {
  it("returns an error shape when STATE is missing", () => {
    globalThis._concordSTATE = undefined;
    const r = call("schedule-list", ctxA);
    assert.equal(r.ok, false);
    assert.match(r.error, /STATE unavailable/);
  });
});
