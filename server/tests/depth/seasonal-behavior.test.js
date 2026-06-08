// server/tests/depth/seasonal-behavior.test.js
//
// Behavioral coverage for the `seasonal` lens-action domain. Uses a LOCAL
// SHIM that captures the registered handlers, so the test exercises the real
// handler bodies without standing up the server. Asserts:
//   - events-list derives the EXACT real season-calendar content for a given
//     `season` param override (deterministic).
//   - challenge create → list → progress round-trip + clamp/complete math.
//   - competition create → list round-trip.
//   - validation rejections.

import test from "node:test";
import assert from "node:assert/strict";
import register from "../../domains/seasonal.js";
import { SEASONS, SEASON_NODE_YIELD_MULT } from "../../lib/seasons.js";

// ── Local shim ────────────────────────────────────────────────────
const H = new Map();
register((d, a, fn) => H.set(a, fn));
const run = (a, data = {}, params = {}, ctx = { actor: { userId: "u1" } }) =>
  H.get(a)(ctx, { data }, params);

test("seasonal: all expected macros register", () => {
  for (const m of [
    "events-list",
    "challenge-create",
    "challenges-list",
    "challenge-progress",
    "competition-create",
    "competitions-list",
  ]) {
    assert.ok(H.has(m), `missing macro ${m}`);
  }
  // substantive: events-list derives real season-calendar events
  assert.ok(run("events-list", {}, { season: 0 }).result.events.length >= 1);
});

test("events-list derives EXACT real season-calendar content for a season override", () => {
  // deep_winter (idx 5) — real narrative + real bias facts from seasons.js.
  const dw = SEASONS.find((s) => s.name === "deep_winter");
  const r = run("events-list", {}, { season: "deep_winter", day: 3, year: 2 });
  assert.equal(r.ok, true);
  const res = r.result;
  assert.equal(res.seasonName, "deep_winter");
  assert.equal(res.seasonIdx, dw.idx);
  assert.equal(res.day, 3);
  assert.equal(res.dayOfSeason, 3);
  assert.equal(res.year, 2);
  assert.equal(res.seasonLengthDays, 7);
  // Real bias facts must match seasons.js exactly.
  assert.equal(res.tempBias, dw.tempBias);
  assert.equal(res.humidityBias, dw.humidityBias);
  assert.equal(res.lightBias, dw.lightBias);
  assert.equal(res.narrative, dw.narrative);
  // deep_winter maps onto the component's 4-season quad as "winter".
  assert.equal(res.currentSeason, "winter");

  // The season-festival event is always present and carries the real narrative.
  const festival = res.events.find((e) => e.id === "season-deep_winter-y2");
  assert.ok(festival, "season festival event present");
  assert.equal(festival.type, "festival");
  assert.equal(festival.season, "winter");
  assert.equal(festival.description, dw.narrative);
  assert.ok(festival.name.includes("Year 2"));

  // deep_winter has herb 0.2 (<=0.5 → scarcity) and ore 1.2 (no event).
  const yieldTable = SEASON_NODE_YIELD_MULT.deep_winter;
  assert.equal(yieldTable.herb, 0.2);
  const herbScarcity = res.events.find((e) => e.id === "scarcity-deep_winter-herb");
  assert.ok(herbScarcity, "herb scarcity event derived from real yield mult");
  assert.equal(herbScarcity.type, "holiday");
  assert.ok(herbScarcity.description.includes("0.2"));
  // ore is 1.2 — neither bounty (>=1.3) nor scarcity (<=0.5) — no event.
  assert.equal(res.events.find((e) => e.id === "scarcity-deep_winter-ore"), undefined);
  assert.equal(res.events.find((e) => e.id === "yield-deep_winter-ore"), undefined);
});

test("events-list derives a bounty event for a high-yield resource (harvest)", () => {
  // harvest: herb 1.3, wood 1.3, meat 1.2, default 1.3. Bounty = mult >= 1.3.
  const r = run("events-list", {}, { season: "harvest", day: 1 });
  assert.equal(r.ok, true);
  assert.equal(r.result.seasonName, "harvest");
  assert.equal(r.result.currentSeason, "fall");
  const herbBounty = r.result.events.find((e) => e.id === "yield-harvest-herb");
  assert.ok(herbBounty, "herb bounty present in harvest");
  assert.equal(herbBounty.type, "challenge");
  assert.ok(herbBounty.description.includes("1.3"));
  // meat is 1.2 — below bounty threshold — no meat event.
  assert.equal(r.result.events.find((e) => e.id === "yield-harvest-meat"), undefined);
});

test("events-list accepts a numeric season idx override", () => {
  const r = run("events-list", {}, { season: 0 }); // spring
  assert.equal(r.ok, true);
  assert.equal(r.result.seasonName, "spring");
  assert.equal(r.result.currentSeason, "spring");
});

test("events-list day param clamps into [1, 7]", () => {
  const hi = run("events-list", {}, { season: "frost", day: 99 });
  assert.equal(hi.result.day, 7);
  const lo = run("events-list", {}, { season: "frost", day: -5 });
  assert.equal(lo.result.day, 1);
});

test("events-list with no override resolves the REAL current season", () => {
  const r = run("events-list", {}, {});
  assert.equal(r.ok, true);
  // Whatever the wall clock says, it must be one of the real 6 seasons.
  const names = SEASONS.map((s) => s.name);
  assert.ok(names.includes(r.result.seasonName));
  assert.ok(r.result.day >= 1 && r.result.day <= 7);
  assert.ok(r.result.events.length >= 1);
});

test("challenge: create → list → progress round-trip + completion math", () => {
  const ctx = { actor: { userId: "u-chal" } };
  const c = run(
    "challenge-create",
    {},
    { title: "Gather 10 herbs", objective: "gather:herb", maxProgress: 10, reward: { type: "cc", value: "100" } },
    ctx,
  );
  assert.equal(c.ok, true);
  const id = c.result.challenge.id;
  assert.equal(c.result.challenge.progress, 0);
  assert.equal(c.result.challenge.maxProgress, 10);

  const listed = run("challenges-list", {}, {}, ctx);
  assert.equal(listed.ok, true);
  assert.equal(listed.result.count, 1);
  assert.ok(listed.result.challenges.find((x) => x.id === id));

  // Advance by delta.
  const p1 = run("challenge-progress", {}, { id, delta: 4 }, ctx);
  assert.equal(p1.ok, true);
  assert.equal(p1.result.progress, 4);
  assert.equal(p1.result.percent, 40);
  assert.equal(p1.result.completed, false);

  // Overshoot clamps to max and completes.
  const p2 = run("challenge-progress", {}, { id, delta: 100 }, ctx);
  assert.equal(p2.result.progress, 10);
  assert.equal(p2.result.percent, 100);
  assert.equal(p2.result.completed, true);

  // Absolute progress set.
  const p3 = run("challenge-progress", {}, { id, progress: 2 }, ctx);
  assert.equal(p3.result.progress, 2);
  assert.equal(p3.result.completed, false);
});

test("challenge per-user isolation: u1 cannot see u2's challenges", () => {
  const ctxA = { actor: { userId: "iso-a" } };
  const ctxB = { actor: { userId: "iso-b" } };
  run("challenge-create", {}, { title: "A only", objective: "x", maxProgress: 1 }, ctxA);
  const listB = run("challenges-list", {}, {}, ctxB);
  assert.equal(listB.result.count, 0);
});

test("challenge validation rejections", () => {
  const noTitle = run("challenge-create", {}, { objective: "x", maxProgress: 5 });
  assert.equal(noTitle.ok, false);
  assert.ok(noTitle.error.includes("title"));

  const noObj = run("challenge-create", {}, { title: "t", maxProgress: 5 });
  assert.equal(noObj.ok, false);
  assert.ok(noObj.error.includes("objective"));

  const badMax = run("challenge-create", {}, { title: "t", objective: "x", maxProgress: 0 });
  assert.equal(badMax.ok, false);
  assert.ok(badMax.error.includes("maxProgress"));

  const missing = run("challenge-progress", {}, { id: "nope", delta: 1 });
  assert.equal(missing.ok, false);
  assert.ok(missing.error.includes("not found"));

  // create a real challenge then send a bad progress payload.
  const ctx = { actor: { userId: "u-badprog" } };
  const c = run("challenge-create", {}, { title: "t", objective: "x", maxProgress: 5 }, ctx);
  const noProg = run("challenge-progress", {}, { id: c.result.challenge.id }, ctx);
  assert.equal(noProg.ok, false);
  assert.ok(noProg.error.includes("required"));

  const badDelta = run("challenge-progress", {}, { id: c.result.challenge.id, delta: "abc" }, ctx);
  assert.equal(badDelta.ok, false);
});

test("competition: create → list round-trip", () => {
  const ctx = { actor: { userId: "u-comp" } };
  const c = run(
    "competition-create",
    {},
    {
      title: "Annual Build-Off",
      categories: ["architecture", "art"],
      prizes: ["10000 CC", "5000 CC", "title"],
      submissionDeadline: "2026-12-31",
    },
    ctx,
  );
  assert.equal(c.ok, true);
  const comp = c.result.competition;
  assert.ok(comp.categories.includes("architecture"));
  assert.ok(comp.prizes.includes("10000 CC"));
  assert.equal(comp.entryCount, 0);

  const listed = run("competitions-list", {}, {}, ctx);
  assert.equal(listed.ok, true);
  assert.equal(listed.result.count, 1);
  assert.ok(listed.result.competitions.find((x) => x.id === comp.id));
});

test("competition validation rejections", () => {
  const noTitle = run("competition-create", {}, { categories: ["x"] });
  assert.equal(noTitle.ok, false);
  assert.ok(noTitle.error.includes("title"));

  const noCat = run("competition-create", {}, { title: "t", categories: [] });
  assert.equal(noCat.ok, false);
  assert.ok(noCat.error.includes("category"));
});

test("lists start empty for a fresh user (no fabricated rows)", () => {
  const ctx = { actor: { userId: "fresh-user" } };
  assert.equal(run("challenges-list", {}, {}, ctx).result.count, 0);
  assert.equal(run("competitions-list", {}, {}, ctx).result.count, 0);
});
