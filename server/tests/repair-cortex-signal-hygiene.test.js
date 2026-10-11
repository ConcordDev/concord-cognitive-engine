/**
 * Repair-cortex signal hygiene:
 *   (g) startGuardian is idempotent — a second call does not arm a second guardian.
 *   (g) recordOperation dedupes across ISO and SQLite timestamp formats.
 *   (h) a governor tick skips unregistered queue/ingest/jobs/crawl/system.synth
 *       macros without observe(), and logs each absence once.
 *
 * Run: node --test tests/repair-cortex-signal-hygiene.test.js
 */

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import {
  startGuardian,
  stopGuardian,
  getRecentRepairDTUs,
} from "../emergent/repair-cortex.js";
import { recordOperation } from "../lib/dtu-operations-log.js";
import {
  logAbsentGovernorMacrosOnce,
  tickGovernorOptionalMacros,
} from "../lib/governor-optional-macros.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_SRC = readFileSync(path.join(HERE, "../server.js"), "utf8");

function openOpsDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE dtu_operations_log (
      id          TEXT PRIMARY KEY,
      ts          TEXT NOT NULL DEFAULT (datetime('now')),
      subsystem   TEXT NOT NULL,
      phase       TEXT,
      action      TEXT NOT NULL,
      severity    TEXT NOT NULL DEFAULT 'info'
                    CHECK (severity IN ('info','warn','error','critical')),
      details     TEXT NOT NULL DEFAULT '{}',
      meta        TEXT NOT NULL DEFAULT '{}',
      archived    INTEGER NOT NULL DEFAULT 0
    );
  `);
  return db;
}

const ENTRY = {
  subsystem: "repair_cortex",
  action: "recurring_error",
  details: { fingerprint: "goal_heartbeat_slice" },
};

function startedCount() {
  const recent = getRecentRepairDTUs(50);
  return (recent.dtus || []).filter((d) => d.action === "guardian_started").length;
}

/** MACROS shape of the live server: queue is not a macro domain; the others have no tick/synth. */
function liveMacroMap() {
  const macros = new Map();
  for (const [domain, names] of [
    ["jobs", ["enqueue", "get"]],
    ["ingest", ["url", "queue", "processQueueOnce"]],
    ["crawl", ["enqueue", "fetch"]],
    ["system", ["synthesize", "autogen", "dream", "evolution"]],
  ]) {
    const bucket = new Map();
    for (const name of names) bucket.set(name, { fn() {} });
    macros.set(domain, bucket);
  }
  return macros;
}

describe("startGuardian idempotency", () => {
  after(() => {
    stopGuardian();
  });

  it("a second startGuardian() is a no-op and does not log a second guardian", () => {
    const before = startedCount();
    const first = startGuardian();
    const second = startGuardian();
    assert.equal(first.ok, true);
    assert.notEqual(first.status, "already_running");
    assert.equal(second.ok, true);
    assert.equal(second.status, "already_running");
    assert.equal(startedCount() - before, 1, "exactly one guardian_started audit row");

    stopGuardian();
    const third = startGuardian();
    assert.equal(third.ok, true);
    assert.notEqual(third.status, "already_running", "stop clears the guard so a later start works");
    assert.equal(startedCount() - before, 2);
  });

  it("server.js does not call startGuardian(); the repair loop is the boot owner", () => {
    assert.doesNotMatch(SERVER_SRC, /^\s*startGuardian\(\);/m);
    const cortex = readFileSync(path.join(HERE, "../emergent/repair-cortex.js"), "utf8");
    const boot = cortex.slice(cortex.indexOf("export function startRepairLoop("), cortex.indexOf("export function stopRepairLoop("));
    assert.match(boot, /startGuardian\(\)/);
  });
});

describe("recordOperation timestamp dedupe", () => {
  it("coalesces a row whose ts is SQLite datetime('now')", () => {
    const db = openOpsDb();
    try {
      const first = recordOperation(db, ENTRY);
      assert.equal(first.coalesced, false);
      const stored = db.prepare("SELECT ts FROM dtu_operations_log WHERE id = ?").get(first.id);
      assert.match(stored.ts, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      const second = recordOperation(db, ENTRY);
      assert.equal(second.coalesced, true);
      assert.equal(second.id, first.id);
      assert.equal(second.count, 2);
      const n = db.prepare("SELECT COUNT(*) AS n FROM dtu_operations_log").get().n;
      assert.equal(n, 1);
    } finally {
      db.close();
    }
  });

  it("coalesces a row whose ts is ISO with T/Z", () => {
    const db = openOpsDb();
    try {
      const first = recordOperation(db, ENTRY);
      db.prepare("UPDATE dtu_operations_log SET ts = ? WHERE id = ?").run(new Date().toISOString(), first.id);
      const stored = db.prepare("SELECT ts FROM dtu_operations_log WHERE id = ?").get(first.id);
      assert.match(stored.ts, /T/);
      assert.match(stored.ts, /Z$/);
      const second = recordOperation(db, ENTRY);
      assert.equal(second.coalesced, true);
      assert.equal(second.id, first.id);
      assert.ok(second.count >= 2);
    } finally {
      db.close();
    }
  });

  it("does not coalesce a row outside the window in either format", () => {
    const db = openOpsDb();
    try {
      const first = recordOperation(db, ENTRY);
      const oldIso = new Date(Date.now() - 5 * 60_000).toISOString();
      db.prepare("UPDATE dtu_operations_log SET ts = ? WHERE id = ?").run(oldIso, first.id);
      const afterIso = recordOperation(db, ENTRY);
      assert.equal(afterIso.coalesced, false);
      assert.notEqual(afterIso.id, first.id);

      const oldSql = oldIso.slice(0, 19).replace("T", " ");
      db.prepare("UPDATE dtu_operations_log SET ts = ? WHERE id = ?").run(oldSql, afterIso.id);
      const afterSql = recordOperation(db, ENTRY);
      assert.equal(afterSql.coalesced, false);
      assert.notEqual(afterSql.id, afterIso.id);
    } finally {
      db.close();
    }
  });
});

describe("governor optional-macro tick", () => {
  it("logs queue, ingest.tick, jobs.tick, crawl.tick, and system.synth once", () => {
    const macros = liveMacroMap();
    const seen = new Set();
    const logs = [];
    const log = (level, event, data) => logs.push({ level, event, data });
    const first = logAbsentGovernorMacrosOnce(macros, log, seen);
    const second = logAbsentGovernorMacrosOnce(macros, log, seen);
    assert.deepEqual(first.sort(), ["crawl.tick", "ingest.tick", "jobs.tick", "queue", "system.synth"]);
    assert.deepEqual(second, []);
    assert.equal(logs.length, 5);
    assert.ok(logs.every((l) => l.event === "governor_optional_macro_absent" && l.level === "info"));
  });

  it("two ticks with those macros absent produce no observe events", async () => {
    const macros = liveMacroMap();
    const observed = [];
    const calls = [];
    const run = async (domain, name) => { calls.push(`${domain}.${name}`); };
    const opts = {
      macros,
      runMacro: run,
      observe: (err, tag) => observed.push({ tag, message: String(err?.message || err) }),
      input: { override: true, reason: "heartbeat" },
      ctx: {},
      synthEnabled: true,
    };
    await tickGovernorOptionalMacros(opts);
    await tickGovernorOptionalMacros(opts);
    assert.deepEqual(observed, []);
    assert.deepEqual(calls, []);
  });

  it("still observes a throw from a macro that is registered", async () => {
    const macros = liveMacroMap();
    macros.get("jobs").set("tick", { fn() {} });
    const observed = [];
    await tickGovernorOptionalMacros({
      macros,
      runMacro: async (domain, name) => {
        if (domain === "jobs" && name === "tick") throw new Error("real boom");
      },
      observe: (err, tag) => observed.push({ tag, message: err.message }),
      input: {},
      ctx: {},
      synthEnabled: true,
    });
    assert.deepEqual(observed, [{ tag: "governor_jobs_tick", message: "real boom" }]);
  });

  it("include runs only the named domains (governor low-memory split)", async () => {
    const macros = liveMacroMap();
    macros.get("jobs").set("tick", { fn() {} });
    macros.get("ingest").set("tick", { fn() {} });
    macros.get("crawl").set("tick", { fn() {} });
    macros.get("system").set("synth", { fn() {} });
    macros.set("queue", new Map([["tick", { fn() {} }]]));
    const calls = [];
    const base = {
      macros,
      runMacro: async (domain, name) => { calls.push(`${domain}.${name}`); },
      observe: () => {},
      input: {},
      ctx: {},
    };
    await tickGovernorOptionalMacros({ ...base, synthEnabled: false, include: ["jobs", "queue", "system"] });
    assert.deepEqual(calls, ["jobs.tick", "queue.tick"]);
    calls.length = 0;
    await tickGovernorOptionalMacros({ ...base, synthEnabled: true, include: ["jobs", "queue", "system"] });
    assert.deepEqual(calls, ["jobs.tick", "queue.tick", "system.synth"]);
    calls.length = 0;
    await tickGovernorOptionalMacros({ ...base, include: ["ingest", "crawl"] });
    assert.deepEqual(calls, ["ingest.tick", "crawl.tick"]);
  });

  it("governorTick delegates to the optional-macro tick and does not call the missing macros", () => {
    const start = SERVER_SRC.indexOf("async function governorTick(");
    const end = SERVER_SRC.indexOf("function _startGovernorHeartbeat()");
    const body = SERVER_SRC.slice(start, end);
    assert.match(body, /tickGovernorOptionalMacros\(/);
    assert.doesNotMatch(body, /runMacro\(\s*"jobs"\s*,\s*"tick"/);
    assert.doesNotMatch(body, /runMacro\(\s*"queue"\s*,\s*"tick"/);
    assert.doesNotMatch(body, /runMacro\(\s*"ingest"\s*,\s*"tick"/);
    assert.doesNotMatch(body, /runMacro\(\s*"crawl"\s*,\s*"tick"/);
    assert.doesNotMatch(body, /runMacro\(\s*"system"\s*,\s*"synth"/);
    const boot = SERVER_SRC.slice(end, end + 1500);
    assert.match(boot, /logAbsentGovernorMacrosOnce\(/);
  });
});
