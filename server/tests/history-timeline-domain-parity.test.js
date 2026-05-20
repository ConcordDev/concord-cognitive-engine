// Contract tests for the history lens — Tiki-Toki/Sutori-shape timeline
// builder substrate in server/domains/history.js.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerHistoryActions from "../domains/history.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`history.${name}`);
  assert.ok(fn, `history.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerHistoryActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
  globalThis.fetch = async () => { throw new Error("network disabled"); };
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newTimeline(ctx = ctxA) {
  return call("timeline-create", ctx, { title: "Ancient Rome" }).result.timeline;
}

describe("history.timeline CRUD", () => {
  it("creates a timeline scoped per user", () => {
    newTimeline();
    assert.equal(call("timeline-list", ctxA, {}).result.count, 1);
    assert.equal(call("timeline-list", ctxB, {}).result.count, 0);
  });
  it("rejects an untitled timeline and deletes one", () => {
    assert.equal(call("timeline-create", ctxA, {}).ok, false);
    const t = newTimeline();
    call("timeline-delete", ctxA, { id: t.id });
    assert.equal(call("timeline-list", ctxA, {}).result.count, 0);
  });
});

describe("history.events", () => {
  it("adds events and returns them sorted by year (BCE first)", () => {
    const t = newTimeline();
    call("event-add", ctxA, { timelineId: t.id, title: "Augustus becomes emperor", year: -27 });
    call("event-add", ctxA, { timelineId: t.id, title: "Founding of Rome", year: -753 });
    call("event-add", ctxA, { timelineId: t.id, title: "Fall of Western Rome", year: 476 });
    const d = call("timeline-detail", ctxA, { id: t.id });
    assert.equal(d.result.timeline.events[0].title, "Founding of Rome");
    assert.equal(d.result.timeline.events[2].title, "Fall of Western Rome");
    assert.equal(d.result.span.from, -753);
    assert.equal(d.result.span.to, 476);
  });
  it("auto-labels BCE years and rejects an event with no year", () => {
    const t = newTimeline();
    const e = call("event-add", ctxA, { timelineId: t.id, title: "Caesar", year: -44 });
    assert.equal(e.result.event.dateLabel, "44 BCE");
    assert.equal(call("event-add", ctxA, { timelineId: t.id, title: "No year" }).ok, false);
  });
  it("updates and deletes an event", () => {
    const t = newTimeline();
    const e = call("event-add", ctxA, { timelineId: t.id, title: "Event", year: 100 }).result.event;
    call("event-update", ctxA, { timelineId: t.id, eventId: e.id, title: "Renamed Event" });
    assert.equal(call("timeline-detail", ctxA, { id: t.id }).result.timeline.events[0].title, "Renamed Event");
    call("event-delete", ctxA, { timelineId: t.id, eventId: e.id });
    assert.equal(call("timeline-detail", ctxA, { id: t.id }).result.timeline.events.length, 0);
  });
});

describe("history.eras", () => {
  it("adds and deletes color-coded eras", () => {
    const t = newTimeline();
    const era = call("era-add", ctxA, { timelineId: t.id, name: "Republic", startYear: -509, endYear: -27 });
    assert.equal(era.ok, true);
    assert.equal(call("timeline-detail", ctxA, { id: t.id }).result.timeline.eras.length, 1);
    call("era-delete", ctxA, { timelineId: t.id, eraId: era.result.era.id });
    assert.equal(call("timeline-detail", ctxA, { id: t.id }).result.timeline.eras.length, 0);
  });
});

describe("history.dashboard", () => {
  it("aggregates timelines, events and eras", () => {
    const t = newTimeline();
    call("event-add", ctxA, { timelineId: t.id, title: "E1", year: 1 });
    call("era-add", ctxA, { timelineId: t.id, name: "Era1", startYear: 0, endYear: 100 });
    const d = call("history-dashboard", ctxA, {});
    assert.equal(d.result.timelines, 1);
    assert.equal(d.result.totalEvents, 1);
    assert.equal(d.result.totalEras, 1);
  });
});

describe("history — analysis macros still intact", () => {
  it("timelineBuild still responds", () => {
    assert.equal(call("timelineBuild", ctxA, {}).ok, true);
  });
});
