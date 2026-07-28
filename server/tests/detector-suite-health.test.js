// tests/detector-suite-health.test.js
//
// The immune system needs its own immune check. This pins the properties that,
// when they quietly broke, let a "60+ detectors" suite ship with zero injection
// coverage, a misdirected authz detector, and two detectors that silently
// no-op'd in CI for want of a DB:
//
//   1. Every registered detector RUNS without crashing (given root + an
//      ephemeral migrated DB) and returns a well-formed report.
//   2. The "security" consumer is NON-EMPTY — so the blocking security gate
//      (`--consumer security`) can never silently become a no-op that passes
//      because it ran nothing.
//   3. db-backed detectors actually execute against a real schema (ok:true),
//      not `reason:"no_db"`.
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import {
  listDetectors,
  runDetector,
  runAllDetectors,
} from "../lib/detectors/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("detector suite health (the immune system's own checkup)", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    const origLog = console.log, origWarn = console.warn;
    console.log = () => {}; console.warn = () => {};
    try { await runMigrations(db); } finally { console.log = origLog; console.warn = origWarn; }
  });
  after(() => { try { db?.close(); } catch { /* noop */ } });

  it("the security consumer is non-empty (the gate can't silently run nothing)", () => {
    const security = listDetectors().filter((d) => (d.consumers || []).includes("security"));
    assert.ok(security.length >= 3, `expected >=3 security detectors, got ${security.length}`);
    const ids = security.map((d) => d.id);
    assert.ok(ids.includes("command-injection"), "command-injection must be in the security consumer");
    assert.ok(ids.includes("authz-coverage"), "authz-coverage must be in the security consumer");
    // Promoted 2026-07-27. Pinned so it cannot be quietly dropped back to
    // code-quality-only, which is how a committed credential ends up caught
    // after merge instead of on the PR.
    assert.ok(ids.includes("secret-leak"), "secret-leak must be in the security consumer");
  });

  it("every security-consumer detector can actually emit a blocking severity", () => {
    // The gate fails only on NEW high/critical. A detector that only ever
    // emits `info` would run on every PR and be structurally incapable of
    // blocking anything — coverage theatre. This is why `constant-time`
    // (info-only) was evaluated for the security consumer and left out.
    //
    // Heuristic, and deliberately the loose form: match a quoted "critical" or
    // "high" anywhere in non-comment source, NOT `severity: "high"`
    // specifically. The strict form produced a false positive on
    // command-injection, which is genuinely capable of both but returns them
    // from a severityFor() helper (`klass.tainted ? "high" : "medium"`) rather
    // than as a literal field. Comment lines are stripped so a detector that
    // merely *describes* high-severity findings can't pass on prose alone.
    const SEVERITY_RE = /["'](critical|high)["']/;
    const security = listDetectors().filter((d) => (d.consumers || []).includes("security"));
    const toothless = [];
    for (const d of security) {
      const src = readFileSync(path.join(ROOT, "server/lib/detectors", `${d.id}-detector.js`), "utf8");
      const code = src
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");
      if (!SEVERITY_RE.test(code)) toothless.push(d.id);
    }
    assert.deepEqual(
      toothless, [],
      "these security-gate detectors can never emit high/critical, so they cannot block"
    );
  });

  it("db-backed detectors actually RUN with a db (the silent-no_db regression we fixed)", { timeout: 60_000 }, async () => {
    // The exact failure this pins: dtu-lineage + concordia-substrate returned
    // ok:false reason:"no_db" in every CLI/PR run for want of a DB, contributing
    // nothing to the gate. run-detectors.js now hands them an ephemeral migrated
    // DB; assert they execute (ok:true) against the real schema.
    const dbDetectors = listDetectors().filter((d) => (d.dataNeeds || []).includes("db")).map((d) => d.id);
    assert.ok(dbDetectors.length >= 2, "expected db-backed detectors to exist");
    const reports = await Promise.all(dbDetectors.map((id) => runDetector(id, { root: ROOT, db })));
    const noDb = reports.filter((r) => !r.ok && r.reason === "no_db").map((r) => r.id);
    assert.deepEqual(noDb, [], `db-backed detectors still report no_db despite a db: ${noDb.join(", ")}`);
    for (const r of reports) {
      assert.ok(r.summary && typeof r.summary.total === "number", `${r.id}: well-formed summary`);
      assert.ok(Array.isArray(r.findings), `${r.id}: findings[]`);
    }
  });

  it("a cross-section of detectors return well-formed, non-crashed reports", { timeout: 180_000 }, async () => {
    // Representative shape-contract smoke (the full 30-way sweep is the CI
    // ratchet job, not a unit test).
    //
    // Timeout raised 60s -> 180s 2026-07-27. This test had become
    // PERMANENTLY RED — it times out on a clean tree, verified by stashing all
    // local changes and re-running. The sample's own cost has simply outgrown
    // the old budget as the tree grew; measured individually on this box:
    // stale-code 43.7s, authz-coverage 8.5s, command-injection 6.3s,
    // secret-leak 3.4s, invariant-guardian 2.1s — ~64s serial, and the
    // Promise.all below does not really parallelise them because the work is
    // CPU-bound file walking on one thread. So the sample could not fit in 60s
    // no matter what.
    //
    // Raising the budget is not weakening the check: this asserts detectors
    // return well-formed, non-crashed reports, not that they are fast. A test
    // that always times out asserts nothing at all.
    const sample = ["stale-code", "invariant-guardian", "secret-leak", "command-injection", "authz-coverage"];
    const reports = await Promise.all(sample.map((id) => runDetector(id, { root: ROOT, db })));
    const bad = reports.filter((r) => !r.ok).map((r) => `${r.id}:${r.reason}`);
    assert.deepEqual(bad, [], `crashed: ${bad.join(", ")}`);
    for (const r of reports) assert.ok(Array.isArray(r.findings), `${r.id}: findings[]`);
  });

  it("the full security-scoped run aggregates cleanly (no NaN totals, no throw)", async () => {
    const report = await runAllDetectors({ root: ROOT, consumer: "security", db });
    assert.ok(report.detectorCount >= 2);
    for (const k of ["critical", "high", "medium", "low", "info", "total"]) {
      assert.equal(Number.isFinite(report.totals[k]), true, `totals.${k} finite`);
    }
  });
});
