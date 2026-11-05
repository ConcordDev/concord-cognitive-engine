// Build tests for the Observe full-lens build (PR build(observe)):
//   O-S1 ripple-report shaping — focus term-matching + coverage statement
//   O-S2 serviceLog — the handed batch is the scope; the window is disclosed,
//        never a silent filter (the walk's demo lines are dated 2026-05-16)
//   O-S3 pageOnCall — unserved channels stay recorded-not-delivered
//        (the build scopes the route FORM's offer; the record stays truthful)
//   O-S5 synthetics — save/list carry status + lastRun + history for the row
//
// Pattern mirrors server/tests/observe-domain-parity.test.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerObserveActions from "../domains/observe.js";
import { shapeRippleReport, focusTerms } from "../lib/ripple-report.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, artifactOrParams = {}, maybeParams) {
  const fn = ACTIONS.get(`observe.${name}`);
  if (!fn) throw new Error(`observe.${name} not registered`);
  const artifact = arguments.length === 4 ? artifactOrParams : { id: null, data: {}, meta: {} };
  const params = arguments.length === 4 ? (maybeParams || {}) : artifactOrParams;
  return fn(ctx, artifact, params);
}

before(() => { registerObserveActions(register); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "obs_user_a" }, userId: "obs_user_a" };

// ------------------------------------------------------------------- O-S2
describe("observe.serviceLog — handed batch is the scope (O-S2)", () => {
  // The walk's exact input: the two demo lines, dated 2026-05-16, typed
  // for real. The old handler windowed them out and reported 0 lines.
  const demoArtifact = { data: { entries: [
    { level: "ERROR", ts: "2026-05-16T10:00:00Z", service: "api", message: "timeout connecting to db" },
    { level: "INFO", ts: "2026-05-16T10:01:00Z", service: "api", message: "healthy" },
  ] } };

  it("counts the demo lines in full: 2 lines, 50% error rate (§9 checkpoint 2)", () => {
    const r = call("serviceLog", ctxA, demoArtifact, { windowMinutes: 60 });
    assert.equal(r.ok, true);
    assert.equal(r.result.count, 2);
    assert.equal(r.result.received, 2);
    assert.equal(r.result.errorRate, 50);
    assert.equal(r.result.topService, "api");
    assert.equal(r.result.byLevel.ERROR, 1);
    assert.equal(r.result.byLevel.INFO, 1);
  });

  it("discloses the window instead of filtering by it", () => {
    const r = call("serviceLog", ctxA, demoArtifact, { windowMinutes: 60 });
    assert.equal(r.result.outsideWindow, 2); // both demo lines predate the window
    assert.match(r.result.sourceNote, /does not read the Telemetry log store/);
  });

  it("fresh lines report outsideWindow 0", () => {
    const now = new Date().toISOString();
    const artifact = { data: { entries: [{ level: "info", ts: now, service: "api", message: "ok" }] } };
    const r = call("serviceLog", ctxA, artifact, { windowMinutes: 60 });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.outsideWindow, 0);
  });

  it("does NOT read the Telemetry log store (the disclosure is true)", () => {
    const ing = call("logIngest", ctxA, { entries: [{ level: "error", service: "api", message: "stored line" }] });
    assert.equal(ing.ok, true);
    const r = call("serviceLog", ctxA, { data: { entries: [] } }, { windowMinutes: 60 });
    assert.equal(r.result.count, 0); // the stored line is logSearch's, not this verb's input
  });

  it("accepts entries via params as well as the artifact (both lens-run mappings)", () => {
    const r = call("serviceLog", ctxA,
      { data: {} },
      { windowMinutes: 60, entries: [{ level: "WARN", ts: "2026-05-16T10:00:00Z", service: "db", message: "slow" }] });
    assert.equal(r.result.count, 1);
    assert.equal(r.result.topService, "db");
  });
});

// ------------------------------------------------------------------- O-S1
describe("ripple-report shaping — focus + coverage (O-S1)", () => {
  const ripples = {
    grudges: [{ npc_id: "n1", target_kind: "faction", target_id: "voss", severity: 4, created_at: 100 }],
    factionMoves: [
      { faction_id: "hale", kind: "expand", payload_json: "{}", created_at: 120 },
      { faction_id: "concord", kind: "stance_shift", payload_json: "{\"note\":\"new stance\"}", created_at: 110 },
    ],
    regionsSpawned: [],
    latticeQuests: [],
  };

  it("focusTerms keeps tokens of length ≥ 3, deduped, lowercase", () => {
    assert.deepEqual(focusTerms("Faction Concord stance!"), ["faction", "concord", "stance"]);
    assert.deepEqual(focusTerms("a to be"), []);
    assert.deepEqual(focusTerms(null), []);
  });

  it("focus matches surface first, tagged, and counted", () => {
    const out = shapeRippleReport(ripples, { focus: "Concord stance", worldId: "concordia-hub", sinceTs: 0, untilTs: 3600 });
    assert.equal(out.focus.matchedTotal, 1);
    assert.equal(out.focus.perSource.factionMoves, 1);
    assert.equal(out.focus.perSource.grudges, 0);
    assert.equal(out.ripples.factionMoves[0].faction_id, "concord");
    assert.equal(out.ripples.factionMoves[0].focusMatch, true);
    assert.equal(out.ripples.factionMoves[1].focusMatch, undefined);
    assert.match(out.focus.statement, /1 of 3 recorded rows match/);
  });

  it("term matching is over the rows' own fields (a grudge targeting a faction matches 'faction')", () => {
    const out = shapeRippleReport(ripples, { focus: "faction", sinceTs: 0, untilTs: 3600 });
    assert.equal(out.focus.perSource.grudges, 1); // target_kind: "faction"
    assert.equal(out.ripples.grudges[0].focusMatch, true);
  });

  it("focus with no match says so and keeps the full record", () => {
    const out = shapeRippleReport(ripples, { focus: "zephyr quill", sinceTs: 0, untilTs: 3600 });
    assert.equal(out.focus.matchedTotal, 0);
    assert.match(out.focus.statement, /no recorded row in the window matches/);
    assert.equal(out.ripples.factionMoves.length, 2);
  });

  it("no focus: arrays untouched, focus null, coverage still stated", () => {
    const out = shapeRippleReport(ripples, { worldId: "concordia-hub", sinceTs: 0, untilTs: 3600 });
    assert.equal(out.focus, null);
    assert.equal(out.ripples.factionMoves[0].faction_id, "hale"); // original order
    assert.equal(out.coverage.total, 3);
    assert.match(out.coverage.statement, /faction moves 2/);
    assert.match(out.coverage.statement, /faction_strategy_log/);
    assert.match(out.coverage.statement, /nothing was recorded, not that the world was inactive/);
  });

  it("empty window: coverage reads as zeroes per named source", () => {
    const out = shapeRippleReport({}, { sinceTs: 0, untilTs: 3600 });
    assert.equal(out.coverage.total, 0);
    assert.match(out.coverage.statement, /grudges 0 · faction moves 0 · regions spawned 0 · lattice quests 0/);
  });
});

// ------------------------------------------------------------------- O-S3
describe("observe.pageOnCall — unserved channels recorded, not delivered (O-S3)", () => {
  it("a DM route is recorded not-delivered with its reason; the record layer stays truthful", async () => {
    const setup = call("oncallSetup", ctxA, {
      schedule: [{ person: "PR2 OnCall", startsAt: new Date(Date.now() - 60000).toISOString(), endsAt: "" }],
      routes: [
        { name: "dm-route", channel: "dm", target: "qa_user", minSeverity: "sev3" },
        { name: "hook", channel: "webhook", target: "https://127.0.0.1:9/hook", minSeverity: "sev3" },
      ],
    });
    assert.equal(setup.ok, true);
    assert.equal(setup.result.routes.length, 2); // setup still records what was configured
    const r = await call("pageOnCall", ctxA, { severity: "sev2", summary: "test page" });
    assert.equal(r.ok, true);
    assert.equal(r.result.routesMatched, 2);
    assert.equal(r.result.routesDelivered, 0);
    const dm = r.result.page.routesFired.find((f) => f.channel === "dm");
    assert.equal(dm.delivered, false);
    assert.match(dm.reason, /not connected/);
    const hook = r.result.page.routesFired.find((f) => f.channel === "webhook");
    assert.equal(hook.delivered, false); // SSRF-blocked target — fails closed, never "notified"
  });
});

// ------------------------------------------------------------------- O-S5
describe("observe synthetics — the record the row renders (O-S5)", () => {
  it("save/list carry url, status, lastRun and history", async () => {
    const saved = await call("syntheticSave", ctxA, { url: "https://93.184.216.34/health", name: "edge health", timeoutMs: 500 });
    assert.equal(saved.ok, true, saved.error || "save failed");
    const list = call("syntheticList", ctxA);
    assert.equal(list.result.total, 1);
    const chk = list.result.checks[0];
    assert.equal(chk.url, "https://93.184.216.34/health");
    assert.equal(chk.status, "pending");
    assert.equal(chk.lastRun, null);
    assert.deepEqual(chk.history, []);
  });

  it("a run records its outcome into history + lastRun + status", async () => {
    const saved = await call("syntheticSave", ctxA, { url: "https://93.184.216.34/health", name: "edge health", timeoutMs: 500 });
    const id = saved.result.check.id;
    const run = await call("syntheticRun", ctxA, { id });
    assert.equal(run.ok, true);
    const list = call("syntheticList", ctxA);
    const chk = list.result.checks[0];
    assert.equal(chk.history.length, 1);
    assert.ok(chk.lastRun, "lastRun is set after a run");
    assert.ok(["up", "down"].includes(chk.status));
    assert.equal(typeof chk.history[0].latencyMs, "number");
  });
});
