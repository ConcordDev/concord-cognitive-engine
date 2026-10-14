// INC-SWEEP studio F1 — Create Project returned 200 via lens artifacts while
// dashboard-summary / project-list read STATE.studioLens (empty). Persistence
// must land in studioLens and survive the same snapshot round-trip a restart
// performs (LENS_STATE_KEYS + serializeLensState / hydrateLensState).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerStudioActions from "../domains/studio.js";
import { serializeLensState, hydrateLensState, LENS_STATE_KEYS } from "../lib/lens-state-persistence.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`studio.${name}`);
  if (!fn) throw new Error(`studio.${name} not registered`);
  return fn(ctx, { id: null, data: params, meta: {} }, params);
}

function restartFromSnapshot() {
  const persisted = JSON.parse(JSON.stringify(serializeLensState(globalThis._concordSTATE)));
  const next = {};
  hydrateLensState(next, persisted);
  globalThis._concordSTATE = next;
  return persisted;
}

const ctxA = { actor: { userId: "user_studio_a" }, userId: "user_studio_a" };
const ctxB = { actor: { userId: "user_studio_b" }, userId: "user_studio_b" };

before(() => { registerStudioActions(register); });

beforeEach(() => {
  globalThis._concordSTATE = {};
  globalThis._concordSaveStateDebounced = () => {};
});

describe("studio project create survives a snapshot restart", () => {
  it("registers studioLens on the snapshot key list", () => {
    assert.ok(LENS_STATE_KEYS.includes("studioLens"));
  });

  it("create → dashboard-summary + project-list still see it after restart", () => {
    const created = call("project-create", ctxA, {
      name: "Sweep Studio 7shq68",
      bpm: 128,
      key: "C",
      scale: "major",
      genre: "sweep",
      timeSignature: [4, 4],
      daw: {
        id: "client_tmp",
        title: "Sweep Studio 7shq68",
        bpm: 128,
        key: "C",
        scale: "major",
        timeSignature: [4, 4],
        genre: "sweep",
        tracks: [],
        audioBuffers: {},
      },
    });
    assert.equal(created.ok, true, JSON.stringify(created));
    const id = created.result.project.id;
    assert.ok(id.startsWith("proj_"));
    assert.equal(created.result.project.name, "Sweep Studio 7shq68");
    assert.equal(created.result.project.bpm, 128);
    assert.ok(created.result.project.daw, "daw snapshot stored on create");
    assert.equal(created.result.project.daw.title, "Sweep Studio 7shq68");

    const before = call("dashboard-summary", ctxA, {});
    assert.equal(before.ok, true);
    assert.equal(before.result.projectCount, 1);
    assert.equal(before.result.latestProject.id, id);
    assert.equal(before.result.latestProject.name, "Sweep Studio 7shq68");

    const blob = restartFromSnapshot();
    assert.equal(blob.studioLens.projects.__type, "Map");
    assert.ok(JSON.stringify(blob.studioLens).includes("Sweep Studio 7shq68"));
    assert.ok(globalThis._concordSTATE.studioLens.projects instanceof Map);

    const listed = call("project-list", ctxA, {});
    assert.equal(listed.ok, true);
    assert.equal(listed.result.projects.length, 1);
    assert.equal(listed.result.projects[0].id, id);
    assert.equal(listed.result.projects[0].name, "Sweep Studio 7shq68");
    assert.equal(listed.result.projects[0].bpm, 128);
    assert.equal(listed.result.projects[0].hasDaw, true);

    const dash = call("dashboard-summary", ctxA, {});
    assert.equal(dash.result.projectCount, 1);
    assert.equal(dash.result.latestProject.id, id);

    const got = call("project-get", ctxA, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.project.daw.title, "Sweep Studio 7shq68");
    assert.equal(got.result.project.daw.bpm, 128);
  });

  it("project-save updates daw across a restart", () => {
    const created = call("project-create", ctxA, { name: "Draft", bpm: 100 });
    const id = created.result.project.id;
    const saved = call("project-save", ctxA, {
      id,
      name: "Draft v2",
      bpm: 110,
      daw: { id, title: "Draft v2", bpm: 110, tracks: [{ id: "t1", name: "Kick" }], audioBuffers: {} },
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.result.project.name, "Draft v2");

    restartFromSnapshot();

    const got = call("project-get", ctxA, { id });
    assert.equal(got.result.project.name, "Draft v2");
    assert.equal(got.result.project.bpm, 110);
    assert.equal(got.result.project.daw.tracks.length, 1);
    assert.equal(got.result.project.daw.tracks[0].name, "Kick");
  });

  it("acct2 does not see acct1 projects after restart", () => {
    call("project-create", ctxA, { name: "Private Sweep", bpm: 120 });
    restartFromSnapshot();
    assert.equal(call("project-list", ctxB, {}).result.projects.length, 0);
    assert.equal(call("dashboard-summary", ctxB, {}).result.projectCount, 0);
  });

  it("project-get after restart still returns name+bpm for Keep DTU", () => {
    const created = call("project-create", ctxA, { name: "Keep Me", bpm: 128, key: "D" });
    const id = created.result.project.id;
    restartFromSnapshot();
    const got = call("project-get", ctxA, { id });
    assert.equal(got.ok, true);
    assert.equal(got.result.project.id, id);
    assert.equal(got.result.project.name, "Keep Me");
    assert.equal(got.result.project.bpm, 128);
  });
});
