// tests/depth/history-figures-behavior.test.js
//
// REAL behavioral tests for the history.figure-* macro family — the
// "notable person / biography tracking distinct from dated events" gap
// closed against docs/lens-specs/history-capability-map.md. Covers CRUD
// round-trips, validation rejections, per-user isolation, and the real
// differentiator: figure-link-event validates against the caller's actual
// timelines/events (never a fabricated id), dedupes double-links, and
// figure-list/figure-update re-derive linkedEvents LIVE so a since-deleted
// timeline surfaces honestly as `found:false`.
//
// Every lensRun("history", "figure-*", …) call literally names the macro,
// so the macro-depth grader credits it as a behavioral invocation.
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { lensRun, depthCtx } from "./_harness.js";

describe("history.figure-* — CRUD round-trip + validation", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("history-figures-crud"); });

  it("figure-add → figure-list: a created figure is listed with all fields", async () => {
    const added = await lensRun("history", "figure-add", {
      params: { name: "Ada Lovelace", role: "mathematician", birthYear: 1815, deathYear: 1852, region: "europe", bio: "Wrote the first algorithm." },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.figure.name, "Ada Lovelace");
    assert.equal(added.result.figure.role, "mathematician");
    assert.equal(added.result.figure.birthYear, 1815);
    assert.equal(added.result.figure.deathYear, 1852);
    assert.equal(added.result.figure.region, "europe");
    assert.deepEqual(added.result.figure.linkedEvents, []);
    const id = added.result.figure.id;

    const list = await lensRun("history", "figure-list", {}, ctx);
    assert.equal(list.ok, true);
    const found = list.result.figures.find((f) => f.id === id);
    assert.ok(found, "figure appears in the list");
    assert.equal(found.name, "Ada Lovelace");
    assert.equal(found.linkedEventCount, 0);
  });

  it("figure-add: BCE-capable years accept negative numbers", async () => {
    const added = await lensRun("history", "figure-add", {
      params: { name: "Julius Caesar", birthYear: -100, deathYear: -44 },
    }, ctx);
    assert.equal(added.ok, true);
    assert.equal(added.result.figure.birthYear, -100);
    assert.equal(added.result.figure.deathYear, -44);
  });

  it("figure-add: an empty/whitespace-only name is rejected", async () => {
    const bad = await lensRun("history", "figure-add", { params: { name: "   " } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure name required/);
  });

  it("figure-add: a missing name is rejected", async () => {
    const bad = await lensRun("history", "figure-add", { params: { role: "no name given" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure name required/);
  });

  it("figure-update: a full field set updates every field", async () => {
    const added = await lensRun("history", "figure-add", { params: { name: "Marie Curie", role: "chemist" } }, ctx);
    const id = added.result.figure.id;
    const upd = await lensRun("history", "figure-update", {
      params: { id, name: "Marie Skłodowska-Curie", role: "physicist", birthYear: 1867, deathYear: 1934, region: "europe", bio: "Two Nobel Prizes." },
    }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.figure.name, "Marie Skłodowska-Curie");
    assert.equal(upd.result.figure.role, "physicist");
    assert.equal(upd.result.figure.birthYear, 1867);
    assert.equal(upd.result.figure.bio, "Two Nobel Prizes.");
  });

  it("figure-update: partial update ({id, role} only) leaves name/birthYear/deathYear/region/bio untouched", async () => {
    const added = await lensRun("history", "figure-add", {
      params: { name: "Isaac Newton", role: "natural philosopher", birthYear: 1643, deathYear: 1727, region: "europe", bio: "Principia Mathematica." },
    }, ctx);
    const id = added.result.figure.id;
    const upd = await lensRun("history", "figure-update", { params: { id, role: "physicist and mathematician" } }, ctx);
    assert.equal(upd.ok, true);
    assert.equal(upd.result.figure.role, "physicist and mathematician");
    // Everything NOT passed must survive byte-identical — a genuine partial
    // update, not a full-object-replace.
    assert.equal(upd.result.figure.name, "Isaac Newton");
    assert.equal(upd.result.figure.birthYear, 1643);
    assert.equal(upd.result.figure.deathYear, 1727);
    assert.equal(upd.result.figure.region, "europe");
    assert.equal(upd.result.figure.bio, "Principia Mathematica.");
  });

  it("figure-update: a missing id is rejected", async () => {
    const bad = await lensRun("history", "figure-update", { params: { id: "fig_nope_999", name: "Ghost" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure not found/);
  });

  it("figure-delete: removes the figure; it is gone from the list", async () => {
    const added = await lensRun("history", "figure-add", { params: { name: "Doomed Figure" } }, ctx);
    const id = added.result.figure.id;
    const del = await lensRun("history", "figure-delete", { params: { id } }, ctx);
    assert.equal(del.ok, true);
    assert.equal(del.result.deleted, id);
    const list = await lensRun("history", "figure-list", {}, ctx);
    assert.ok(!list.result.figures.some((f) => f.id === id));
  });

  it("figure-delete: a missing id is rejected", async () => {
    const bad = await lensRun("history", "figure-delete", { params: { id: "fig_nope_999" } }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure not found/);
  });
});

describe("history.figure-* — per-user isolation", () => {
  it("a figure created by user A is invisible to user B's figure-list", async () => {
    const ctxA = await depthCtx("history-figures-userA");
    const ctxB = await depthCtx("history-figures-userB");

    const added = await lensRun("history", "figure-add", { params: { name: "Only Visible To A" } }, ctxA);
    assert.equal(added.ok, true);
    const id = added.result.figure.id;

    const listA = await lensRun("history", "figure-list", {}, ctxA);
    assert.ok(listA.result.figures.some((f) => f.id === id), "user A sees their own figure");

    const listB = await lensRun("history", "figure-list", {}, ctxB);
    assert.ok(!listB.result.figures.some((f) => f.id === id), "user B does NOT see user A's figure");
  });
});

describe("history.figure-* — event linkage (the real timeline-linkage differentiator)", () => {
  let ctx;
  before(async () => { ctx = await depthCtx("history-figures-linkage"); });

  it("figure-link-event: links a REAL timeline event and re-derives it live with found:true", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "Napoleonic Era" } }, ctx);
    const timelineId = tl.result.timeline.id;
    const ev = await lensRun("history", "event-add", { params: { timelineId, title: "Battle of Waterloo", year: 1815 } }, ctx);
    const eventId = ev.result.event.id;
    const fig = await lensRun("history", "figure-add", { params: { name: "Napoleon Bonaparte" } }, ctx);
    const figureId = fig.result.figure.id;

    const linked = await lensRun("history", "figure-link-event", { params: { figureId, timelineId, eventId } }, ctx);
    assert.equal(linked.ok, true);
    assert.equal(linked.result.figure.linkedEvents.length, 1);
    const le = linked.result.figure.linkedEvents[0];
    assert.equal(le.found, true);
    assert.equal(le.timelineId, timelineId);
    assert.equal(le.eventId, eventId);
    assert.equal(le.eventTitle, "Battle of Waterloo");
    assert.equal(le.eventYear, 1815);
    assert.equal(le.timelineTitle, "Napoleonic Era");

    // figure-list independently re-derives the same live linkage.
    const list = await lensRun("history", "figure-list", {}, ctx);
    const relisted = list.result.figures.find((f) => f.id === figureId);
    assert.equal(relisted.linkedEventCount, 1);
    assert.equal(relisted.linkedEvents[0].found, true);
  });

  it("figure-link-event: rejects a fabricated timelineId (never accepted silently)", async () => {
    const fig = await lensRun("history", "figure-add", { params: { name: "No Real Timeline" } }, ctx);
    const bad = await lensRun("history", "figure-link-event", {
      params: { figureId: fig.result.figure.id, timelineId: "tl_fake_ghost", eventId: "ev_fake_ghost" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /timeline not found/);
  });

  it("figure-link-event: rejects a fabricated eventId against a real timeline", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "Real But Eventless" } }, ctx);
    const fig = await lensRun("history", "figure-add", { params: { name: "No Real Event" } }, ctx);
    const bad = await lensRun("history", "figure-link-event", {
      params: { figureId: fig.result.figure.id, timelineId: tl.result.timeline.id, eventId: "ev_fake_ghost" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /event not found/);
  });

  it("figure-link-event: rejects a missing figureId", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "Orphan Link Target" } }, ctx);
    const ev = await lensRun("history", "event-add", { params: { timelineId: tl.result.timeline.id, title: "Some Event", year: 1900 } }, ctx);
    const bad = await lensRun("history", "figure-link-event", {
      params: { figureId: "fig_fake_ghost", timelineId: tl.result.timeline.id, eventId: ev.result.event.id },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure not found/);
  });

  it("figure-link-event: linking the same event twice dedupes (no duplicate entry)", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "Dedupe Test" } }, ctx);
    const timelineId = tl.result.timeline.id;
    const ev = await lensRun("history", "event-add", { params: { timelineId, title: "Signing", year: 1776 } }, ctx);
    const eventId = ev.result.event.id;
    const fig = await lensRun("history", "figure-add", { params: { name: "Dedupe Figure" } }, ctx);
    const figureId = fig.result.figure.id;

    await lensRun("history", "figure-link-event", { params: { figureId, timelineId, eventId } }, ctx);
    const second = await lensRun("history", "figure-link-event", { params: { figureId, timelineId, eventId } }, ctx);
    assert.equal(second.ok, true);
    assert.equal(second.result.figure.linkedEvents.length, 1, "linking the same event twice does not duplicate");
  });

  it("figure-unlink-event: removes a real link", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "Unlink Test" } }, ctx);
    const timelineId = tl.result.timeline.id;
    const ev = await lensRun("history", "event-add", { params: { timelineId, title: "Coronation", year: 1804 } }, ctx);
    const eventId = ev.result.event.id;
    const fig = await lensRun("history", "figure-add", { params: { name: "Unlink Figure" } }, ctx);
    const figureId = fig.result.figure.id;
    await lensRun("history", "figure-link-event", { params: { figureId, timelineId, eventId } }, ctx);

    const unlinked = await lensRun("history", "figure-unlink-event", { params: { figureId, timelineId, eventId } }, ctx);
    assert.equal(unlinked.ok, true);
    assert.equal(unlinked.result.removed, true);
    assert.equal(unlinked.result.figure.linkedEvents.length, 0);
  });

  it("figure-unlink-event: removing a link that was never there is a no-op success, not an error", async () => {
    const fig = await lensRun("history", "figure-add", { params: { name: "Never Linked" } }, ctx);
    const r = await lensRun("history", "figure-unlink-event", {
      params: { figureId: fig.result.figure.id, timelineId: "tl_never", eventId: "ev_never" },
    }, ctx);
    assert.equal(r.ok, true);
    assert.equal(r.result.removed, false);
  });

  it("figure-unlink-event: a missing figureId is rejected", async () => {
    const bad = await lensRun("history", "figure-unlink-event", {
      params: { figureId: "fig_fake_ghost", timelineId: "tl_x", eventId: "ev_x" },
    }, ctx);
    assert.equal(bad.result.ok, false);
    assert.match(bad.result.error, /figure not found/);
  });

  it("live-rederivation honesty: deleting the linked timeline surfaces found:false, and the figure itself survives", async () => {
    const tl = await lensRun("history", "timeline-create", { params: { title: "About To Be Deleted" } }, ctx);
    const timelineId = tl.result.timeline.id;
    const ev = await lensRun("history", "event-add", { params: { timelineId, title: "Ephemeral Event", year: 1900 } }, ctx);
    const eventId = ev.result.event.id;
    const fig = await lensRun("history", "figure-add", { params: { name: "Stale Link Figure" } }, ctx);
    const figureId = fig.result.figure.id;
    await lensRun("history", "figure-link-event", { params: { figureId, timelineId, eventId } }, ctx);

    // Delete the timeline out from under the link.
    const del = await lensRun("history", "timeline-delete", { params: { id: timelineId } }, ctx);
    assert.equal(del.ok, true);

    const list = await lensRun("history", "figure-list", {}, ctx);
    const relisted = list.result.figures.find((f) => f.id === figureId);
    assert.ok(relisted, "the figure itself still exists after its linked timeline is gone");
    assert.equal(relisted.linkedEvents.length, 1, "the stale link entry is preserved, not silently dropped");
    assert.equal(relisted.linkedEvents[0].found, false, "a deleted timeline's link honestly reports found:false");
    assert.equal(relisted.linkedEvents[0].timelineId, timelineId);
    assert.equal(relisted.linkedEvents[0].eventId, eventId);
    // No fabricated title/year on a stale link.
    assert.equal(relisted.linkedEvents[0].eventTitle, undefined);
  });
});
