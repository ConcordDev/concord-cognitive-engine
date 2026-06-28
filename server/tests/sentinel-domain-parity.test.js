// Contract tests for server/domains/sentinel.js — the threat-console
// operator-workflow layer (triage / monitoring / metrics / intel
// correlation / scan rules / saved queries) over the shield/intel/semantic
// substrate. All macros are pure in-process state machines on
// globalThis._concordSTATE; no network is exercised.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerSentinelActions from "../domains/sentinel.js";

// The domain is now wired through the canonical `register(domain, name, fn)`
// (MACROS) registry where `fn` is the 2-arg `(ctx, input)` shape that runMacro /
// POST /api/lens/run drive. The legacy (ctx, artifact, params) convention is
// adapted internally by the domain's own shim, so this harness calls the
// canonical 2-arg way — identical to the live dispatcher.
const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`sentinel.${name}`);
  if (!fn) throw new Error(`sentinel.${name} not registered`);
  return fn(ctx, params);
}

before(() => { registerSentinelActions(register); });

// Each test block runs against a fresh per-user state slice by minting a
// unique userId, so suites do not bleed into each other.
let seq = 0;
function freshCtx() {
  seq += 1;
  const id = `sentinel_user_${seq}`;
  return { actor: { userId: id }, userId: id };
}

beforeEach(() => {
  // sentinel macros never hit the network, but pin fetch so a regression
  // that adds an accidental fetch fails loudly.
  globalThis.fetch = async () => { throw new Error("network disabled in tests"); };
});

describe("sentinel — registration", () => {
  it("registers every backlog macro", () => {
    const expected = [
      "triage.open", "triage.list", "triage.detail", "triage.update",
      "monitor.create", "monitor.list", "monitor.toggle", "monitor.delete", "monitor.run",
      "alerts.list", "alerts.acknowledge",
      "timeline.list", "timeline.record",
      "metrics.series",
      "intel.correlate", "intel.uncorrelate",
      "scan.config.get", "scan.config.set", "scan.rule.add", "scan.rule.remove", "scan.evaluate",
      "query.save", "query.list", "query.delete", "query.touch", "query.export",
    ];
    for (const name of expected) {
      assert.ok(ACTIONS.has(`sentinel.${name}`), `sentinel.${name} should be registered`);
    }
  });
});

describe("sentinel.triage.* — threat triage", () => {
  it("opens a case, is idempotent on threatId, and lists with state counts", () => {
    const ctx = freshCtx();
    const open = call("triage.open", ctx, {
      threatId: "t-001", title: "Ransomware drop", severity: "critical",
    });
    assert.equal(open.ok, true);
    assert.equal(open.result.created, true);
    assert.equal(open.result.case.state, "open");

    const reopen = call("triage.open", ctx, { threatId: "t-001" });
    assert.equal(reopen.ok, true);
    assert.equal(reopen.result.created, false, "re-opening same threat is idempotent");

    const list = call("triage.list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.total, 1);
    assert.equal(list.result.byState.open, 1);
  });

  it("rejects open without a threatId", () => {
    const r = call("triage.open", freshCtx(), {});
    assert.equal(r.ok, false);
    assert.match(r.error, /threatId/);
  });

  it("transitions state, assigns, and appends notes", () => {
    const ctx = freshCtx();
    const caseId = call("triage.open", ctx, { threatId: "t-002", severity: "high" }).result.case.caseId;

    const upd = call("triage.update", ctx, {
      caseId, state: "investigating", assignee: "alice", note: "checked hashes",
    });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.case.state, "investigating");
    assert.equal(upd.result.case.assignee, "alice");
    assert.equal(upd.result.case.notes.length, 1);

    const detail = call("triage.detail", ctx, { caseId });
    assert.equal(detail.ok, true);
    assert.equal(detail.result.case.notes[0].text, "checked hashes");

    const resolved = call("triage.update", ctx, { caseId, state: "resolved" });
    assert.equal(resolved.result.case.state, "resolved");

    const onlyResolved = call("triage.list", ctx, { state: "resolved" });
    assert.equal(onlyResolved.result.cases.length, 1);
  });

  it("rejects an invalid state transition and a missing case", () => {
    const ctx = freshCtx();
    const caseId = call("triage.open", ctx, { threatId: "t-003" }).result.case.caseId;
    assert.equal(call("triage.update", ctx, { caseId, state: "bogus" }).ok, false);
    assert.equal(call("triage.update", ctx, { caseId: "nope" }).ok, false);
    assert.equal(call("triage.detail", ctx, { caseId: "nope" }).ok, false);
  });
});

describe("sentinel.monitor.* + alerts.* — continuous monitoring", () => {
  it("creates a monitor, runs it against a threat list, and emits new alerts", () => {
    const ctx = freshCtx();
    const mon = call("monitor.create", ctx, { name: "Crit watch", minSeverity: "high", intervalMinutes: 30 });
    assert.equal(mon.ok, true);
    assert.equal(mon.result.monitor.minSeverity, "high");

    const list = call("monitor.list", ctx, {});
    assert.equal(list.result.monitors.length, 1);
    assert.equal(list.result.active, 1);

    const run = call("monitor.run", ctx, {
      monitorId: mon.result.monitor.monitorId,
      threats: [
        { id: "x-1", severity: "critical", description: "C2 beacon" },
        { id: "x-2", severity: "low", description: "noise" },        // below threshold
        { id: "x-3", severity: "high", description: "lateral move" },
      ],
    });
    assert.equal(run.ok, true);
    assert.equal(run.result.scanned, 3);
    assert.equal(run.result.newCount, 2, "only high+critical pass the threshold");

    // Re-running with the same threats yields no NEW alerts (dedupe).
    const rerun = call("monitor.run", ctx, {
      monitorId: mon.result.monitor.monitorId,
      threats: [{ id: "x-1", severity: "critical" }],
    });
    assert.equal(rerun.result.newCount, 0, "already-alerted threats are not re-alerted");
  });

  it("lists, acknowledges single + all alerts", () => {
    const ctx = freshCtx();
    const monId = call("monitor.create", ctx, { name: "m", minSeverity: "low" }).result.monitor.monitorId;
    call("monitor.run", ctx, {
      monitorId: monId,
      threats: [{ id: "a-1", severity: "high" }, { id: "a-2", severity: "medium" }],
    });

    const before = call("alerts.list", ctx, {});
    assert.equal(before.result.total, 2);
    assert.equal(before.result.unacknowledged, 2);

    const ackOne = call("alerts.acknowledge", ctx, { alertId: before.result.alerts[0].alertId });
    assert.equal(ackOne.ok, true);
    assert.equal(ackOne.result.acknowledged, 1);

    const ackAll = call("alerts.acknowledge", ctx, { all: true });
    assert.equal(ackAll.ok, true);
    assert.equal(ackAll.result.acknowledged, 1, "only the remaining unacked alert is acked");

    const after = call("alerts.list", ctx, { unacknowledgedOnly: true });
    assert.equal(after.result.alerts.length, 0);
  });

  it("toggles and deletes monitors", () => {
    const ctx = freshCtx();
    const monId = call("monitor.create", ctx, { name: "togg" }).result.monitor.monitorId;
    assert.equal(call("monitor.toggle", ctx, { monitorId: monId }).result.monitor.enabled, false);
    assert.equal(call("monitor.toggle", ctx, { monitorId: monId, enabled: true }).result.monitor.enabled, true);
    assert.equal(call("monitor.delete", ctx, { monitorId: monId }).result.deleted, true);
    assert.equal(call("monitor.list", ctx, {}).result.monitors.length, 0);
  });

  it("rejects running a missing monitor", () => {
    assert.equal(call("monitor.run", freshCtx(), { monitorId: "nope", threats: [] }).ok, false);
  });
});

describe("sentinel.timeline.* + metrics.series", () => {
  it("records observations and lists them newest-first", () => {
    const ctx = freshCtx();
    assert.equal(call("timeline.record", ctx, { label: "manual sweep" }).ok, true);
    assert.equal(call("timeline.record", ctx, { label: "intel pull", kind: "intel_observation" }).ok, true);
    const tl = call("timeline.list", ctx, {});
    assert.equal(tl.ok, true);
    assert.ok(tl.result.total >= 2);

    const filtered = call("timeline.list", ctx, { kind: "intel_observation" });
    assert.ok(filtered.result.events.every((e) => e.kind === "intel_observation"));
  });

  it("rejects a timeline record with no label", () => {
    assert.equal(call("timeline.record", freshCtx(), {}).ok, false);
  });

  it("derives a chartable metrics series from triage activity", () => {
    const ctx = freshCtx();
    const caseId = call("triage.open", ctx, { threatId: "m-1", severity: "high" }).result.case.caseId;
    call("triage.update", ctx, { caseId, state: "resolved" });

    const m = call("metrics.series", ctx, { days: 7 });
    assert.equal(m.ok, true);
    assert.equal(m.result.chart.length, 7);
    const totalOpened = m.result.chart.reduce((s, r) => s + r.opened, 0);
    const totalResolved = m.result.chart.reduce((s, r) => s + r.resolved, 0);
    assert.equal(totalOpened, 1);
    assert.equal(totalResolved, 1);
    assert.ok(Array.isArray(m.result.severityBreakdown));
    assert.equal(m.result.openCases, 0, "the only case resolved");
  });
});

describe("sentinel.intel.correlate / uncorrelate", () => {
  it("links and unlinks an intel finding to a case", () => {
    const ctx = freshCtx();
    const caseId = call("triage.open", ctx, { threatId: "i-1" }).result.case.caseId;

    const link = call("intel.correlate", ctx, {
      caseId, intelDomain: "seismic", summary: "matching IOC cluster", relevance: 0.8,
    });
    assert.equal(link.ok, true);
    assert.equal(link.result.case.correlatedIntel.length, 1);

    const unlink = call("intel.uncorrelate", ctx, { caseId, linkId: link.result.link.id });
    assert.equal(unlink.ok, true);
    assert.equal(unlink.result.removed, 1);
    assert.equal(unlink.result.case.correlatedIntel.length, 0);
  });

  it("rejects correlation against a missing case or missing fields", () => {
    const ctx = freshCtx();
    assert.equal(call("intel.correlate", ctx, { caseId: "nope", intelDomain: "x", summary: "y" }).ok, false);
    const caseId = call("triage.open", ctx, { threatId: "i-2" }).result.case.caseId;
    assert.equal(call("intel.correlate", ctx, { caseId }).ok, false);
  });
});

describe("sentinel.scan.* — configurable scope + rules", () => {
  it("reads a default config and updates active scopes + threshold", () => {
    const ctx = freshCtx();
    const cfg = call("scan.config.get", ctx, {});
    assert.equal(cfg.ok, true);
    assert.ok(Array.isArray(cfg.result.config.scopes));

    const set = call("scan.config.set", ctx, {
      activeScopes: ["files"], autoTriageMinSeverity: "critical",
    });
    assert.equal(set.ok, true);
    assert.deepEqual(set.result.config.activeScopes, ["files"]);
    assert.equal(set.result.config.autoTriageMinSeverity, "critical");
  });

  it("adds, evaluates, and removes custom rules", () => {
    const ctx = freshCtx();
    const add = call("scan.rule.add", ctx, {
      name: "Eval block", pattern: "eval\\(", severity: "high",
    });
    assert.equal(add.ok, true);
    const ruleId = add.result.rule.ruleId;

    const hit = call("scan.evaluate", ctx, { content: "const x = eval('1+1');" });
    assert.equal(hit.ok, true);
    assert.equal(hit.result.matchCount, 1);
    assert.equal(hit.result.matches[0].severity, "high");

    const miss = call("scan.evaluate", ctx, { content: "harmless content" });
    assert.equal(miss.result.matchCount, 0);

    const rm = call("scan.rule.remove", ctx, { ruleId });
    assert.equal(rm.result.removed, 1);
  });

  it("rejects an empty rule pattern and empty evaluate content", () => {
    const ctx = freshCtx();
    assert.equal(call("scan.rule.add", ctx, {}).ok, false);
    assert.equal(call("scan.evaluate", ctx, {}).ok, false);
  });
});

describe("sentinel.query.* — saved queries + export", () => {
  it("saves, lists, touches, and deletes saved queries", () => {
    const ctx = freshCtx();
    const save = call("query.save", ctx, { query: "ransomware lateral movement", mode: "similar" });
    assert.equal(save.ok, true);
    const queryId = save.result.query.queryId;

    assert.equal(call("query.list", ctx, {}).result.queries.length, 1);

    const touch = call("query.touch", ctx, { queryId });
    assert.equal(touch.ok, true);
    assert.equal(touch.result.query.runCount, 1);

    assert.equal(call("query.delete", ctx, { queryId }).result.deleted, true);
    assert.equal(call("query.list", ctx, {}).result.queries.length, 0);
  });

  it("rejects saving an empty query", () => {
    assert.equal(call("query.save", freshCtx(), {}).ok, false);
  });

  it("exports results as JSON and CSV", () => {
    const ctx = freshCtx();
    const rows = [
      { id: "r1", score: 0.91, title: "alpha" },
      { id: "r2", score: 0.74, title: "beta, with comma" },
    ];

    const json = call("query.export", ctx, { results: rows, query: "q", format: "json" });
    assert.equal(json.ok, true);
    assert.equal(json.result.format, "json");
    assert.equal(json.result.rowCount, 2);
    assert.ok(json.result.payload.includes("alpha"));

    const csv = call("query.export", ctx, { results: rows, format: "csv" });
    assert.equal(csv.ok, true);
    assert.equal(csv.result.format, "csv");
    assert.match(csv.result.payload, /"beta, with comma"/, "CSV escapes embedded commas");
  });

  it("rejects export with no result rows", () => {
    assert.equal(call("query.export", freshCtx(), { results: [] }).ok, false);
  });
});

describe("sentinel — never throws", () => {
  it("every macro returns an { ok } envelope even on garbage input", () => {
    const ctx = freshCtx();
    for (const [key, fn] of ACTIONS) {
      if (!key.startsWith("sentinel.")) continue;
      const r = fn(ctx, { junk: Symbol("x") });
      assert.equal(typeof r.ok, "boolean", `${key} must return { ok: boolean }`);
    }
  });
});
