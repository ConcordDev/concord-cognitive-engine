// B2 film-studios D4 fix return (F6) — the shared export read
// (lib/lens-export.js) serves canonical artifacts + REGISTERED
// provider rows; productions live in STATE.filmLens and the lens
// registered no provider, so both Export items produced nothing over
// standing productions. The provider registers the caller's
// productions (project-list read) with their scenes + derived
// sluglines. Read-only: an export creates no state.
import { test } from "node:test";
import assert from "node:assert/strict";
import registerFilmStudiosActions from "../domains/filmstudios.js";
import { collectLensExport, hasLensExportProvider, _clearLensExportProvidersForTests } from "../lib/lens-export.js";

const noArtifacts = async () => ({ ok: true, artifacts: [] });
const collect = (ctx) => collectLensExport({ runMacro: noArtifacts, domain: "film-studios", ctx });

function setup() {
  _clearLensExportProvidersForTests();
  registerFilmStudiosActions(() => {});
  const filmLens = { projects: new Map(), scenes: new Map() };
  globalThis._concordSTATE = { filmLens };
  return filmLens;
}
const ctx = (userId) => ({ actor: { userId } });

test("the film-studios export provider is registered and state-backed", async () => {
  setup();
  assert.equal(hasLensExportProvider("film-studios"), true);
  const out = await collect(ctx("u-1"));
  assert.equal(out.ok, true);
  assert.equal(out.stateBacked, true);
});

test("a production exports with its scenes and derived sluglines", async () => {
  const filmLens = setup();
  filmLens.projects.set("u-1", [
    { id: "proj_1", title: "Desert Reel", format: "feature", logline: "A long road.", createdAt: "2026-11-01T00:00:00.000Z" },
  ]);
  filmLens.scenes.set("u-1", [
    { id: "sc_1", projectId: "proj_1", number: "1", intExt: "EXT", location: "Desert Highway", timeOfDay: "DAY", createdAt: "2026-11-01T00:01:00.000Z" },
    { id: "sc_2", projectId: "proj_1", number: "2", intExt: "INT", location: "Diner", timeOfDay: "NIGHT", createdAt: "2026-11-01T00:02:00.000Z" },
    { id: "sc_x", projectId: "proj_other", number: "9", intExt: "INT", location: "Elsewhere", timeOfDay: "DAY", createdAt: "2026-11-01T00:03:00.000Z" },
  ]);
  const out = await collect(ctx("u-1"));
  assert.equal(out.sources.stateRecords, 1);
  const row = out.artifacts[0];
  assert.equal(row.id, "proj_1");
  assert.equal(row.title, "Desert Reel");
  assert.equal(row.type, "production");
  assert.equal(row.data.sceneCount, 2);
  assert.deepEqual(
    row.data.scenes.map((s) => s.slugline),
    ["EXT. Desert Highway - DAY", "INT. Diner - NIGHT"],
  );
});

test("another caller's productions are not exported; anon exports nothing", async () => {
  const filmLens = setup();
  filmLens.projects.set("u-2", [
    { id: "proj_2", title: "Theirs", format: null, logline: null, createdAt: "" },
  ]);
  assert.equal((await collect(ctx("u-1"))).sources.stateRecords, 0);
  assert.equal((await collect(ctx("anon"))).sources.stateRecords, 0);
});

test("the export read creates no state", async () => {
  const filmLens = setup();
  const projects = [{ id: "proj_1", title: "Desert Reel", format: null, logline: null, createdAt: "" }];
  filmLens.projects.set("u-1", projects);
  await collect(ctx("u-1"));
  assert.equal(filmLens.projects.get("u-1"), projects);
  assert.equal(filmLens.projects.get("u-1").length, 1);
  assert.equal(filmLens.scenes.has("u-1"), false);
});
