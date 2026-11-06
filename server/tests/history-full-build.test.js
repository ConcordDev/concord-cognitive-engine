// History full-build pins (S1 truthful extraction · S3 validation ·
// S4 one publish state · S5 detail honesty).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHistoryActions, { extractHistoryYear } from "../domains/history.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`history.${name}`);
  if (!fn) throw new Error(`history.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}
before(() => { registerHistoryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});
const ctx = { actor: { userId: "user_hist" }, userId: "user_hist" };

describe("history S1 — extractHistoryYear (the Berlin Wall battery)", () => {
  it("full dates yield their year, not their day", () => {
    assert.equal(extractHistoryYear("Construction began on 13 August 1961 across the city."), 1961);
    assert.equal(extractHistoryYear("The agreement was signed on 1 April 1952 in Bonn."), 1952);
    assert.equal(extractHistoryYear("On October 3, 1990, the two states unified."), 1990);
    assert.equal(extractHistoryYear("It fell on 9 November 1989 at night."), 1989);
  });
  it("quantities, clock times and grouped numbers yield NO year", () => {
    assert.equal(extractHistoryYear("Some 3.5 million people crossed before the closure."), null);
    assert.equal(extractHistoryYear("At 04:00, the patrols rotated again."), null);
    assert.equal(extractHistoryYear("Over 4,224 officers were deployed along the sector."), null);
    assert.equal(extractHistoryYear("Roughly 5,000 defectors made the crossing."), null);
    assert.equal(extractHistoryYear("The fine was DM 5 per person."), null);
  });
  it("a real year following a quantity is found", () => {
    assert.equal(extractHistoryYear("Some 3.5 million had left by 1961 alone."), 1961);
  });
  it("BCE years go negative", () => {
    assert.equal(extractHistoryYear("The city was founded in 753 BC by tradition."), -753);
    assert.equal(extractHistoryYear("By 44 BCE the republic was failing."), -44);
  });
});

describe("history S3 — validation", () => {
  it("an event year of 'abc' or null refuses — never coerces to 0", () => {
    const t = call("timeline-create", ctx, { title: "Validation fixture" });
    assert.equal(t.ok, true);
    const id = t.result.timeline.id;
    const bad = call("event-add", ctx, { timelineId: id, title: "Bad year", year: "abc" });
    assert.equal(bad.ok, false);
    const nul = call("event-add", ctx, { timelineId: id, title: "Null year", year: null });
    assert.equal(nul.ok, false);
    const good = call("event-add", ctx, { timelineId: id, title: "Moon landing", year: "1969" });
    assert.equal(good.ok, true);
    assert.equal(good.result.event.year, 1969);
  });
  it("a reversed era refuses with the years named; a sound era passes", () => {
    const t = call("timeline-create", ctx, { title: "Era fixture" });
    const id = t.result.timeline.id;
    const bad = call("era-add", ctx, { timelineId: id, name: "Backwards", startYear: 2000, endYear: 1900 });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /2000.*1900/);
    const good = call("era-add", ctx, { timelineId: id, name: "Forwards", startYear: 1900, endYear: 2000 });
    assert.equal(good.ok, true);
  });
  it("duplicate titles refuse with the match named; force overrides", () => {
    call("timeline-create", ctx, { title: "Dup fixture" });
    const dup = call("timeline-create", ctx, { title: "dup fixture" });
    assert.equal(dup.ok, false);
    assert.equal(dup.error, "duplicate_title");
    const forced = call("timeline-create", ctx, { title: "Dup fixture", force: true });
    assert.equal(forced.ok, true);
  });
  it("comparePeriods validates its years and omits absent dimensions", () => {
    const bad = call("comparePeriods", ctx, { periods: [
      { name: "A", startYear: "abc", endYear: 1900 },
      { name: "B", startYear: 1900, endYear: 2000 },
    ] });
    assert.equal(bad.ok, false);
    const good = call("comparePeriods", ctx, { periods: [
      { name: "A", startYear: 1800, endYear: 1900, population: "many" },
      { name: "B", startYear: 1900, endYear: 2000 },
    ] });
    assert.equal(good.ok, true);
    const [a, b] = good.result.periods;
    assert.equal(a.population, "many");
    assert.equal("population" in b, false);
    assert.equal(JSON.stringify(good.result).includes("unknown"), false);
  });
});

describe("history S4 — one publish state", () => {
  it("publish-status reads the same map the KPI counts; staleness is flagged", () => {
    const t = call("timeline-create", ctx, { title: "Publish fixture", force: true });
    const id = t.result.timeline.id;
    call("event-add", ctx, { timelineId: id, title: "Event one", year: 1900 });
    const before = call("timeline-publish-status", ctx, { timelineId: id });
    assert.equal(before.result.published, false);
    const pub = call("timeline-publish", ctx, { timelineId: id });
    assert.equal(pub.ok, true);
    const after = call("timeline-publish-status", ctx, { timelineId: id });
    assert.equal(after.result.published, true);
    assert.equal(after.result.shareId, pub.result.shareId);
    assert.equal(after.result.stale, false);
    const dash = call("history-dashboard", ctx, {});
    assert.equal(dash.result.publishedTimelines, 1);
    call("event-add", ctx, { timelineId: id, title: "Event two", year: 1950 });
    const stale = call("timeline-publish-status", ctx, { timelineId: id });
    assert.equal(stale.result.stale, true);
  });
});

describe("history S5 — the evaluator shows its formula", () => {
  it("sourceEvaluate returns the formula in words", () => {
    const r = call("sourceEvaluate", ctx, { type: "primary", bias: "low", author: "A", date: "1900", title: "Doc" });
    assert.equal(r.ok, true);
    assert.equal(r.result.reliabilityScore, 93); // 0.4*90 + 0.3*90 + 20 (author) + 10 (date)
    assert.match(r.result.formula, /0\.4 × source-type/);
  });
});
