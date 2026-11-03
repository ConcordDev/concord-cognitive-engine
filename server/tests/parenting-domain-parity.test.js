// Contract tests for the parenting Huckleberry 2026-parity baby-care
// macros (children, feeds, sleep + SweetSpot, diapers, pumping, growth +
// WHO percentiles, CDC milestones, medicine, activities, dashboard).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerParentingActions from "../domains/parenting.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`parenting.${name}`);
  assert.ok(fn, `parenting.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerParentingActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };
// A birth date `months` months before today.
const birthMonthsAgo = (months) =>
  new Date(Date.now() - months * 30.4375 * 86400000).toISOString().slice(0, 10);

function newChild(ctx, months = 6, sex = "boy") {
  const r = call("child-add", ctx, { name: "Baby", birthDate: birthMonthsAgo(months), sex });
  assert.equal(r.ok, true);
  return r.result.child.id;
}

// A sleep that has already ended. `endedAgoMin` keeps the end off "now".
function completedStart(durationMin, endedAgoMin = 2) {
  return new Date(Date.now() - (durationMin + endedAgoMin) * 60000).toISOString();
}

describe("parenting.child-*", () => {
  it("adds, lists with age, deletes; isolates per user", () => {
    const id = newChild(ctxA, 12);
    const list = call("child-list", ctxA, {});
    assert.equal(list.result.children.length, 1);
    assert.ok(list.result.children[0].ageMonths >= 11 && list.result.children[0].ageMonths <= 13);
    assert.equal(call("child-list", ctxB, {}).result.children.length, 0);
    assert.equal(call("child-delete", ctxA, { id }).result.deleted, id);
    assert.equal(call("child-list", ctxA, {}).result.children.length, 0);
  });

  it("rejects a bad birth date", () => {
    assert.equal(call("child-add", ctxA, { name: "X", birthDate: "not-a-date" }).ok, false);
  });

  it("shows completed months, not the partial month counted in full", () => {
    let child = null;
    for (let days = Math.floor(31.4 * 30.4375); days < Math.ceil(32.2 * 30.4375); days++) {
      const birthDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
      const id = call("child-add", ctxA, { name: "Ada", birthDate, sex: "girl" }).result.child.id;
      const listed = call("child-list", ctxA, {}).result.children.find((c) => c.id === id);
      const frac = listed.ageMonths - Math.floor(listed.ageMonths);
      if (frac >= 0.5) {
        child = listed;
        break;
      }
      call("child-delete", ctxA, { id });
    }
    assert.ok(child, "expected a birth date whose age has a half-month fraction");
    const whole = Math.floor(child.ageMonths);
    const years = Math.floor(whole / 12);
    const months = whole % 12;
    assert.ok(Math.round(child.ageMonths % 12) !== months);
    assert.equal(child.ageDisplay, `${years}y ${months}m · ${child.ageMonths} months`);
    assert.ok(child.ageMonths > whole && child.ageMonths < whole + 1);
  });
});

describe("parenting immunizations", () => {
  it("keeps a received vaccine on the child and checks the full list", () => {
    const id = newChild(ctxA, 32);
    const recorded = call("immunization-record", ctxA, { childId: id, vaccine: "MMR", received: true });
    assert.equal(recorded.ok, true);
    assert.deepEqual(recorded.result.vaccinesReceived, ["MMR"]);
    const listed = call("child-list", ctxA, {});
    assert.deepEqual(listed.result.children[0].vaccinesReceived, ["MMR"]);
    assert.equal(call("child-list", ctxB, {}).result.children.length, 0);
    assert.equal(call("immunization-record", ctxB, { childId: id, vaccine: "DTaP", received: true }).error, "child not found");

    const check = call("immunizationTracker", ctxA, { childId: id, vaccinations: "DTaP" });
    assert.equal(check.ok, true);
    assert.ok(check.result.ageMonths >= 31 && check.result.ageMonths <= 33);
    const rows = check.result.immunizations;
    assert.equal(rows.length, 10);
    for (const name of ["DTaP", "IPV (Polio)", "MMR", "Varicella"]) {
      assert.ok(rows.some((r) => r.vaccine === name), name);
    }
    const mmr = rows.find((r) => r.vaccine === "MMR");
    assert.equal(mmr.received, true);
    assert.equal(mmr.status, "completed");
    const dtap = rows.find((r) => r.vaccine === "DTaP");
    assert.equal(dtap.received, false);
    assert.equal(dtap.status, "overdue");
    const flu = rows.find((r) => r.vaccine === "Influenza");
    assert.equal(flu.status, "annual");
    assert.equal(check.result.summary.overdue, rows.filter((r) => r.status === "overdue").length);
    assert.ok(check.result.action.startsWith(`${check.result.summary.overdue} critical`));

    const cleared = call("immunization-record", ctxA, { childId: id, vaccine: "MMR", received: false });
    assert.deepEqual(cleared.result.vaccinesReceived, []);
    assert.equal(call("immunization-record", ctxA, { childId: id, vaccine: "Not a vaccine", received: true }).error, "invalid_input");
    assert.deepEqual(call("child-list", ctxA, {}).result.children[0].vaccinesReceived, []);
  });

  it("reads years and months on a generic check", () => {
    const r = call("immunizationTracker", ctxA, { childAge: "2y 8m", vaccinations: "" });
    assert.equal(r.ok, true);
    assert.equal(r.result.ageMonths, 32);
    assert.equal(r.result.immunizations.length, 10);
    assert.equal(r.result.immunizations.find((row) => row.vaccine === "MMR").status, "overdue");
  });
});

describe("parenting.feed-*", () => {
  it("logs feeds and aggregates today's stats", () => {
    const id = newChild(ctxA);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 120 });
    call("feed-log", ctxA, { childId: id, kind: "nursing", side: "left", durationMin: 15 });
    const stats = call("feed-stats", ctxA, { childId: id });
    assert.equal(stats.result.feedsToday, 2);
    assert.equal(stats.result.bottleMlToday, 120);
    assert.equal(stats.result.nursingMinToday, 15);
    assert.equal(call("feed-history", ctxA, { childId: id }).result.count, 2);
  });

  it("rejects a feed for an unknown child", () => {
    assert.equal(call("feed-log", ctxA, { childId: "nope", kind: "bottle" }).ok, false);
  });
});

describe("parenting.sleep-* and sweet-spot", () => {
  it("logs sleep and computes today's totals", () => {
    const id = newChild(ctxA);
    const naps = [
      { durationMin: 60, startAt: completedStart(60) },
      { durationMin: 45, startAt: completedStart(45) },
    ];
    for (const nap of naps) {
      const logged = call("sleep-log", ctxA, { childId: id, type: "nap", ...nap });
      assert.equal(logged.ok, true);
      assert.equal(logged.result.entry.startAt, nap.startAt);
      assert.equal(
        logged.result.entry.endAt,
        new Date(Date.parse(nap.startAt) + nap.durationMin * 60000).toISOString(),
      );
    }
    const today = new Date().toISOString().slice(0, 10);
    const todayNaps = naps.filter((n) => n.startAt.slice(0, 10) === today);
    const stats = call("sleep-stats", ctxA, { childId: id });
    assert.equal(stats.result.sleepMinToday, todayNaps.reduce((a, n) => a + n.durationMin, 0));
    assert.equal(stats.result.napsToday, todayNaps.length);
    assert.equal(stats.result.longestStretchMin, 60);
  });

  it("does not invent a start or store a nap that has not ended", () => {
    const id = newChild(ctxA);
    const missing = call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 90 });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, "invalid_input");
    assert.equal(missing.field, "startAt");
    const ahead = call("sleep-log", ctxA, {
      childId: id, type: "nap", durationMin: 90, startAt: new Date().toISOString(),
    });
    assert.equal(ahead.ok, false);
    assert.equal(ahead.error, "invalid_input");
    assert.equal(ahead.field, "endAt");
    assert.equal(ahead.reason, "end_in_future");
    const futureStart = call("sleep-log", ctxA, {
      childId: id, durationMin: 10, startAt: new Date(Date.now() + 60 * 60000).toISOString(),
    });
    assert.equal(futureStart.ok, false);
    assert.equal(futureStart.field, "startAt");
    assert.equal(futureStart.reason, "start_in_future");
    const garbage = call("sleep-log", ctxA, {
      childId: id, durationMin: "nope", startAt: completedStart(10),
    });
    assert.equal(garbage.ok, false);
    assert.equal(garbage.field, "durationMin");
    const startAt = completedStart(30);
    const mismatch = call("sleep-log", ctxA, {
      childId: id, durationMin: 30, startAt,
      endAt: new Date(Date.parse(startAt) + 10 * 60000).toISOString(),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.field, "endAt");
    assert.equal(call("sleep-history", ctxA, { childId: id }).result.count, 0);
  });

  it("sweet-spot predicts a nap window from last wake + age wake window", () => {
    const id = newChild(ctxA, 6);
    const start = new Date(Date.now() - 90 * 60000).toISOString();
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 30, startAt: start });
    const r = call("sweet-spot", ctxA, { childId: id });
    assert.ok(r.result.predictedNap);
    assert.ok(r.result.wakeWindow.typical > 0);
    assert.ok(Date.parse(r.result.predictedNap.ideal) > Date.parse(r.result.predictedNap.earliest));
    assert.ok(Date.parse(r.result.predictedNap.latest) > Date.parse(r.result.predictedNap.ideal));
  });

  it("sweet-spot flags dropped naps for children over 3", () => {
    const id = newChild(ctxA, 42);
    const r = call("sweet-spot", ctxA, { childId: id });
    assert.equal(r.result.napsLikelyDropped, true);
  });
});

describe("parenting.diaper-* and pump-*", () => {
  it("logs diapers and counts today by kind", () => {
    const id = newChild(ctxA);
    call("diaper-log", ctxA, { childId: id, kind: "wet" });
    call("diaper-log", ctxA, { childId: id, kind: "dirty" });
    const r = call("diaper-history", ctxA, { childId: id });
    assert.equal(r.result.todayCount, 2);
    assert.equal(r.result.byKindToday.wet, 1);
  });

  it("logs pumping and sums today's ml", () => {
    call("pump-log", ctxA, { amountMl: 90, side: "left", durationMin: 20 });
    call("pump-log", ctxA, { amountMl: 60, side: "right", durationMin: 15 });
    assert.equal(call("pump-history", ctxA, {}).result.mlToday, 150);
  });
});

describe("parenting.growth-*", () => {
  it("logs growth and estimates WHO percentiles", () => {
    const id = newChild(ctxA, 12, "boy");
    call("growth-log", ctxA, { childId: id, weightKg: 9.6, heightCm: 75.7 });
    const r = call("growth-percentile", ctxA, { childId: id });
    // 12-month boy at the WHO median should land near the 50th percentile.
    assert.ok(r.result.weight.percentile >= 40 && r.result.weight.percentile <= 60);
    assert.ok(r.result.height.percentile >= 40 && r.result.height.percentile <= 60);
  });

  it("rejects an empty growth measurement", () => {
    const id = newChild(ctxA);
    assert.equal(call("growth-log", ctxA, { childId: id }).ok, false);
  });

  it("percentile errors when no measurement exists", () => {
    const id = newChild(ctxA);
    assert.equal(call("growth-percentile", ctxA, { childId: id }).ok, false);
  });
});

describe("parenting.milestone-*", () => {
  it("returns an age-appropriate CDC checklist and records progress", () => {
    const id = newChild(ctxA, 12);
    const list = call("milestone-checklist", ctxA, { childId: id });
    assert.equal(list.result.checkpoint, 12);
    assert.ok(list.result.items.length >= 4);
    const first = list.result.items[0];
    call("milestone-record", ctxA, { childId: id, milestoneId: first.id, achieved: true });
    const after = call("milestone-checklist", ctxA, { childId: id });
    assert.equal(after.result.achievedCount, 1);
  });

  it("milestone-progress aggregates by category", () => {
    const id = newChild(ctxA, 24);
    const prog = call("milestone-progress", ctxA, { childId: id });
    assert.ok(prog.result.eligibleCount > 0);
    assert.ok(prog.result.byCategory.movement.total > 0);
  });

  it("rejects an unknown milestone id", () => {
    const id = newChild(ctxA);
    assert.equal(call("milestone-record", ctxA, { childId: id, milestoneId: "zzz" }).ok, false);
  });

  it("milestoneCheck reads the stored record and ignores a blank form", () => {
    const id = newChild(ctxA, 30);
    call("milestone-record", ctxA, { childId: id, milestoneId: "cdc_0", achieved: true });
    call("milestone-record", ctxA, { childId: id, milestoneId: "cdc_1", achieved: true });
    const r = call("milestoneCheck", ctxA, { childId: id, milestones: [], childAge: "2y 6m" });
    assert.equal(r.ok, true);
    assert.equal(r.result.basis, "record");
    assert.equal(r.result.eligibleCount, 36);
    assert.equal(r.result.achievedCount, 2);
    assert.equal(r.result.overallCompletionRate, undefined);
    assert.equal(call("milestoneCheck", ctxB, { childId: id }).ok, false);
  });

  it("milestoneCheck without a child is an age table, not a record", () => {
    const r = call("milestoneCheck", ctxA, { childAge: "2y 3m", milestones: [] });
    assert.equal(r.ok, true);
    assert.equal(r.result.basis, "age-table");
    assert.equal(r.result.ageMonths, 27);
    assert.equal(r.result.overallCompletionRate, 0);
    assert.match(r.result.note, /not a child's milestone record/i);
  });
});

describe("parenting.medicine / activity / timeline / dashboard", () => {
  it("logs medicine and activities", () => {
    const id = newChild(ctxA);
    call("medicine-log", ctxA, { childId: id, name: "Vitamin D", dose: "400 IU" });
    call("activity-log", ctxA, { childId: id, kind: "tummy_time", durationMin: 10 });
    assert.equal(call("medicine-history", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("activity-history", ctxA, { childId: id }).result.count, 1);
  });

  it("day-timeline merges all event types for a date", () => {
    const id = newChild(ctxA);
    const startAt = new Date(Date.now() - 90 * 1000).toISOString();
    const date = startAt.slice(0, 10);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 100, at: startAt });
    call("diaper-log", ctxA, { childId: id, kind: "wet", at: startAt });
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 1, startAt });
    const r = call("day-timeline", ctxA, { childId: id, date });
    assert.equal(r.result.count, 3);
  });

  it("dashboard reports the first child's day at a glance", () => {
    const id = newChild(ctxA);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 100 });
    const r = call("parenting-dashboard", ctxA, {});
    assert.equal(r.result.hasChild, true);
    assert.equal(r.result.feedsToday, 1);
    assert.equal(r.result.lastFeed.kind, "bottle");
  });

  it("dashboard reports no child gracefully", () => {
    const r = call("parenting-dashboard", ctxB, {});
    assert.equal(r.result.hasChild, false);
  });
});

describe("parenting.sleep-schedule (predictor)", () => {
  it("predicts the rest of today's nap/bedtime windows", () => {
    const id = newChild(ctxA, 8);
    const start = new Date(Date.now() - 60 * 60000).toISOString();
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 30, startAt: start });
    const r = call("sleep-schedule", ctxA, { childId: id });
    assert.equal(r.ok, true);
    assert.ok(Array.isArray(r.result.schedule));
    assert.ok(r.result.schedule.some((sl) => sl.kind === "bedtime"));
    assert.equal(r.result.learnedNapMin, 30);
    assert.equal(r.result.napSampleCount, 1);
    assert.equal(r.result.napBasis, "logged");
    assert.ok(r.result.wakeWindow.typical > 0);
  });

  it("names an age estimate when no nap is logged", () => {
    const id = newChild(ctxA, 8);
    const r = call("sleep-schedule", ctxA, { childId: id });
    assert.equal(r.ok, true);
    assert.equal(r.result.napSampleCount, 0);
    assert.equal(r.result.napBasis, "age");
    assert.equal(r.result.learnedNapMin, 90);
  });

  it("rejects an unknown child", () => {
    assert.equal(call("sleep-schedule", ctxA, { childId: "nope" }).ok, false);
  });
});

describe("parenting.growth-chart (WHO bands)", () => {
  it("returns percentile band curves plus this child's measurements", () => {
    const id = newChild(ctxA, 12, "boy");
    call("growth-log", ctxA, { childId: id, weightKg: 9.6 });
    const r = call("growth-chart", ctxA, { childId: id, metric: "weight" });
    assert.equal(r.ok, true);
    assert.equal(r.result.metric, "weight");
    assert.ok(r.result.curve.length > 0);
    assert.ok(r.result.curve[0].p3 < r.result.curve[0].p50);
    assert.ok(r.result.curve[0].p50 < r.result.curve[0].p97);
    assert.equal(r.result.measurements.length, 1);
  });

  it("defaults to weight for an unknown metric", () => {
    const id = newChild(ctxA, 12);
    assert.equal(call("growth-chart", ctxA, { childId: id, metric: "zzz" }).result.metric, "weight");
  });
});

function assertNoRawUserIds(value, ids) {
  const blob = JSON.stringify(value);
  for (const id of ids) {
    assert.equal(blob.includes(id), false, `response leaked ${id}: ${blob}`);
  }
  assert.equal(blob.includes("caregiverUserId"), false);
  assert.equal(blob.includes("ownerId"), false);
  assert.equal(blob.includes("redeemedBy"), false);
}

const ctxHelper = { actor: { userId: "user_b", displayName: "Nia Nanny" }, userId: "user_b" };
const ctxStranger = { actor: { userId: "user_c", displayName: "Stranger" }, userId: "user_c" };
const RAW_IDS = ["user_a", "user_b", "user_c"];

describe("parenting.caregiver-* (multi-caregiver sync)", () => {
  it("mints a share code, redeems it, lists and removes the caregiver", () => {
    const id = newChild(ctxA, 6);
    const inv = call("caregiver-invite", ctxA, { childId: id, role: "nanny" });
    assert.equal(inv.ok, true);
    assert.equal(inv.result.code.length, 6);
    assert.ok(inv.result.expiresAt);
    const redeem = call("caregiver-redeem", ctxHelper, { code: inv.result.code });
    assert.equal(redeem.ok, true);
    assert.equal(redeem.result.ownerId, undefined);
    assert.equal(redeem.result.childId, id);
    assertNoRawUserIds(redeem, RAW_IDS);
    const list = call("caregiver-list", ctxA, { childId: id });
    assert.equal(list.result.count, 1);
    assert.equal(list.result.canManage, true);
    assert.equal(list.result.caregivers[0].role, "nanny");
    assert.equal(list.result.caregivers[0].displayName, "Nia Nanny");
    assert.ok(list.result.caregivers[0].id);
    assert.notEqual(list.result.caregivers[0].id, "user_b");
    assertNoRawUserIds(list, RAW_IDS);
    assert.equal(call("caregiver-remove", ctxA, { caregiverId: "user_b" }).ok, false);
    const rm = call("caregiver-remove", ctxA, { id: list.result.caregivers[0].id });
    assert.equal(rm.ok, true);
    assert.equal(rm.result.removed, list.result.caregivers[0].id);
    assertNoRawUserIds(rm, RAW_IDS);
    assert.equal(call("caregiver-list", ctxA, { childId: id }).result.count, 0);
  });

  it("rejects an invalid code and self-redemption", () => {
    const id = newChild(ctxA, 6);
    assert.equal(call("caregiver-redeem", ctxB, { code: "BADCOD" }).ok, false);
    const inv = call("caregiver-invite", ctxA, { childId: id });
    assert.equal(call("caregiver-redeem", ctxA, { code: inv.result.code }).ok, false);
  });

  it("shares one child's log with a redeemed caregiver and revokes it", () => {
    const id = newChild(ctxA, 8);
    const sibling = newChild(ctxA, 2);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 40 });
    assert.equal(call("child-list", ctxHelper, {}).result.children.some((c) => c.id === id), false);
    assert.equal(call("feed-log", ctxHelper, { childId: id, kind: "bottle", amountMl: 10 }).ok, false);
    assert.equal(call("feed-history", ctxHelper, { childId: id }).result.count, 0);
    assert.equal(call("feed-log", ctxStranger, { childId: id, kind: "bottle" }).ok, false);

    const inv = call("caregiver-invite", ctxA, { childId: id, role: "nanny" });
    const redeem = call("caregiver-redeem", ctxHelper, { code: inv.result.code });
    assert.equal(redeem.ok, true);
    assertNoRawUserIds(redeem, RAW_IDS);

    const reused = call("caregiver-redeem", ctxHelper, { code: inv.result.code });
    assert.equal(reused.ok, false);
    assert.match(reused.error, /already used/);
    const stolen = call("caregiver-redeem", ctxStranger, { code: inv.result.code });
    assert.equal(stolen.ok, false);
    assert.match(stolen.error, /already used/);

    const shared = call("child-list", ctxHelper, {}).result.children.find((c) => c.id === id);
    assert.ok(shared);
    assert.equal(shared.shared, true);
    assert.equal(call("child-list", ctxA, {}).result.children.find((c) => c.id === id).shared, false);
    assert.equal(call("child-list", ctxHelper, {}).result.children.some((c) => c.id === sibling), false);
    assertNoRawUserIds(call("child-list", ctxHelper, {}), RAW_IDS);

    assert.equal(call("feed-history", ctxHelper, { childId: id }).result.entries.some((e) => e.amountMl === 40), true);
    const logged = call("feed-log", ctxHelper, { childId: id, kind: "bottle", amountMl: 80 });
    assert.equal(logged.ok, true);
    assert.equal(call("feed-history", ctxA, { childId: id }).result.entries.some((e) => e.amountMl === 80), true);
    assert.ok(call("feed-stats", ctxHelper, { childId: id }).result.feedsToday >= 1);
    assert.equal(call("feed-log", ctxHelper, { childId: sibling, kind: "bottle" }).ok, false);
    assert.equal(call("feed-history", ctxHelper, { childId: sibling }).result.count, 0);
    assert.equal(call("feed-log", ctxStranger, { childId: id, kind: "bottle" }).ok, false);
    assert.equal(call("feed-history", ctxStranger, { childId: id }).result.count, 0);

    assert.equal(call("sleep-log", ctxHelper, { childId: id, type: "nap", durationMin: 30, startAt: completedStart(30) }).ok, true);
    assert.equal(call("sleep-history", ctxA, { childId: id }).result.count, 1);
    const timer = call("timer-start", ctxHelper, { childId: id, kind: "nursing", side: "left" });
    assert.equal(timer.ok, true);
    assert.equal(call("timer-list", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("timer-stop", ctxA, { id: timer.result.timer.id }).ok, true);
    const apt = call("appointment-add", ctxHelper, { childId: id, title: "Well baby", date: "2099-01-02" });
    assert.equal(apt.ok, true);
    assert.equal(call("appointment-list", ctxA, { childId: id }).result.count, 1);
    const ev = call("event-add", ctxHelper, { title: "Library storytime", startAt: "2099-02-02", childId: id });
    assert.equal(ev.ok, true);
    assert.ok(call("event-list", ctxA, { childId: id }).result.events.some((e) => e.id === ev.result.event.id));
    assert.equal(call("event-list", ctxStranger, { childId: id }).result.events.some((e) => e.id === ev.result.event.id), false);
    assert.equal(call("appointment-list", ctxStranger, { childId: id }).result.count, 0);

    const roster = call("caregiver-list", ctxHelper, { childId: id });
    assert.equal(roster.result.canManage, false);
    assertNoRawUserIds(roster, RAW_IDS);
    assert.equal(call("caregiver-remove", ctxHelper, { id: roster.result.caregivers[0].id }).ok, false);

    const ownerRoster = call("caregiver-list", ctxA, { childId: id });
    const rm = call("caregiver-remove", ctxA, { id: ownerRoster.result.caregivers[0].id });
    assert.equal(rm.ok, true);
    assert.equal(call("child-list", ctxHelper, {}).result.children.some((c) => c.id === id), false);
    assert.equal(call("feed-log", ctxHelper, { childId: id, kind: "bottle" }).ok, false);
    assert.equal(call("feed-history", ctxHelper, { childId: id }).result.count, 0);
    assert.ok(call("feed-history", ctxA, { childId: id }).result.count >= 1);
    assert.equal(call("caregiver-redeem", ctxHelper, { code: inv.result.code }).ok, false);
  });

  it("rejects an expired share code before it grants access", () => {
    const id = newChild(ctxA, 4);
    const inv = call("caregiver-invite", ctxA, { childId: id, role: "grandparent" });
    const invite = globalThis._concordSTATE.parentingLens.shareCodes.get(inv.result.code);
    invite.expiresAt = new Date(Date.now() - 1000).toISOString();
    const redeem = call("caregiver-redeem", ctxHelper, { code: inv.result.code });
    assert.equal(redeem.ok, false);
    assert.match(redeem.error, /expired/);
    assert.equal(call("child-list", ctxHelper, {}).result.children.some((c) => c.id === id), false);
    assert.equal(call("feed-log", ctxHelper, { childId: id, kind: "bottle" }).ok, false);
    assert.equal(call("caregiver-list", ctxA, { childId: id }).result.count, 0);
  });

  // INC-59 live repro: two accounts — redeem must grant real access (not a
  // fake success), never leak raw user ids, and keep per-user isolation.
  it("INC-59 two-account: shared access is real, ids stay private, delete stays owner-only", () => {
    const id = newChild(ctxA, 5);
    const inv = call("caregiver-invite", ctxA, { childId: id, role: "caregiver" });
    assert.equal(inv.ok, true);

    const redeem = call("caregiver-redeem", ctxHelper, { code: inv.result.code });
    assert.equal(redeem.ok, true);
    assert.equal(redeem.result.childId, id);
    assert.equal(redeem.result.ownerId, undefined);
    assertNoRawUserIds(redeem, RAW_IDS);

    const helperKids = call("child-list", ctxHelper, {}).result.children;
    assert.ok(helperKids.some((c) => c.id === id && c.shared === true));
    assert.equal(call("child-list", ctxStranger, {}).result.children.some((c) => c.id === id), false);

    assert.equal(call("diaper-log", ctxHelper, { childId: id, kind: "wet" }).ok, true);
    assert.equal(call("diaper-history", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("medicine-log", ctxHelper, { childId: id, name: "Tylenol", dose: "2.5ml" }).ok, true);
    assert.equal(call("medicine-history", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("diaper-log", ctxStranger, { childId: id, kind: "wet" }).ok, false);

    const delHelper = call("child-delete", ctxHelper, { id });
    assert.equal(delHelper.ok, false);
    assert.match(delHelper.error, /only the owner can delete/);
    assert.equal(call("child-delete", ctxStranger, { id }).ok, false);
    assert.ok(call("child-list", ctxA, {}).result.children.some((c) => c.id === id));

    // Legacy rows stored the raw user id on caregiverId — normalize in place
    // and never project that id back out.
    const members = globalThis._concordSTATE.parentingLens.caregivers.get("user_a");
    members.push({
      caregiverId: "user_c",
      role: "grandparent",
      childId: id,
      joinedAt: new Date().toISOString(),
      via: "LEGACY",
    });
    const list = call("caregiver-list", ctxA, { childId: id });
    assert.ok(list.result.count >= 2);
    assertNoRawUserIds(list, RAW_IDS);
    for (const cg of list.result.caregivers) {
      assert.ok(cg.id);
      assert.notEqual(cg.id, "user_b");
      assert.notEqual(cg.id, "user_c");
      assert.equal(cg.caregiverId, undefined);
      assert.equal(cg.caregiverUserId, undefined);
    }
  });
});

describe("parenting.timer-* (quick-entry timers)", () => {
  it("starts, lists and stops a nursing timer committing a feed", () => {
    const id = newChild(ctxA, 4);
    const t = call("timer-start", ctxA, { childId: id, kind: "nursing", side: "left" });
    assert.equal(t.ok, true);
    const list = call("timer-list", ctxA, { childId: id });
    assert.equal(list.result.count, 1);
    assert.ok(list.result.timers[0].elapsedSec >= 0);
    const stop = call("timer-stop", ctxA, { id: t.result.timer.id });
    assert.equal(stop.ok, true);
    assert.equal(stop.result.committed, "nursing");
    assert.equal(call("feed-history", ctxA, { childId: id }).result.count, 1);
    assert.equal(call("timer-list", ctxA, { childId: id }).result.count, 0);
  });

  it("cancels a timer without committing a log", () => {
    const id = newChild(ctxA, 4);
    const t = call("timer-start", ctxA, { childId: id, kind: "sleep", sleepType: "nap" });
    assert.equal(call("timer-cancel", ctxA, { id: t.result.timer.id }).ok, true);
    assert.equal(call("sleep-history", ctxA, { childId: id }).result.count, 0);
  });

  it("rejects a duplicate running timer of the same kind", () => {
    const id = newChild(ctxA, 4);
    call("timer-start", ctxA, { childId: id, kind: "nursing" });
    assert.equal(call("timer-start", ctxA, { childId: id, kind: "nursing" }).ok, false);
  });
});

describe("parenting.expert-content (age-targeted)", () => {
  it("returns age-targeted developmental articles", () => {
    const id = newChild(ctxA, 5);
    const r = call("expert-content", ctxA, { childId: id });
    assert.equal(r.ok, true);
    assert.ok(r.result.articles.length > 0);
    assert.ok(r.result.topic);
    assert.ok(r.result.ageRange.includes("months"));
  });

  it("rejects an unknown child", () => {
    assert.equal(call("expert-content", ctxA, { childId: "nope" }).ok, false);
  });
});

describe("parenting.trends-insights", () => {
  it("summarizes weekly feeds/sleep/diapers", () => {
    const id = newChild(ctxA, 6);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 120 });
    call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 90, startAt: completedStart(90) });
    call("diaper-log", ctxA, { childId: id, kind: "wet" });
    const r = call("trends-insights", ctxA, { childId: id, days: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.days, 7);
    assert.equal(r.result.daysWithData, 1);
    assert.equal(r.result.sleepTrend, null);
    assert.equal(r.result.averages.feedsPerDay, 1);
    assert.equal(r.result.averages.sleepMinPerDay, 90);
    assert.equal(r.result.averages.diapersPerDay, 1);
    const createdDay = call("child-list", ctxA, {}).result.children.find((c) => c.id === id).createdAt.slice(0, 10);
    assert.ok(r.result.daily.every((d) => d.date >= createdDay));
    assert.equal(r.result.daily.length, 1);
    assert.ok(Array.isArray(r.result.anomalies));
  });

  it("keeps a backfilled log and omits empty days before the profile", () => {
    const id = newChild(ctxA, 6);
    const past = new Date(Date.now() - 3 * 86400000).toISOString();
    const pastDay = past.slice(0, 10);
    const older = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    call("feed-log", ctxA, { childId: id, kind: "bottle", amountMl: 80, at: past });
    const r = call("trends-insights", ctxA, { childId: id, days: 7 });
    assert.equal(r.ok, true);
    assert.equal(r.result.daysWithData, 1);
    assert.equal(r.result.sleepTrend, null);
    const dates = r.result.daily.map((d) => d.date);
    assert.ok(dates.includes(pastDay));
    assert.equal(dates.includes(older), false);
    const createdDay = call("child-list", ctxA, {}).result.children.find((c) => c.id === id).createdAt.slice(0, 10);
    assert.ok(dates.includes(createdDay));
  });

  it("names a sleep trend only after four logged days", () => {
    const id = newChild(ctxA, 6);
    for (let i = 0; i < 4; i++) {
      const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      call("sleep-log", ctxA, { childId: id, type: "nap", durationMin: 60, startAt: `${day}T12:00:00.000Z` });
    }
    const r = call("trends-insights", ctxA, { childId: id, days: 7 });
    assert.equal(r.ok, true);
    assert.ok(r.result.daysWithData >= 4);
    assert.equal(r.result.sleepTrend, "steady");
    assert.equal(r.result.averages.sleepMinPerDay, 60);
  });

  it("rejects an unknown child", () => {
    assert.equal(call("trends-insights", ctxA, { childId: "nope" }).ok, false);
  });
});

describe("parenting.appointment-* (reminders + iCal)", () => {
  it("adds, lists, completes, exports iCal and deletes appointments", () => {
    const id = newChild(ctxA, 12);
    const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const add = call("appointment-add", ctxA, {
      childId: id, title: "12-month checkup", kind: "checkup", date: future, time: "09:30",
    });
    assert.equal(add.ok, true);
    const list = call("appointment-list", ctxA, { childId: id });
    assert.equal(list.result.count, 1);
    assert.ok(list.result.nextUp);
    const ical = call("appointment-ical", ctxA, { childId: id });
    assert.equal(ical.ok, true);
    assert.ok(ical.result.ical.includes("BEGIN:VCALENDAR"));
    assert.ok(ical.result.ical.includes("BEGIN:VALARM"));
    const upd = call("appointment-update", ctxA, { id: add.result.appointment.id, done: true });
    assert.equal(upd.result.appointment.done, true);
    assert.equal(call("appointment-delete", ctxA, { id: add.result.appointment.id }).ok, true);
    assert.equal(call("appointment-list", ctxA, { childId: id }).result.count, 0);
  });

  it("rejects a bad date and errors when nothing to export", () => {
    const id = newChild(ctxA, 12);
    assert.equal(call("appointment-add", ctxA, { childId: id, title: "X", date: "nope" }).ok, false);
    assert.equal(call("appointment-ical", ctxA, { childId: id }).ok, false);
  });
});
