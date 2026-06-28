// Behavioral macro tests for server/domains/sentinel.js — the threat-console
// operator-workflow layer (triage / monitoring / metrics / intel correlation /
// scan rules / saved queries) over the shield/intel/semantic substrate.
//
// These drive each macro through the CANONICAL 2-arg `(ctx, input)` path that
// runMacro / POST /api/lens/run use — i.e. through the domain's own legacy-shim,
// the same wiring the live dispatcher exercises (NOT the raw 3-arg handler). No
// server boot, no network: every macro is a pure in-process state machine on a
// fresh-per-test globalThis._concordSTATE slice. These are NOT shape-only
// assertions — they pin ACTUAL values, multi-step round-trips, per-user
// isolation, dedupe, and the fail-CLOSED numeric guards the macro-assassin
// V2 vector probes (NaN / Infinity / 1e308 / negative → invalid_<field>).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSentinelActions from "../domains/sentinel.js";

// Canonical registry: register(domain, name, fn) where fn is the 2-arg
// (ctx, input) shape. The domain wires its verified (ctx, artifact, params)
// bodies through an internal shim, so calling 2-arg here matches the live path.
const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "sentinel", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`sentinel.${name} not registered`);
  return fn(ctx, input);
}

before(() => { registerSentinelActions(register); });
// A fresh STATE slice per test so suites never bleed into each other.
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

describe("sentinel — registration (canonical 2-arg)", () => {
  it("registers every macro the lens calls", () => {
    for (const m of [
      "triage.open", "triage.list", "triage.detail", "triage.update",
      "monitor.create", "monitor.list", "monitor.toggle", "monitor.delete", "monitor.run",
      "alerts.list", "alerts.acknowledge",
      "timeline.list", "timeline.record",
      "metrics.series",
      "intel.correlate", "intel.uncorrelate",
      "scan.config.get", "scan.config.set", "scan.rule.add", "scan.rule.remove", "scan.evaluate",
      "query.save", "query.list", "query.delete", "query.touch", "query.export",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing sentinel.${m}`);
    }
  });
});

describe("sentinel.triage — full case lifecycle round-trip", () => {
  it("opens → updates (state/assignee/note) → resolves → metrics reflect it", () => {
    const open = call("triage.open", ctxA, { threatId: "t-1", title: "C2 beacon", severity: "critical" });
    assert.equal(open.ok, true);
    assert.equal(open.result.created, true);
    assert.equal(open.result.case.severity, "critical");
    const caseId = open.result.case.caseId;

    // idempotent on threatId
    assert.equal(call("triage.open", ctxA, { threatId: "t-1" }).result.created, false);

    const upd = call("triage.update", ctxA, { caseId, state: "investigating", assignee: "bob", note: "pulled pcap" });
    assert.equal(upd.result.case.state, "investigating");
    assert.equal(upd.result.case.assignee, "bob");
    assert.equal(upd.result.case.notes.length, 1);
    assert.deepEqual(upd.result.changes.includes("note added"), true);

    const detail = call("triage.detail", ctxA, { caseId });
    assert.equal(detail.result.case.notes[0].text, "pulled pcap");

    call("triage.update", ctxA, { caseId, state: "resolved" });
    const list = call("triage.list", ctxA, {});
    assert.equal(list.result.byState.resolved, 1);
    assert.equal(list.result.byState.open, 0);

    const m = call("metrics.series", ctxA, { days: 3 });
    assert.equal(m.result.chart.length, 3);
    assert.equal(m.result.chart.reduce((s, r) => s + r.opened, 0), 1);
    assert.equal(m.result.chart.reduce((s, r) => s + r.resolved, 0), 1);
    assert.equal(m.result.openCases, 0);
  });

  it("rejects open without threatId; rejects bogus state; rejects missing case", () => {
    assert.match(call("triage.open", ctxA, {}).error, /threatId/);
    const id = call("triage.open", ctxA, { threatId: "t-2" }).result.case.caseId;
    assert.equal(call("triage.update", ctxA, { caseId: id, state: "nope" }).ok, false);
    assert.equal(call("triage.detail", ctxA, { caseId: "ghost" }).ok, false);
  });
});

describe("sentinel.monitor + alerts — dedupe + threshold", () => {
  it("creates, runs against a threat list, thresholds + dedupes, then acks", () => {
    const mon = call("monitor.create", ctxA, { name: "watch", minSeverity: "high", intervalMinutes: 30 });
    assert.equal(mon.result.monitor.intervalMinutes, 30);
    const monitorId = mon.result.monitor.monitorId;

    const run = call("monitor.run", ctxA, {
      monitorId,
      threats: [
        { id: "x-1", severity: "critical" },
        { id: "x-2", severity: "low" },      // below 'high'
        { id: "x-3", severity: "high" },
      ],
    });
    assert.equal(run.result.scanned, 3);
    assert.equal(run.result.newCount, 2);

    // re-run → no new alerts (seen-set dedupe)
    assert.equal(call("monitor.run", ctxA, { monitorId, threats: [{ id: "x-1", severity: "critical" }] }).result.newCount, 0);

    const al = call("alerts.list", ctxA, {});
    assert.equal(al.result.total, 2);
    assert.equal(al.result.unacknowledged, 2);
    call("alerts.acknowledge", ctxA, { all: true });
    assert.equal(call("alerts.list", ctxA, { unacknowledgedOnly: true }).result.alerts.length, 0);
  });

  it("rejects running a missing monitor", () => {
    assert.equal(call("monitor.run", ctxA, { monitorId: "ghost", threats: [] }).ok, false);
  });
});

describe("sentinel.scan — custom rules round-trip", () => {
  it("adds → evaluates (regex + substring fallback) → removes", () => {
    const add = call("scan.rule.add", ctxA, { name: "eval", pattern: "eval\\(", severity: "high" });
    assert.equal(add.ok, true);
    const hit = call("scan.evaluate", ctxA, { content: "x = eval('1')" });
    assert.equal(hit.result.matchCount, 1);
    assert.equal(hit.result.matches[0].severity, "high");
    assert.equal(call("scan.evaluate", ctxA, { content: "clean" }).result.matchCount, 0);
    assert.equal(call("scan.rule.remove", ctxA, { ruleId: add.result.rule.ruleId }).result.removed, 1);
  });
});

describe("sentinel.query — saved-query book + export", () => {
  it("saves → touches → exports json + csv (comma-escaped) → deletes", () => {
    const save = call("query.save", ctxA, { query: "lateral movement", mode: "similar" });
    const queryId = save.result.query.queryId;
    assert.equal(call("query.touch", ctxA, { queryId }).result.query.runCount, 1);

    const rows = [{ id: "r1", title: "alpha" }, { id: "r2", title: "beta, comma" }];
    const json = call("query.export", ctxA, { results: rows, format: "json" });
    assert.equal(json.result.rowCount, 2);
    assert.ok(json.result.payload.includes("alpha"));
    const csv = call("query.export", ctxA, { results: rows, format: "csv" });
    assert.match(csv.result.payload, /"beta, comma"/);

    assert.equal(call("query.delete", ctxA, { queryId }).result.deleted, true);
    assert.equal(call("query.list", ctxA, {}).result.queries.length, 0);
  });
});

describe("sentinel — per-user isolation", () => {
  it("user_a cases never surface for user_b", () => {
    call("triage.open", ctxA, { threatId: "iso-1", severity: "high" });
    assert.equal(call("triage.list", ctxA, {}).result.total, 1);
    assert.equal(call("triage.list", ctxB, {}).result.total, 0);
  });
});

describe("sentinel — fail-CLOSED numeric guards (assassin V2 vectors)", () => {
  const POISON = [NaN, Infinity, -Infinity, 1e308, -1];
  it("monitor.create rejects poisoned intervalMinutes with invalid_intervalMinutes", () => {
    for (const v of POISON) {
      const r = call("monitor.create", ctxA, { name: "m", intervalMinutes: v });
      assert.equal(r.ok, false, `intervalMinutes=${v} must fail-closed`);
      assert.equal(r.error, "invalid_intervalMinutes");
    }
    // a clean omitted value still defaults (60) — guard must not over-reject
    assert.equal(call("monitor.create", ctxA, { name: "m" }).result.monitor.intervalMinutes, 60);
  });
  it("metrics.series rejects poisoned days with invalid_days", () => {
    for (const v of POISON) {
      assert.equal(call("metrics.series", ctxA, { days: v }).error, "invalid_days");
    }
    assert.equal(call("metrics.series", ctxA, {}).ok, true);
  });
  it("timeline.list rejects poisoned limit with invalid_limit", () => {
    for (const v of POISON) {
      assert.equal(call("timeline.list", ctxA, { limit: v }).error, "invalid_limit");
    }
    assert.equal(call("timeline.list", ctxA, {}).ok, true);
  });
  it("intel.correlate rejects poisoned relevance with invalid_relevance", () => {
    const caseId = call("triage.open", ctxA, { threatId: "n-1" }).result.case.caseId;
    for (const v of POISON) {
      const r = call("intel.correlate", ctxA, { caseId, intelDomain: "d", summary: "s", relevance: v });
      assert.equal(r.error, "invalid_relevance", `relevance=${v} must fail-closed`);
    }
    // clean omitted relevance defaults to 0.5
    const ok = call("intel.correlate", ctxA, { caseId, intelDomain: "d", summary: "s" });
    assert.equal(ok.result.link.relevance, 0.5);
  });
});

describe("sentinel — never throws on garbage (canonical path)", () => {
  it("every macro returns an { ok } envelope on a poisoned input", () => {
    for (const [key, fn] of ACTIONS) {
      const r = fn(ctxA, { junk: Symbol("x"), relevance: NaN, days: Infinity });
      assert.equal(typeof r.ok, "boolean", `${key} must return { ok: boolean }`);
    }
  });
});
