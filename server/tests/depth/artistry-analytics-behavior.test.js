// server/tests/depth/artistry-analytics-behavior.test.js
//
// REAL behavioral tests for the artistry creator-analytics macros
// (analyticsSnapshot / analyticsHistory / profileGet's auto-snapshot),
// closing docs/WAVE4_INVENTORY.md row 102 ("No creator analytics trends
// (point-in-time totals only)") — see docs/lens-specs/artistry-capability-map.md.
//
// registerLensAction family, invoked via lensRun — see
// server/tests/depth/_harness.js's header for the dispatch contract:
// lens.run flattens a handler's own {ok:true,result:{…}} to r.result.{…}
// (single nest); a handler failure surfaces as r.result.ok===false +
// r.result.error.
//
// Every field a stored snapshot carries is copied straight from the SAME
// live computation profileGet already performs (computeArtistryStats in
// server/domains/artistry.js) — never a parallel, estimated, or
// interpolated number. These tests prove that literally: they compute the
// expected totals via the SAME real macros (projectCreate/appreciate/
// follow/projectView) the live app uses, then assert the snapshot matches.
//
// The chronological/delta/window-cap describe block below seeds
// STATE.artistryLens.analyticsSnapshots directly with distinct `date`
// values — an established depth-test technique (see
// research-behavior.test.js's `const { STATE } = await load()` direct-STATE
// reads) — so the test doesn't have to wait real calendar days to exercise
// analyticsHistory's sort/delta/window logic, which is a pure function over
// already-stored data. This is controlled test-fixture seeding, not the
// runtime fabrication CLAUDE.md's honest-by-construction invariant
// prohibits (that invariant governs what a live user-facing macro
// computes/returns to a real user, not what a test plants as a fixture to
// exercise a production code path deterministically).

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lensRun, depthCtx, load } from "./_harness.js";

describe("artistry analytics — real snapshot capture (same source as profileGet)", () => {
  it("analyticsSnapshot captures the SAME live counters computeArtistryStats/profileGet compute, and same-day re-snapshot UPDATES in place", async () => {
    const owner = await depthCtx(`art-an-owner-${randomUUID()}`);
    const fan = await depthCtx(`art-an-fan-${randomUUID()}`);

    const proj = await lensRun(
      "artistry", "projectCreate",
      { params: { title: "Nebula Study", published: true } }, owner,
    );
    assert.equal(proj.result.project.title, "Nebula Study");
    const projectId = proj.result.project.id;

    // A different real user appreciates + follows the owner — real state
    // mutations via the real macros, not numbers invented for the test.
    const appr = await lensRun("artistry", "appreciate", { params: { projectId } }, fan);
    assert.equal(appr.result.appreciated, true);
    const follow = await lensRun(
      "artistry", "follow",
      { params: { targetUserId: owner.actor.userId } }, fan,
    );
    assert.equal(follow.result.followingCount, 1);

    // Sanity-check the source of truth (profileGet's own stats) before any
    // snapshot is taken.
    const profileBefore = await lensRun("artistry", "profileGet", {}, owner);
    assert.equal(profileBefore.result.stats.projectCount, 1);
    assert.equal(profileBefore.result.stats.totalAppreciations, 1);
    assert.equal(profileBefore.result.stats.followerCount, 1);
    assert.equal(profileBefore.result.stats.totalViews, 0); // owner never counts their own view

    // profileGet above already triggered the isOwner auto-snapshot, so this
    // explicit call must find + refresh that SAME row, not create a second one.
    const snap1 = await lensRun("artistry", "analyticsSnapshot", {}, owner);
    assert.equal(snap1.result.snapshot.userId, owner.actor.userId);
    assert.equal(snap1.result.snapshot.projectCount, 1);
    assert.equal(snap1.result.snapshot.totalAppreciations, 1);
    assert.equal(snap1.result.snapshot.followerCount, 1);
    assert.equal(snap1.result.snapshot.totalViews, 0);
    assert.match(snap1.result.snapshot.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(snap1.result.deduped, true);

    // The fan actually views the project — a genuine counter change.
    const view = await lensRun("artistry", "projectView", { params: { projectId } }, fan);
    assert.equal(view.result.project.views, 1);

    // Re-snapshot the SAME UTC day → must UPDATE the existing row with the
    // LATEST real value, never push a second row.
    const snap2 = await lensRun("artistry", "analyticsSnapshot", {}, owner);
    assert.equal(snap2.result.deduped, true);
    assert.equal(
      snap2.result.snapshot.id, snap1.result.snapshot.id,
      "same-day snapshot id must be stable, not a new record",
    );
    assert.equal(
      snap2.result.snapshot.totalViews, 1,
      "must reflect the LATEST real total, not the stale first-call value",
    );

    const hist = await lensRun("artistry", "analyticsHistory", {}, owner);
    assert.equal(hist.result.count, 1, "exactly ONE record must exist for today despite three capture-triggering calls");
    assert.equal(hist.result.snapshots[0].id, snap1.result.snapshot.id);
    assert.equal(hist.result.snapshots[0].totalViews, 1);
    assert.equal(
      hist.result.snapshots[0].viewsDelta, null,
      "the only/first snapshot in the window has no prior point to diff — honest null, never a fabricated 0-as-computed value",
    );
  });

  it("profileGet's auto-snapshot fires only for the OWNER's own view, never a visitor's — and never duplicates on repeated same-day owner loads", async () => {
    const owner = await depthCtx(`art-an-owner2-${randomUUID()}`);
    const visitor = await depthCtx(`art-an-visitor-${randomUUID()}`);
    await lensRun("artistry", "projectCreate", { params: { title: "Visible Piece", published: true } }, owner);

    // A visitor loads the owner's profile page — must NOT write to the
    // owner's private analytics ledger.
    const visited = await lensRun(
      "artistry", "profileGet",
      { params: { userId: owner.actor.userId } }, visitor,
    );
    assert.equal(visited.result.isOwner, false);

    const histAfterVisit = await lensRun("artistry", "analyticsHistory", {}, owner);
    assert.equal(
      histAfterVisit.result.count, 0,
      "a visitor viewing the profile must not create an analytics row for the owner",
    );

    // The owner loading their OWN profile DOES capture/refresh today's row.
    await lensRun("artistry", "profileGet", {}, owner);
    const histAfterOwnerLoad = await lensRun("artistry", "analyticsHistory", {}, owner);
    assert.equal(histAfterOwnerLoad.result.count, 1);

    // Repeated same-day owner loads (e.g. a page that calls profileGet on
    // every render) must not pile up duplicate rows.
    await lensRun("artistry", "profileGet", {}, owner);
    await lensRun("artistry", "profileGet", {}, owner);
    const histAfterRepeats = await lensRun("artistry", "analyticsHistory", {}, owner);
    assert.equal(
      histAfterRepeats.result.count, 1,
      "repeated same-day profileGet calls must not create duplicate snapshot rows",
    );
  });

  it("analytics history is isolated per user", async () => {
    const a = await depthCtx(`art-an-iso-a-${randomUUID()}`);
    const b = await depthCtx(`art-an-iso-b-${randomUUID()}`);
    await lensRun("artistry", "projectCreate", { params: { title: "A's piece", published: true } }, a);
    await lensRun("artistry", "projectCreate", { params: { title: "B's piece 1", published: true } }, b);
    await lensRun("artistry", "projectCreate", { params: { title: "B's piece 2", published: true } }, b);

    await lensRun("artistry", "analyticsSnapshot", {}, a);
    await lensRun("artistry", "analyticsSnapshot", {}, b);

    const histA = await lensRun("artistry", "analyticsHistory", {}, a);
    const histB = await lensRun("artistry", "analyticsHistory", {}, b);
    assert.equal(histA.result.count, 1);
    assert.equal(histA.result.snapshots[0].projectCount, 1);
    assert.equal(histB.result.count, 1);
    assert.equal(histB.result.snapshots[0].projectCount, 2);
  });

  it("analyticsHistory with no prior snapshots returns an honest empty result, not fabricated placeholder rows", async () => {
    const ctx = await depthCtx(`art-an-empty-${randomUUID()}`);
    const hist = await lensRun("artistry", "analyticsHistory", {}, ctx);
    assert.equal(hist.result.count, 0);
    assert.deepEqual(hist.result.snapshots, []);
    assert.equal(hist.result.days, 30, "default window is 30 days when no days param is supplied");
  });
});

describe("artistry analytics — analyticsHistory chronological ordering, deltas, and window cap", () => {
  it("returns real stored snapshots sorted chronologically with correct deltas, and honors the days window/cap", async () => {
    const ctx = await depthCtx(`art-an-hist-${randomUUID()}`);
    const { STATE } = await load();

    // One real call first, so STATE.artistryLens (and its analyticsSnapshots
    // Map) genuinely exists — this test then plants controlled fixture rows
    // to exercise the pure sort/delta/window logic without waiting real days.
    await lensRun("artistry", "projectCreate", { params: { title: "Seed", published: true } }, ctx);
    const s = STATE.artistryLens;
    const uid = ctx.actor.userId;
    s.analyticsSnapshots.set(uid, []); // this test owns its own fixture set precisely

    const dayKey = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    const rowOld = {
      id: "seed_old", userId: uid, date: dayKey(40),
      totalViews: 10, totalAppreciations: 2, followerCount: 1, followingCount: 0, projectCount: 1,
      createdAt: "x", updatedAt: "x",
    };
    const rowMid = {
      id: "seed_mid", userId: uid, date: dayKey(5),
      totalViews: 25, totalAppreciations: 4, followerCount: 3, followingCount: 0, projectCount: 1,
      createdAt: "x", updatedAt: "x",
    };
    const rowRecent = {
      id: "seed_recent", userId: uid, date: dayKey(1),
      totalViews: 40, totalAppreciations: 4, followerCount: 2, followingCount: 0, projectCount: 1,
      createdAt: "x", updatedAt: "x",
    };
    // Push out of chronological order to prove analyticsHistory does the
    // sorting itself, not just returning insertion order.
    s.analyticsSnapshots.get(uid).push(rowRecent, rowOld, rowMid);

    const hist30 = await lensRun("artistry", "analyticsHistory", { params: { days: 30 } }, ctx);
    // The 40-days-ago row falls outside a 30-day window.
    assert.equal(hist30.result.count, 2);
    assert.equal(hist30.result.snapshots[0].id, "seed_mid");
    assert.equal(hist30.result.snapshots[1].id, "seed_recent");
    assert.equal(
      hist30.result.snapshots[0].viewsDelta, null,
      "first point inside the returned window has no prior point — honest null",
    );
    assert.equal(hist30.result.snapshots[1].viewsDelta, 40 - 25);
    assert.equal(hist30.result.snapshots[1].appreciationsDelta, 4 - 4);
    assert.equal(hist30.result.snapshots[1].followerDelta, 2 - 3);

    const hist60 = await lensRun("artistry", "analyticsHistory", { params: { days: 60 } }, ctx);
    assert.equal(hist60.result.count, 3, "widening the window must include the 40-day-old row");
    assert.equal(hist60.result.snapshots[0].id, "seed_old");
    assert.equal(hist60.result.snapshots[0].viewsDelta, null);
    assert.equal(hist60.result.snapshots[1].id, "seed_mid");
    assert.equal(hist60.result.snapshots[1].viewsDelta, 25 - 10);
    assert.equal(hist60.result.snapshots[2].id, "seed_recent");
    assert.equal(hist60.result.snapshots[2].viewsDelta, 40 - 25);

    // Cap: an absurdly large days value clamps to 365, never unbounded.
    const histHuge = await lensRun("artistry", "analyticsHistory", { params: { days: 999999 } }, ctx);
    assert.equal(histHuge.result.days, 365);

    // Floor: zero/invalid clamps to at least 1 day (never 0 or negative).
    const histZero = await lensRun("artistry", "analyticsHistory", { params: { days: 0 } }, ctx);
    assert.equal(histZero.result.days, 1);
  });
});
