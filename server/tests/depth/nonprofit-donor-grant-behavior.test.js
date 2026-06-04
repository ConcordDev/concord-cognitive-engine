// tests/depth/nonprofit-donor-grant-behavior.test.js — REAL behavioral tests for the
// nonprofit donor/grant action macros (lens-audit Batch B: view-giving-history /
// grant-deadline-check / impact-report / send-acknowledgment hit no macro until these landed).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lensRun } from "./_harness.js";

describe("nonprofit.view-giving-history", () => {
  it("aggregates a donor's gift history", async () => {
    const r = await lensRun("nonprofit", "view-giving-history", {
      data: { name: "Jane", gifts: [{ amount: 100, date: "2025-01-01" }, { amount: 250, date: "2025-06-01" }] },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.giftCount, 2);
    assert.equal(r.result.totalGiven, 350);
    assert.equal(r.result.averageGift, 175);
    assert.equal(r.result.firstGift, "2025-01-01");
    assert.equal(r.result.lastGift, "2025-06-01");
  });
});

describe("nonprofit.grant-deadline-check", () => {
  it("flags overdue vs on_track from the deadline", async () => {
    const past = await lensRun("nonprofit", "grant-deadline-check", { data: { name: "G", deadline: "2000-01-01" } });
    assert.equal(past.result.status, "overdue");
    assert.ok(past.result.daysRemaining < 0);
    const far = await lensRun("nonprofit", "grant-deadline-check", { data: { name: "G", deadline: "2999-01-01" } });
    assert.equal(far.result.status, "on_track");
    const none = await lensRun("nonprofit", "grant-deadline-check", { data: { name: "G" } });
    assert.equal(none.result.status, "no_deadline");
  });
});

describe("nonprofit.impact-report", () => {
  it("summarizes program impact metrics + beneficiaries", async () => {
    const r = await lensRun("nonprofit", "impact-report", {
      data: { name: "Food Program", beneficiaries: 500, impactMetrics: { mealsServed: 12000 } },
    });
    assert.equal(r.ok, true);
    assert.equal(r.result.beneficiaries, 500);
    assert.equal(r.result.metrics.mealsServed, 12000);
    assert.match(r.result.summary, /500 served/);
  });
});

describe("nonprofit.send-acknowledgment", () => {
  it("queues a thank-you and records the channel", async () => {
    const r = await lensRun("nonprofit", "send-acknowledgment", { data: { name: "Bob", amount: 300, email: "b@x.com" } });
    assert.equal(r.ok, true);
    assert.equal(r.result.acknowledged, true);
    assert.equal(r.result.channel, "email");
    assert.match(r.result.message, /Bob/);
  });
});
