// Behavioral macro tests for server/domains/filmstudios.js — the StudioBinder +
// DaVinci Resolve + Frame.io-shaped film-production suite the /lenses/film-studios
// lens drives. Domain string is "film-studios" (HYPHEN); the source file is
// filmstudios.js (no hyphen) and registers via the default-exported
// registerFilmStudiosActions(registerLensAction) through PATH 3 (domains/index.js).
//
// This file mirrors the REAL LENS_ACTIONS dispatch (server.js:39150):
// handlers are invoked as `handler(ctx, virtualArtifact, input)` — the 3-ARG
// convention — and several macros read their input from `artifact.data`
// (e.g. budgetBreakdown reads data.totalBudget, scheduleShoot reads data.scenes),
// so the harness sets virtualArtifact.data = input AND passes input as the 3rd
// param. A regression that confuses param positions surfaces here.
//
// These are NOT shape-only assertions. We assert ACTUAL computed values:
//   - budgetBreakdown percentages sum to 100% and amounts to totalBudget
//   - scheduleShoot groups scenes by location with the right day/week math
//   - validation-rejection paths return ok:false with a real error
//   - degrade-graceful: empty input returns ok:true guidance, never throws
//   - FAIL-CLOSED on poisoned numerics (Infinity / 1e400) — no non-finite output
//   - stateful CRUD round-trips (project → scene → budget line) with per-user
//     isolation and project-scoped reads
//
// The `vision` macro routes to the LLM/vision brain — it is NOT exercised here
// (no network/LLM); we only assert its missing-image validation path, which is
// pure and returns before any brain call.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFilmStudiosActions from "../domains/filmstudios.js";
import { up as upFilmStudioTables } from "../migrations/457_film_studio_productions.js";

const ACTIONS = new Map();
function registerLensAction(domain, name, fn) {
  assert.equal(domain, "film-studios", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
// Mirror the live dispatch: handler(ctx, virtualArtifact, input) with
// virtualArtifact.data === input (so the data-reading compute macros work).
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`film-studios.${name} not registered`);
  const virtualArtifact = { id: null, domain: "film-studios", type: "domain_action", data: input || {}, meta: {} };
  return fn(ctx, virtualArtifact, input || {});
}

before(() => { registerFilmStudiosActions(registerLensAction); });
beforeEach(() => { globalThis._concordSTATE = {}; });

const ctxA = { actor: { userId: "user_a" } };
const ctxB = { actor: { userId: "user_b" } };

// Helper: every numeric leaf in an object/array is finite.
function assertAllFinite(node, path = "root") {
  if (typeof node === "number") {
    assert.ok(Number.isFinite(node), `non-finite number at ${path}: ${node}`);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => assertAllFinite(v, `${path}[${i}]`));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) assertAllFinite(v, `${path}.${k}`);
  }
}

describe("film-studios — registration (the macros the lens reaches)", () => {
  it("registers the four pure compute macros + vision", () => {
    for (const m of ["budgetBreakdown", "scheduleShoot", "castAnalysis", "postProductionTimeline", "vision"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing film-studios.${m}`);
    }
  });

  it("registers the lens-driven CRUD + report macros", () => {
    for (const m of [
      "project-create", "project-list", "project-update", "project-delete",
      "scene-add", "scene-list", "scene-update", "scene-delete",
      "budget-line-add", "budget-list", "budget-line-update", "cost-report",
      "shoot-day-create", "stripboard", "call-sheet", "dood-report",
      "shot-add", "shot-list", "sequence-create", "clip-add", "cut-list",
      "version-create", "note-add", "note-list", "note-resolve",
      "film-dashboard", "screenplay", "storyboard", "festival-submit", "festival-list",
    ]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing film-studios.${m}`);
    }
  });
});

describe("film-studios — budgetBreakdown (pure money-ish calculator)", () => {
  it("percentages sum to 100% and amounts to the total budget", () => {
    const r = call("budgetBreakdown", ctxA, { totalBudget: 2_000_000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBudget, 2_000_000);
    const pctSum = r.result.breakdown.reduce((a, b) => a + b.percentage, 0);
    assert.equal(pctSum, 100, "percentages must sum to exactly 100");
    const amtSum = r.result.breakdown.reduce((a, b) => a + b.amount, 0);
    assert.equal(amtSum, 2_000_000, "category amounts must sum to the total budget");
    // exact per-category amounts (0.25 / 0.40 / 0.15 / 0.15 / 0.05)
    const byCat = Object.fromEntries(r.result.breakdown.map((b) => [b.category, b.amount]));
    assert.equal(byCat["above the line"], 500_000);
    assert.equal(byCat["below the line"], 800_000);
    assert.equal(byCat["post production"], 300_000);
    assert.equal(byCat["marketing"], 300_000);
    assert.equal(byCat["contingency"], 100_000);
    assert.equal(r.result.tip, "Consider completion bond insurance"); // > 1M
  });

  it("indie budget gets the indie tip + finite breakdown", () => {
    const r = call("budgetBreakdown", ctxA, { totalBudget: 50_000 });
    assert.equal(r.ok, true);
    assert.equal(r.result.tip, "Indie budget — maximize crew flexibility");
    assertAllFinite(r.result);
  });

  it("degrades gracefully on empty input (zeroed breakdown, never throws)", () => {
    const r = call("budgetBreakdown", ctxA, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBudget, 0);
    assert.equal(r.result.breakdown.reduce((a, b) => a + b.amount, 0), 0);
    assertAllFinite(r.result);
  });

  it("FAILS CLOSED on Infinity — no non-finite amounts minted", () => {
    const r = call("budgetBreakdown", ctxA, { totalBudget: "Infinity" });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalBudget, 0, "Infinity clamps to 0");
    assertAllFinite(r.result);
    assert.equal(r.result.breakdown.reduce((a, b) => a + b.amount, 0), 0);
  });

  it("FAILS CLOSED on 1e400 (overflow → Infinity) and on NaN/negative/garbage", () => {
    for (const poison of ["1e400", "1e500", NaN, "NaN", -5, -1e9, "not-a-number", null, undefined]) {
      const r = call("budgetBreakdown", ctxA, { totalBudget: poison });
      assert.equal(r.ok, true, `poison=${poison} should still return ok`);
      assert.equal(r.result.totalBudget, 0, `poison=${poison} clamps to 0`);
      assertAllFinite(r.result);
    }
  });

  it("accepts a numeric-string budget and computes correctly", () => {
    const r = call("budgetBreakdown", ctxA, { totalBudget: "1000000" });
    assert.equal(r.result.totalBudget, 1_000_000);
    assert.equal(r.result.tip, "Indie budget — maximize crew flexibility"); // not > 1M (strict)
    assertAllFinite(r.result);
  });
});

describe("film-studios — scheduleShoot (location grouping + day/week math)", () => {
  it("groups scenes by location with correct day estimates", () => {
    const scenes = [
      { location: "Beach", cast: ["Ana", "Bo"] },
      { location: "Beach", cast: ["Ana"] },
      { location: "Beach", cast: ["Cy"] },
      { location: "Beach", cast: ["Ana"] }, // 4 Beach scenes → ceil(4/3)=2 days
      { location: "Loft", cast: ["Di"] },   // 1 Loft scene  → ceil(1/3)=1 day
    ];
    const r = call("scheduleShoot", ctxA, { scenes });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalScenes, 5);
    const beach = r.result.locations.find((l) => l.location === "Beach");
    const loft = r.result.locations.find((l) => l.location === "Loft");
    assert.equal(beach.scenes, 4);
    assert.equal(beach.estimatedDays, 2);
    assert.deepEqual([...beach.cast].sort(), ["Ana", "Bo", "Cy"]); // deduped union
    assert.equal(loft.scenes, 1);
    assert.equal(loft.estimatedDays, 1);
    assert.equal(r.result.totalShootDays, 3); // 2 + 1
    assert.equal(r.result.totalWeeks, 1);     // ceil(3/5)
    assert.equal(r.result.avgScenesPerDay, 1.7); // round(5/3*10)/10
    assertAllFinite(r.result);
  });

  it("scenes with no location fall under 'Studio'", () => {
    const r = call("scheduleShoot", ctxA, { scenes: [{ cast: ["X"] }, {}] });
    assert.equal(r.ok, true);
    assert.equal(r.result.locations[0].location, "Studio");
    assert.equal(r.result.locations[0].scenes, 2);
  });

  it("degrades gracefully on empty scenes (guidance message, never throws)", () => {
    const r = call("scheduleShoot", ctxA, {});
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add scenes/i);
    const r2 = call("scheduleShoot", ctxA, { scenes: [] });
    assert.equal(r2.ok, true);
    assert.match(r2.result.message, /Add scenes/i);
  });
});

describe("film-studios — castAnalysis (per-cast cost calculator)", () => {
  it("computes per-member and total cost", () => {
    const cast = [
      { name: "Lead A", role: "lead", sceneCount: 30, dailyRate: 1500 },     // 30*1500/3 = 15000
      { name: "Supp B", role: "supporting", sceneCount: 9, dailyRate: 600 }, // 9*600/3 = 1800
    ];
    const r = call("castAnalysis", ctxA, { cast });
    assert.equal(r.ok, true);
    assert.equal(r.result.totalCast, 2);
    assert.equal(r.result.leads, 1);
    assert.equal(r.result.cast[0].totalCost, 15_000);
    assert.equal(r.result.cast[1].totalCost, 1_800);
    assert.equal(r.result.totalCastBudget, 16_800);
    assert.equal(r.result.topCost, "Lead A");
    assertAllFinite(r.result);
  });

  it("FAILS CLOSED on a poisoned dailyRate (Infinity / 1e400) — no non-finite cost", () => {
    for (const poison of ["Infinity", "1e400", -1, NaN]) {
      const r = call("castAnalysis", ctxA, { cast: [{ name: "X", sceneCount: 10, dailyRate: poison }] });
      assert.equal(r.ok, true, `poison=${poison}`);
      assertAllFinite(r.result);
      assert.equal(r.result.cast[0].totalCost, 0, `poison=${poison} clamps cost to 0`);
      assert.equal(r.result.totalCastBudget, 0);
    }
  });

  it("FAILS CLOSED on a poisoned sceneCount", () => {
    const r = call("castAnalysis", ctxA, { cast: [{ name: "X", sceneCount: "1e400", dailyRate: 500 }] });
    assert.equal(r.ok, true);
    assertAllFinite(r.result);
    // parseInt("1e400") would be 1; finiteInt keeps it bounded → 1*500/3
    assert.ok(Number.isFinite(r.result.cast[0].totalCost));
  });

  it("degrades gracefully on empty cast", () => {
    const r = call("castAnalysis", ctxA, { cast: [] });
    assert.equal(r.ok, true);
    assert.match(r.result.message, /Add cast/i);
  });
});

describe("film-studios — postProductionTimeline", () => {
  it("computes phase weeks deterministically", () => {
    // runtime 90 → baseWeeks ceil(90/15)=6; edit=6; sound=ceil(6*0.6)=4;
    // vfx ceil(120/10)=12; color ceil(6*0.3)=2; total = 6 + max(4,12) + 2 = 20
    const r = call("postProductionTimeline", ctxA, { runtimeMinutes: 90, vfxShots: 120 });
    assert.equal(r.ok, true);
    const byPhase = Object.fromEntries(r.result.phases.map((p) => [p.phase, p.weeks]));
    assert.equal(byPhase["Edit"], 6);
    assert.equal(byPhase["Sound Design & Mix"], 4);
    assert.equal(byPhase["VFX"], 12);
    assert.equal(byPhase["Color Grading"], 2);
    assert.equal(r.result.totalWeeks, 20);
    assertAllFinite(r.result);
  });

  it("uses defaults (runtime 90, vfx 0) and stays finite on garbage", () => {
    const r = call("postProductionTimeline", ctxA, { runtimeMinutes: "garbage", vfxShots: "1e400" });
    assert.equal(r.ok, true);
    assertAllFinite(r.result);
    assert.ok(r.result.totalWeeks > 0);
  });
});

describe("film-studios — vision (validation only, no brain call)", () => {
  it("rejects when neither imageB64 nor imageUrl is supplied", async () => {
    const r = await call("vision", ctxA, {});
    assert.equal(r.ok, false);
    assert.match(r.error, /imageB64 or imageUrl required/);
  });
});

describe("film-studios — stateful CRUD round-trip + per-user isolation", () => {
  it("project → scene → budget line round-trips with correct reads", () => {
    const pc = call("project-create", ctxA, { title: "My Feature", format: "feature" });
    assert.equal(pc.ok, true);
    const projectId = pc.result.project.id;
    assert.ok(projectId);

    const pl = call("project-list", ctxA, {});
    assert.equal(pl.result.count, 1);
    assert.equal(pl.result.projects[0].title, "My Feature");

    const sa = call("scene-add", ctxA, { projectId, location: "INT KITCHEN", intExt: "INT", timeOfDay: "DAY", pageEighths: 12 });
    assert.equal(sa.ok, true);
    assert.equal(sa.result.scene.slugline, "INT. INT KITCHEN - DAY");

    const sl = call("scene-list", ctxA, { projectId });
    assert.equal(sl.result.count, 1);
    assert.equal(sl.result.totalPages, 1.5); // 12/8

    const ba = call("budget-line-add", ctxA, { projectId, department: "production", description: "Camera", estimated: 5000, actual: 5500 });
    assert.equal(ba.ok, true);
    const bl = call("budget-list", ctxA, { projectId });
    assert.equal(bl.result.totalEstimated, 5000);
    assert.equal(bl.result.totalActual, 5500);
    assert.equal(bl.result.variance, 500);

    const cr = call("cost-report", ctxA, { projectId });
    assert.equal(cr.ok, true);
    assert.equal(cr.result.overBudget, true);
    assert.equal(cr.result.overrunLines, 1);
    assertAllFinite(cr.result);
  });

  it("cost-report fails CLOSED to finite even with a poisoned budget actual via budget-line-add", () => {
    const projectId = call("project-create", ctxA, { title: "P" }).result.project.id;
    // budget-line-add uses fmNum which already clamps non-finite to 0 — assert that holds end-to-end
    call("budget-line-add", ctxA, { projectId, description: "X", estimated: "1e400", actual: "Infinity" });
    const cr = call("cost-report", ctxA, { projectId });
    assert.equal(cr.ok, true);
    assertAllFinite(cr.result);
    assert.equal(cr.result.totalEstimated, 0);
    assert.equal(cr.result.totalActual, 0);
  });

  it("user_b cannot see user_a's projects (per-user isolation)", () => {
    call("project-create", ctxA, { title: "A-only" });
    const plB = call("project-list", ctxB, {});
    assert.equal(plB.result.count, 0);
  });

  it("validation rejects: empty title, missing project, missing scene", () => {
    assert.equal(call("project-create", ctxA, { title: "  " }).ok, false);
    assert.equal(call("scene-add", ctxA, { projectId: "nope", location: "X" }).error, "project not found");
    const pid = call("project-create", ctxA, { title: "Has Project" }).result.project.id;
    assert.equal(call("scene-add", ctxA, { projectId: pid, location: "" }).error, "scene location required");
    assert.equal(call("budget-line-add", ctxA, { projectId: pid, description: "" }).error, "line description required");
  });

  it("STATE-unavailable degrades to a structured error, never throws", () => {
    delete globalThis._concordSTATE;
    const r = call("project-list", ctxA, {});
    assert.equal(r.ok, false);
    assert.equal(r.error, "STATE unavailable");
  });
});

describe("film-studios — schedule report math (stripboard) is finite", () => {
  it("stripboard groups scheduled scenes by shoot day", () => {
    const projectId = call("project-create", ctxA, { title: "Sched" }).result.project.id;
    const sc = call("scene-add", ctxA, { projectId, location: "Park", pageEighths: 8 }).result.scene;
    const day = call("shoot-day-create", ctxA, { projectId, date: "2026-07-01" }).result.day;
    call("strip-assign", ctxA, { sceneId: sc.id, shootDayId: day.id, stripOrder: 0 });
    const sb = call("stripboard", ctxA, { projectId });
    assert.equal(sb.ok, true);
    assert.equal(sb.result.scheduledCount, 1);
    assert.equal(sb.result.days[0].sceneCount, 1);
    assert.equal(sb.result.days[0].pageEighths, 8);
    assertAllFinite(sb.result);
  });
});

// ── F4 (absent-lifecycle): production rename + scene/production edit-delete
// survive a process restart, not just the in-memory session they were
// created in. `project-update` is new; `project-delete`/`scene-update`/
// `scene-delete` previously only ever checked the in-memory Map, which
// `project-list`/`scene-list`'s DB-row merge never writes back into — so
// editing/deleting anything read back after a restart used to silently
// 404 even though the row was real.
describe("film-studios — lifecycle survives a restart (real sqlite, no in-memory carryover)", () => {
  function freshDb() {
    const db = new Database(":memory:");
    upFilmStudioTables(db);
    return db;
  }
  function ctxWithDb(db, userId) {
    return { actor: { userId }, db };
  }

  it("project-update renames a title and persists it to the row", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "Working Title" }).result.project.id;

    const upd = call("project-update", ctx, { id: projectId, title: "The Real Title", format: "short" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.project.title, "The Real Title");
    assert.equal(upd.result.project.format, "short");

    const row = db.prepare("SELECT title, format FROM film_studio_productions WHERE id = ?").get(projectId);
    assert.equal(row.title, "The Real Title");
    assert.equal(row.format, "short");

    // simulate a process restart: a fresh in-memory STATE, same db
    globalThis._concordSTATE = {};
    const listed = call("project-list", ctx, {}).result.projects;
    assert.equal(listed.find((p) => p.id === projectId)?.title, "The Real Title");
  });

  it("project-update rejects an empty title and a missing project", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "P" }).result.project.id;
    assert.equal(call("project-update", ctx, { id: projectId, title: "  " }).ok, false);
    assert.equal(call("project-update", ctx, { id: "nope", title: "X" }).error, "project not found");
  });

  it("project-delete and project-update both work on a project only known via the DB row (post-restart)", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "Survives" }).result.project.id;

    // Drop the in-memory session entirely -- only the DB row remains.
    globalThis._concordSTATE = {};
    const renamed = call("project-update", ctx, { id: projectId, title: "Renamed After Restart" });
    assert.equal(renamed.ok, true, JSON.stringify(renamed));
    assert.equal(renamed.result.project.title, "Renamed After Restart");

    globalThis._concordSTATE = {};
    const del = call("project-delete", ctx, { id: projectId });
    assert.equal(del.ok, true, JSON.stringify(del));
    const row = db.prepare("SELECT id FROM film_studio_productions WHERE id = ?").get(projectId);
    assert.equal(row, undefined);
  });

  it("scene-update edits a scene and persists it; survives a restart too", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "Scenes" }).result.project.id;
    const sceneId = call("scene-add", ctx, {
      projectId, location: "Desert Highway", intExt: "EXT", timeOfDay: "DAY",
    }).result.scene.id;

    const upd = call("scene-update", ctx, { id: sceneId, timeOfDay: "NIGHT", location: "Desert Highway (night shoot)" });
    assert.equal(upd.ok, true);
    assert.equal(upd.result.scene.slugline, "EXT. Desert Highway (night shoot) - NIGHT");

    const row = db.prepare("SELECT location, time_of_day FROM film_studio_scenes WHERE id = ?").get(sceneId);
    assert.equal(row.location, "Desert Highway (night shoot)");
    assert.equal(row.time_of_day, "NIGHT");

    // Simulate a restart, then edit again purely from the DB row.
    globalThis._concordSTATE = {};
    const upd2 = call("scene-update", ctx, { id: sceneId, number: "12A" });
    assert.equal(upd2.ok, true, JSON.stringify(upd2));
    assert.equal(upd2.result.scene.number, "12A");
    // The field edited before the simulated restart must not have been lost.
    assert.equal(upd2.result.scene.timeOfDay, "NIGHT");
  });

  it("scene-delete removes a scene known only via its DB row (post-restart)", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "Scenes2" }).result.project.id;
    const sceneId = call("scene-add", ctx, { projectId, location: "Office" }).result.scene.id;

    globalThis._concordSTATE = {};
    const del = call("scene-delete", ctx, { id: sceneId });
    assert.equal(del.ok, true, JSON.stringify(del));
    const row = db.prepare("SELECT id FROM film_studio_scenes WHERE id = ?").get(sceneId);
    assert.equal(row, undefined);
  });

  it("the F3 slugline bug is a frontend symptom: structured fields drive a correct slugline", () => {
    const db = freshDb();
    const ctx = ctxWithDb(db, "user_a");
    const projectId = call("project-create", ctx, { title: "Slug" }).result.project.id;
    const scene = call("scene-add", ctx, { projectId, location: "Desert Highway", intExt: "EXT", timeOfDay: "DAY" }).result.scene;
    assert.equal(scene.slugline, "EXT. Desert Highway - DAY");
    // Without intExt/timeOfDay (the old frontend's call shape), defaults kick in --
    // this is the behavior the review found, not a backend bug.
    const defaulted = call("scene-add", ctx, { projectId, location: "EXT. Desert Highway" }).result.scene;
    assert.equal(defaulted.slugline, "INT. EXT. Desert Highway - DAY");
  });
});
