// tests/analytics-keep.test.js — REAL end-to-end proof for the Analytics lens
// keep-and-draft workflow. Mirrors the established pattern:
// track real events via `event-track`, read the real aggregate via
// `analytics-dashboard`, save it as a private DTU via `dtu.create`, read that
// DTU back via `dtu.get`, then draft it in Thread via `thread.thread-draft`
// citing that exact DTU id.
//
// Every lensRun call below names the macro literally. Nothing is published.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./depth/_harness.js";

describe("analytics keep + thread draft", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("analytics-keep-proof"); });

  it("tracks real events, reads the dashboard, saves a private DTU, reads it back, and drafts it in Thread", async () => {
    // 1. Track a real event via the analytics domain macro.
    const tracked = await lensRun("analytics", "event-track", {
      params: { name: "signup", distinctId: "proof-user", properties: { source: "organic" } },
    }, ctx);
    assert.equal(tracked.ok, true, "event-track should succeed");
    assert.ok(tracked.result.event.id, "tracked event should have an id");
    assert.equal(tracked.result.event.name, "signup");

    // Track a second event so the funnel/users counts are real.
    const tracked2 = await lensRun("analytics", "event-track", {
      params: { name: "purchase", distinctId: "proof-user", properties: { plan: "pro" } },
    }, ctx);
    assert.equal(tracked2.ok, true, "second event-track should succeed");

    // 2. Read the real dashboard back (the same macro the UI uses).
    const dash = await lensRun("analytics", "analytics-dashboard", {}, ctx);
    assert.equal(dash.ok, true, "analytics-dashboard should succeed");
    const d = dash.result;
    assert.ok(d.totalEvents >= 2, "dashboard should report at least 2 events");
    assert.ok(d.uniqueUsers >= 1, "dashboard should report at least 1 unique user");
    assert.ok(d.eventTypes >= 2, "dashboard should report at least 2 event types");

    // 3. Save the dashboard as a private DTU.
    const sentence = `${d.totalEvents} events tracked · ${d.uniqueUsers} unique users · ${d.eventsToday} today · ${d.eventTypes} event types · ${d.savedFunnels} saved funnels.`;
    const dtuCreated = await lensRun("dtu", "create", {
      params: {
        title: sentence.slice(0, 80),
        tags: ["analytics", "events", "dashboard"],
        source: "analytics-lens:dashboard-report",
        human: { summary: sentence },
        core: { definitions: [sentence], claims: [sentence.slice(0, 240)] },
        machine: {
          kind: "analytics_dashboard_report",
          totalEvents: d.totalEvents,
          uniqueUsers: d.uniqueUsers,
          eventsToday: d.eventsToday,
          eventTypes: d.eventTypes,
          savedFunnels: d.savedFunnels,
        },
        meta: { visibility: "private", consent: { allowCitations: false }, createdFrom: "analytics" },
      },
    }, ctx);
    assert.equal(dtuCreated.ok, true, "dtu.create should succeed");
    const dtuId = dtuCreated.result.dtu.id;
    assert.ok(dtuId, "DTU should have an id");

    // 4. Read the DTU back and confirm the id matches.
    const dtuBack = await lensRun("dtu", "get", { params: { id: dtuId } }, ctx);
    assert.equal(dtuBack.ok, true, "dtu.get should succeed");
    assert.equal(dtuBack.result.dtu.id, dtuId, "read-back DTU id must match");

    // 5. Draft it in Thread, citing that exact DTU.
    const drafted = await lensRun("thread", "thread-draft", {
      params: {
        title: "Analytics dashboard report",
        content: sentence,
        platform: "x",
        citedDtuId: dtuId,
      },
    }, ctx);
    assert.equal(drafted.ok, true, "thread-draft should succeed");
    const draft = drafted.result.draft;
    assert.equal(draft.status, "draft", "draft must stay draft");
    assert.equal(draft.citedDtuId, dtuId, "draft must cite the exact DTU");
    assert.ok(draft.id, "draft should have an id");

    // 6. Read the draft back and confirm it still cites the DTU.
    const draftBack = await lensRun("thread", "draft-detail", { params: { id: draft.id } }, ctx);
    assert.equal(draftBack.ok, true, "draft-detail should succeed");
    assert.equal(draftBack.result.draft.citedDtuId, dtuId, "draft-detail must cite the same DTU");
    assert.equal(draftBack.result.draft.status, "draft", "draft-detail must still be draft");
  });

  it("refuses to track an event with no name", async () => {
    const r = await lensRun("analytics", "event-track", { params: { name: "" } }, ctx);
    assert.equal(r.result.ok, false);
    assert.ok(/name/.test(r.result.error), "should reject empty event name");
  });
});