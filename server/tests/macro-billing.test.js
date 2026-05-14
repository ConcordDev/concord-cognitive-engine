/**
 * Tier-2 contract tests for DX Platform Phase A1 — per-call macro billing.
 *
 * Pinned:
 *   - migration 141 applies (macro_call_log + user_macro_quota)
 *   - recordMacroCall logs every call (free-tier + plugin)
 *   - chargeMacroCall is no-op on free-tier (no api_key_id) or zero-cost macros
 *   - chargeMacroCall is idempotent on ref_id collision (UNIQUE)
 *   - billing hook never throws (chaos test)
 *   - feature-flags falsy/truthy parsing
 *
 * Run: node --test tests/macro-billing.test.js
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import * as mig002 from "../migrations/002_economy_tables.js";
import * as mig004 from "../migrations/004_ledger_idempotency.js";
import * as mig017 from "../migrations/017_api_billing.js";
import * as mig145 from "../migrations/145_macro_call_billing.js";
import {
  recordMacroCall,
  chargeMacroCall,
  billMacroCall,
  costForMacro,
  categoryForMacro,
} from "../lib/macro-billing.js";
import { getFlag, getFlagNumber } from "../lib/feature-flags.js";

let db;

beforeEach(() => {
  db = new Database(":memory:");
  mig002.up(db);
  mig004.up(db);
  mig017.up(db); // api_monthly_usage — the monthly free-allowance counter
  mig145.up(db);
});

afterEach(() => {
  try { db?.close(); } catch { /* intentional */ }
  delete process.env.FF_MACRO_BILLING;
});

describe("migration 141 — macro_call_billing", () => {
  it("creates macro_call_log with the expected columns", () => {
    const cols = db.prepare("PRAGMA table_info(macro_call_log)").all().map(c => c.name);
    for (const k of ["id", "user_id", "api_key_id", "domain", "macro_name", "cost_units", "duration_ms", "status", "cascade_payment_id", "ref_id", "ts"]) {
      assert.ok(cols.includes(k), `macro_call_log missing column ${k}`);
    }
  });

  it("creates user_macro_quota with composite PK", () => {
    const cols = db.prepare("PRAGMA table_info(user_macro_quota)").all();
    const pkCols = cols.filter(c => c.pk > 0).map(c => c.name);
    assert.ok(pkCols.includes("user_id"));
    assert.ok(pkCols.includes("domain"));
    assert.ok(pkCols.includes("macro_name"));
    assert.ok(pkCols.includes("window_start"));
  });

  it("status CHECK constraint rejects unknown values", () => {
    assert.throws(() => {
      db.prepare(`INSERT INTO macro_call_log (domain, macro_name, status) VALUES ('x', 'y', 'invalid_status')`).run();
    }, /CHECK/);
  });
});

describe("recordMacroCall", () => {
  it("writes a row for a free-tier (no api_key_id) call", () => {
    const r = recordMacroCall(db, {
      userId: "user_alice",
      apiKeyId: null,
      domain: "detectors",
      name: "run",
      durationMs: 42,
      status: "ok",
      costUnits: 5,
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM macro_call_log WHERE user_id = ?`).get("user_alice");
    assert.ok(row);
    assert.equal(row.api_key_id, null);
    assert.equal(row.domain, "detectors");
    assert.equal(row.macro_name, "run");
    assert.equal(row.cost_units, 5);
    assert.equal(row.status, "ok");
  });

  it("writes a row for a plugin (api_key_id set) call", () => {
    const r = recordMacroCall(db, {
      userId: "user_alice",
      apiKeyId: "csk_test_123",
      domain: "repair",
      name: "runProphet",
      durationMs: 1500,
      status: "ok",
      costUnits: 20,
    });
    assert.equal(r.ok, true);
    const row = db.prepare(`SELECT * FROM macro_call_log WHERE api_key_id = ?`).get("csk_test_123");
    assert.ok(row);
    assert.equal(row.cost_units, 20);
  });

  it("INSERT OR IGNORE on ref_id UNIQUE collision (idempotent)", () => {
    const ctx = {
      userId: "u", apiKeyId: "csk_x", domain: "d", name: "m",
      durationMs: 1, status: "ok", costUnits: 1, refId: "ref_dup",
    };
    const r1 = recordMacroCall(db, ctx);
    const r2 = recordMacroCall(db, ctx);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    const rows = db.prepare(`SELECT * FROM macro_call_log WHERE ref_id = ?`).all("ref_dup");
    assert.equal(rows.length, 1);
  });

  it("returns ok:false on invalid args (no domain)", () => {
    const r = recordMacroCall(db, { userId: "u", name: "m", apiKeyId: "k", durationMs: 1, status: "ok" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "invalid_args");
  });

  it("never throws — wraps SQLite errors as ok:false", () => {
    // Force a real SQLite throw by closing the DB before calling.
    db.close();
    const r = recordMacroCall(db, {
      userId: "u", apiKeyId: "k", domain: "d", name: "m",
      durationMs: 1, status: "ok", costUnits: 1,
    });
    assert.equal(r.ok, false);
    // Re-open for subsequent tests in this suite (afterEach will close again).
    db = new Database(":memory:");
    mig002.up(db);
    mig004.up(db);
    mig017.up(db);
    mig145.up(db);
  });

  it("respects FF_MACRO_BILLING=0 — no-op", () => {
    process.env.FF_MACRO_BILLING = "0";
    const r = recordMacroCall(db, {
      userId: "u", apiKeyId: "k", domain: "d", name: "m",
      durationMs: 1, status: "ok", costUnits: 1,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "billing_disabled");
    const rows = db.prepare(`SELECT * FROM macro_call_log`).all();
    assert.equal(rows.length, 0);
  });
});

describe("chargeMacroCall", () => {
  it("no-op for free-tier (no api_key_id)", () => {
    const r = chargeMacroCall(db, {
      userId: "alice", apiKeyId: null, domain: "detectors", name: "run", costUnits: 5, refId: "ref_a",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "free_tier");
    const rows = db.prepare(`SELECT * FROM economy_ledger`).all();
    assert.equal(rows.length, 0);
  });

  it("no-op for zero-cost macros", () => {
    const r = chargeMacroCall(db, {
      userId: "alice", apiKeyId: "csk_x", domain: "billing", name: "balance", costUnits: 0, refId: "ref_b",
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "zero_cost");
  });

  it("writes a FEE entry to economy_ledger for plugin call", () => {
    const r = chargeMacroCall(db, {
      userId: "alice", apiKeyId: "csk_x", domain: "detectors", name: "run", costUnits: 5, refId: "ref_c",
    });
    assert.equal(r.ok, true);
    assert.equal(r.charged, 5);
    const rows = db.prepare(`SELECT * FROM economy_ledger WHERE ref_id = ?`).all("ref_c");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "FEE");
    assert.equal(rows[0].from_user_id, "alice");
    assert.equal(rows[0].to_user_id, "__platform_macro_revenue");
    assert.equal(rows[0].amount, 5);
    assert.equal(rows[0].net, 5);
  });

  it("idempotent on ref_id (second call returns already_charged)", () => {
    const ctx = {
      userId: "alice", apiKeyId: "csk_x", domain: "detectors", name: "run", costUnits: 5, refId: "ref_d",
    };
    const r1 = chargeMacroCall(db, ctx);
    const r2 = chargeMacroCall(db, ctx);
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true);
    assert.equal(r2.reason, "already_charged");
    const rows = db.prepare(`SELECT * FROM economy_ledger WHERE ref_id = ?`).all("ref_d");
    assert.equal(rows.length, 1);
  });

  it("returns ok:false when refId is missing", () => {
    const r = chargeMacroCall(db, {
      userId: "alice", apiKeyId: "csk_x", domain: "detectors", name: "run", costUnits: 5,
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_ref_id");
  });
});

describe("billMacroCall — combined log + charge", () => {
  it("logs + charges a plugin call atomically (no throw)", () => {
    // detectors:run is compute-tier ($0.005). Exhaust this user's
    // monthly free compute allowance first so the call actually charges.
    const month = new Date().toISOString().slice(0, 7);
    db.prepare("INSERT INTO api_monthly_usage (user_id, month, computes) VALUES (?, ?, 100000)")
      .run("alice", month);
    const r = billMacroCall(db, {
      userId: "alice", apiKeyId: "csk_x", domain: "detectors", name: "run",
      durationMs: 100, status: "ok", refId: "ref_combined_1",
    });
    assert.equal(r.recorded.ok, true);
    assert.equal(r.category, "compute");
    assert.equal(r.charged.ok, true);
    assert.equal(r.charged.charged, 0.005);
    const log = db.prepare(`SELECT * FROM macro_call_log WHERE ref_id = ?`).get("ref_combined_1");
    const led = db.prepare(`SELECT * FROM economy_ledger WHERE ref_id = ?`).get("ref_combined_1");
    assert.ok(log);
    assert.ok(led);
  });

  it("first compute call of the month is free (monthly allowance)", () => {
    const r = billMacroCall(db, {
      userId: "fresh_dev", apiKeyId: "csk_y", domain: "detectors", name: "run",
      durationMs: 100, status: "ok", refId: "ref_free_allowance",
    });
    assert.equal(r.recorded.ok, true);
    assert.equal(r.freeAllowanceUsed, true);
    assert.equal(r.charged.ok, false);
    assert.equal(r.charged.reason, "zero_cost");
    // allowance counter advanced
    const month = new Date().toISOString().slice(0, 7);
    const usage = db.prepare("SELECT computes FROM api_monthly_usage WHERE user_id = ? AND month = ?")
      .get("fresh_dev", month);
    assert.equal(usage.computes, 1);
  });

  it("does not charge or meter a non-ok (quota_exceeded) call", () => {
    const r = billMacroCall(db, {
      userId: "alice", apiKeyId: "csk_x", domain: "marketplace", name: "buy",
      durationMs: 0, status: "quota_exceeded", refId: "ref_quota_x",
    });
    assert.equal(r.charged.ok, false);
    const month = new Date().toISOString().slice(0, 7);
    const usage = db.prepare("SELECT * FROM api_monthly_usage WHERE user_id = ? AND month = ?")
      .get("alice", month);
    assert.equal(usage, undefined, "non-ok call must not touch the monthly allowance");
  });

  it("logs but does not charge a free-tier call", () => {
    const r = billMacroCall(db, {
      userId: "alice", apiKeyId: null, domain: "detectors", name: "run",
      durationMs: 100, status: "ok", refId: "ref_combined_2",
    });
    assert.equal(r.recorded.ok, true);
    assert.equal(r.charged.ok, false);
    assert.equal(r.charged.reason, "free_tier");
  });

  it("never throws even with bad inputs", () => {
    let threw = false;
    try { billMacroCall(db, { userId: null, apiKeyId: null, domain: null, name: null }); }
    catch { threw = true; }
    assert.equal(threw, false);
  });
});

describe("costForMacro + categoryForMacro — tiered pricing", () => {
  it("compute-tier: codebase-analysis + LLM-backed macros = $0.005", () => {
    assert.equal(categoryForMacro("detectors", "run"), "compute");
    assert.equal(costForMacro("detectors", "run"), 0.005);
    assert.equal(costForMacro("repair", "runProphet"), 0.005);
    assert.equal(categoryForMacro("chat", "respond"), "compute");
    assert.equal(costForMacro("chat", "respond"), 0.005);
  });

  it("read-tier: get/list/search/... lookups = $0.0002", () => {
    assert.equal(categoryForMacro("dtu", "list"), "read");
    assert.equal(costForMacro("dtu", "get"), 0.0002);
    assert.equal(costForMacro("marketplace", "search"), 0.0002);
  });

  it("write-tier: mutations + unrecognised macros default to $0.001", () => {
    assert.equal(categoryForMacro("dtu", "create"), "write");
    assert.equal(costForMacro("dtu", "create"), 0.001);
    assert.equal(costForMacro("dtu", "upsert_shadow"), 0.001);
    assert.equal(costForMacro("unknown_domain", "unknown_macro"), 0.001);
  });

  it("free-tier: billing introspection macros stay $0", () => {
    assert.equal(categoryForMacro("billing", "balance"), "free");
    assert.equal(costForMacro("billing", "balance"), 0);
    assert.equal(costForMacro("billing", "usage"), 0);
  });

  it("CONCORD_MACRO_COSTS_JSON would override the tier (documented escape hatch)", () => {
    // The override map is read once at module load; this test just pins
    // that an unrecognised macro falls back to the write tier rather
    // than the old `0` default — the behaviour the wiring depends on.
    assert.ok(costForMacro("some_new_domain", "frobnicate") > 0);
  });
});

describe("feature-flags helper", () => {
  it("getFlag reads truthy values", () => {
    process.env.TEST_FF = "1";
    assert.equal(getFlag("TEST_FF", 0), 1);
    process.env.TEST_FF = "true";
    assert.equal(getFlag("TEST_FF", 0), 1);
    process.env.TEST_FF = "yes";
    assert.equal(getFlag("TEST_FF", 0), 1);
    delete process.env.TEST_FF;
  });

  it("getFlag reads falsy values", () => {
    process.env.TEST_FF = "0";
    assert.equal(getFlag("TEST_FF", 1), 0);
    process.env.TEST_FF = "false";
    assert.equal(getFlag("TEST_FF", 1), 0);
    process.env.TEST_FF = "off";
    assert.equal(getFlag("TEST_FF", 1), 0);
    delete process.env.TEST_FF;
  });

  it("getFlag falls back to defaultVal for unset/garbage", () => {
    delete process.env.TEST_FF;
    assert.equal(getFlag("TEST_FF", 1), 1);
    assert.equal(getFlag("TEST_FF", 0), 0);
    process.env.TEST_FF = "garbage";
    assert.equal(getFlag("TEST_FF", 1), 1);
    delete process.env.TEST_FF;
  });

  it("getFlagNumber parses numbers + falls back", () => {
    process.env.TEST_NUM = "42";
    assert.equal(getFlagNumber("TEST_NUM", 0), 42);
    process.env.TEST_NUM = "not_a_number";
    assert.equal(getFlagNumber("TEST_NUM", 99), 99);
    delete process.env.TEST_NUM;
    assert.equal(getFlagNumber("TEST_NUM", 7), 7);
  });
});
