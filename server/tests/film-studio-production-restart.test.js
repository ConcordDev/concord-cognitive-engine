// A production title and its scene heading are stored in
// film_studio_productions and film_studio_scenes. Clearing the in-memory
// filmLens (what a process restart does) still lists both.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerFilmStudiosActions from "../domains/filmstudios.js";
import { up, down } from "../migrations/457_film_studio_productions.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`film-studios.${name}`);
  assert.ok(fn, `film-studios.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerFilmStudiosActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  globalThis._concordSTATE = { db, filmLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_prod" }, userId: "user_prod", db };

describe("film studio production restart", () => {
  it("lists the title and the scene after the in-memory lens is dropped", () => {
    const created = call("project-create", ctx, { title: "  Door production  " });
    assert.equal(created.ok, true);
    const id = created.result.project.id;
    assert.equal(created.result.project.title, "Door production");
    const scene = call("scene-add", ctx, { projectId: id, location: "  Kitchen  " });
    assert.equal(scene.ok, true);
    assert.equal(scene.result.scene.slugline, "INT. Kitchen - DAY");
    const sceneId = scene.result.scene.id;

    globalThis._concordSTATE = { db, filmLens: {} };
    const list = call("project-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.projects[0].id, id);
    assert.equal(list.result.projects[0].title, "Door production");
    assert.equal(list.result.projects[0].logline, null);

    const scenes = call("scene-list", ctx, { projectId: id });
    assert.equal(scenes.result.count, 1);
    assert.equal(scenes.result.scenes[0].id, sceneId);
    assert.equal(scenes.result.scenes[0].location, "Kitchen");
    assert.equal(scenes.result.scenes[0].slugline, "INT. Kitchen - DAY");
    assert.equal(scenes.result.scenes[0].shootDayNumber, null);
    assert.deepEqual(scenes.result.scenes[0].breakdownElements, []);
  });

  it("adds a scene to a production that exists only in sqlite", () => {
    const created = call("project-create", ctx, { title: "Held production" });
    const id = created.result.project.id;
    globalThis._concordSTATE = { db, filmLens: {} };
    const scene = call("scene-add", ctx, { projectId: id, location: "Hall" });
    assert.equal(scene.ok, true);
    globalThis._concordSTATE = { db, filmLens: {} };
    const scenes = call("scene-list", ctx, { projectId: id });
    assert.equal(scenes.result.scenes[0].location, "Hall");
    assert.equal(scenes.result.scenes[0].slugline, "INT. Hall - DAY");
  });

  it("a blank title is rejected and stores nothing", () => {
    const created = call("project-create", ctx, { title: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "project title required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM film_studio_productions").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM film_studio_scenes").get().n, 0);
  });

  it("a blank location is rejected and stores no scene", () => {
    const created = call("project-create", ctx, { title: "Door production" });
    const scene = call("scene-add", ctx, { projectId: created.result.project.id, location: "   " });
    assert.equal(scene.ok, false);
    assert.equal(scene.error, "scene location required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM film_studio_scenes").get().n, 0);
  });

  it("down drops both tables", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='film_studio_productions'").get(),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='film_studio_scenes'").get(),
      undefined,
    );
  });
});
