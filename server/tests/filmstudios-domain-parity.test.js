// Contract tests for the film-studios StudioBinder + DaVinci Resolve +
// Frame.io 2026-parity production suite (projects, scenes, breakdown,
// shots, stripboard, call sheets, budget, cast/crew, edit timeline,
// timecoded review).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerFilmStudiosActions from "../domains/filmstudios.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`film-studios.${name}`);
  assert.ok(fn, `film-studios.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

before(() => { registerFilmStudiosActions(register); });
beforeEach(() => {
  globalThis._concordSTATE = { dtus: new Map() };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctxA = { actor: { userId: "user_a" }, userId: "user_a" };
const ctxB = { actor: { userId: "user_b" }, userId: "user_b" };

function newProject(ctx = ctxA) {
  const r = call("project-create", ctx, { title: "The Long Cut", format: "feature" });
  assert.equal(r.ok, true);
  return r.result.project.id;
}

describe("film-studios.project-*", () => {
  it("creates, lists and deletes projects with cascade", () => {
    const pid = newProject();
    call("scene-add", ctxA, { projectId: pid, location: "Diner", intExt: "INT" });
    assert.equal(call("project-list", ctxA, {}).result.count, 1);
    assert.equal(call("scene-list", ctxA, { projectId: pid }).result.count, 1);
    call("project-delete", ctxA, { id: pid });
    assert.equal(call("project-list", ctxA, {}).result.count, 0);
    assert.equal(call("scene-list", ctxA, { projectId: pid }).result.count, 0);
  });

  it("isolates projects per user", () => {
    newProject(ctxA);
    assert.equal(call("project-list", ctxB, {}).result.count, 0);
  });
});

describe("film-studios.scene-* and breakdown", () => {
  it("adds scenes with a computed slugline and page totals", () => {
    const pid = newProject();
    const r = call("scene-add", ctxA, {
      projectId: pid, intExt: "EXT", location: "Rooftop", timeOfDay: "NIGHT", pageEighths: 12,
    });
    assert.equal(r.result.scene.slugline, "EXT. Rooftop - NIGHT");
    const list = call("scene-list", ctxA, { projectId: pid });
    assert.equal(list.result.totalPages, 1.5);
  });

  it("tags breakdown elements and summarises by category", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Garage" }).result.scene.id;
    call("breakdown-tag", ctxA, { sceneId: sid, category: "props", name: "Wrench" });
    call("breakdown-tag", ctxA, { sceneId: sid, category: "vehicles", name: "1968 Mustang" });
    const scene = call("scene-list", ctxA, { projectId: pid }).result.scenes[0];
    assert.equal(scene.breakdownElements.length, 2);
    const summary = call("breakdown-summary", ctxA, { projectId: pid });
    assert.equal(summary.result.byCategory.props, 1);
    assert.equal(summary.result.totalElements, 2);
  });

  it("rejects a scene with no location", () => {
    const pid = newProject();
    assert.equal(call("scene-add", ctxA, { projectId: pid, location: "" }).ok, false);
  });
});

describe("film-studios.shot-list", () => {
  it("adds shots to a scene", () => {
    const pid = newProject();
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Hallway" }).result.scene.id;
    call("shot-add", ctxA, { sceneId: sid, size: "CU", movement: "dolly" });
    call("shot-add", ctxA, { sceneId: sid, size: "WS" });
    assert.equal(call("shot-list", ctxA, { sceneId: sid }).result.count, 2);
    assert.equal(call("shot-list", ctxA, { projectId: pid }).result.count, 2);
  });
});

describe("film-studios.scheduling — stripboard & call sheet", () => {
  it("assigns scenes to shoot days and builds a stripboard", () => {
    const pid = newProject();
    const s1 = call("scene-add", ctxA, { projectId: pid, location: "Bar", pageEighths: 8 }).result.scene.id;
    const s2 = call("scene-add", ctxA, { projectId: pid, location: "Street" }).result.scene.id;
    const day = call("shoot-day-create", ctxA, { projectId: pid, location: "Downtown" }).result.day;
    call("strip-assign", ctxA, { sceneId: s1, shootDayId: day.id });
    const board = call("stripboard", ctxA, { projectId: pid });
    assert.equal(board.result.days[0].sceneCount, 1);
    assert.equal(board.result.days[0].pageEighths, 8);
    assert.equal(board.result.unscheduled.length, 1);
    assert.ok(s2);
  });

  it("generates a call sheet with aggregated cast", () => {
    const pid = newProject();
    const cast = call("cast-add", ctxA, { projectId: pid, name: "Jane Doe", characterName: "RILEY" }).result.member;
    const sid = call("scene-add", ctxA, { projectId: pid, location: "Office", castIds: [cast.id] }).result.scene.id;
    const day = call("shoot-day-create", ctxA, { projectId: pid }).result.day;
    call("strip-assign", ctxA, { sceneId: sid, shootDayId: day.id });
    const sheet = call("call-sheet", ctxA, { shootDayId: day.id });
    assert.equal(sheet.result.sceneCount, 1);
    assert.equal(sheet.result.cast.length, 1);
    assert.equal(sheet.result.cast[0].characterName, "RILEY");
  });
});

describe("film-studios.budget", () => {
  it("adds budget lines and rolls up by department with variance", () => {
    const pid = newProject();
    call("budget-line-add", ctxA, { projectId: pid, department: "production", description: "Camera package", estimated: 5000, actual: 5400 });
    call("budget-line-add", ctxA, { projectId: pid, department: "post_production", description: "Color grade", estimated: 2000, actual: 1800 });
    const b = call("budget-list", ctxA, { projectId: pid });
    assert.equal(b.result.totalEstimated, 7000);
    assert.equal(b.result.totalActual, 7200);
    assert.equal(b.result.variance, 200);
    assert.equal(b.result.byDept.production.actual, 5400);
  });
});

describe("film-studios.cast & crew", () => {
  it("adds and lists cast and crew scoped to a project", () => {
    const pid = newProject();
    call("cast-add", ctxA, { projectId: pid, name: "Actor One", role: "lead", dailyRate: 1200 });
    call("crew-add", ctxA, { projectId: pid, name: "Gaffer Joe", department: "electric", position: "Gaffer" });
    assert.equal(call("cast-list", ctxA, { projectId: pid }).result.count, 1);
    assert.equal(call("crew-list", ctxA, { projectId: pid }).result.count, 1);
  });
});

describe("film-studios.edit timeline", () => {
  it("builds a cut list with running timecode", () => {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel 1", fps: "24" }).result.sequence;
    call("clip-add", ctxA, { sequenceId: seq.id, name: "Establishing", track: "V1", durationSec: 5 });
    call("clip-add", ctxA, { sequenceId: seq.id, name: "Dialogue", track: "V1", durationSec: 10 });
    const cut = call("cut-list", ctxA, { sequenceId: seq.id });
    assert.equal(cut.result.tracks.V1.length, 2);
    assert.equal(cut.result.tracks.V1[0].startTimecode, "00:00:00:00");
    assert.equal(cut.result.tracks.V1[1].startTimecode, "00:00:05:00");
    // 5s + 10s at 24fps = 15s total
    assert.equal(cut.result.totalRuntime, "00:00:15:00");
  });

  it("rejects a clip with no duration", () => {
    const pid = newProject();
    const seq = call("sequence-create", ctxA, { projectId: pid, name: "Reel 2" }).result.sequence;
    assert.equal(call("clip-add", ctxA, { sequenceId: seq.id, name: "X" }).ok, false);
  });
});

describe("film-studios.review — versions & timecoded notes", () => {
  it("creates versions and timecoded notes, sorted by timecode", () => {
    const pid = newProject();
    const v = call("version-create", ctxA, { projectId: pid, label: "Rough Cut v1", stage: "rough_cut" }).result.version;
    call("note-add", ctxA, { versionId: v.id, timecodeSec: 90, body: "Trim this beat" });
    const n1 = call("note-add", ctxA, { versionId: v.id, timecodeSec: 30, body: "Color is off here" }).result.note;
    const list = call("note-list", ctxA, { versionId: v.id });
    assert.equal(list.result.notes[0].timecodeSec, 30);
    assert.equal(list.result.openCount, 2);
    call("note-resolve", ctxA, { id: n1.id, resolved: true });
    assert.equal(call("note-list", ctxA, { versionId: v.id }).result.openCount, 1);
    assert.equal(call("version-list", ctxA, { projectId: pid }).result.versions[0].openNotes, 1);
  });
});

describe("film-studios.film-dashboard", () => {
  it("rolls up the whole project at a glance", () => {
    const pid = newProject();
    call("scene-add", ctxA, { projectId: pid, location: "Loft", pageEighths: 8 });
    call("cast-add", ctxA, { projectId: pid, name: "Lead" });
    call("budget-line-add", ctxA, { projectId: pid, description: "Lenses", estimated: 3000, actual: 2500 });
    const d = call("film-dashboard", ctxA, { projectId: pid });
    assert.equal(d.result.scenes, 1);
    assert.equal(d.result.pages, 1);
    assert.equal(d.result.cast, 1);
    assert.equal(d.result.budgetEstimated, 3000);
    assert.equal(d.result.budgetActual, 2500);
  });
});
