// B2 maker F5 fix return — the displaced pre-build records. Before
// maker.js existed, the Bench created through app-maker's project
// store (a name only, no origin stamp); the build's own table
// (maker_pieces) severed that read, leaving the records invisible in
// Maker. They carry no discriminator from genuine App Maker
// projects, so the repair is owner-driven: reclaimables names the
// caller's unreclaimed app-maker projects; reclaim copies ONE onto
// the bench and stamps the source so it is never re-offered. The
// app-maker record itself is not deleted or otherwise altered.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerMakerMacros from "../domains/maker.js";
import { up as makerPiecesUp } from "../migrations/497_maker_pieces.js";

const macros = {};
registerMakerMacros((domain, name, fn) => { macros[`${domain}.${name}`] = fn; });

let db;
function seedAppMaker() {
  const projects = new Map();
  projects.set("u-1", [
    { id: "proj_make", name: "PR4 Maker Probe 2026-11-01", createdAt: "2026-11-01T00:00:00.000Z", pages: [{ id: "page_1" }], workflows: [] },
    { id: "proj_app", name: "PR4 App Maker Review 2026-10-30", createdAt: "2026-10-30T00:00:00.000Z", pages: [{ id: "page_2" }], workflows: [] },
  ]);
  projects.set("u-2", [
    { id: "proj_other", name: "Someone else's app", createdAt: "2026-10-01T00:00:00.000Z", pages: [], workflows: [] },
  ]);
  globalThis._concordSTATE = { appMakerLens: { projects } };
  return projects;
}
const ctx = (userId) => ({ actor: { userId }, db });

beforeEach(() => {
  db = new Database(":memory:");
  makerPiecesUp(db);
  seedAppMaker();
});

test("reclaimables lists the caller's app-maker projects, unreclaimed only", async () => {
  const out = await macros["maker.reclaimables"](ctx("u-1"), {});
  assert.equal(out.ok, true);
  assert.deepEqual(out.projects.map((p) => p.id), ["proj_make", "proj_app"]);
});

test("reclaim copies the record onto the bench and stamps the source", async () => {
  const projects = seedAppMaker();
  const out = await macros["maker.reclaim"](ctx("u-1"), { projectId: "proj_make" });
  assert.equal(out.ok, true);
  assert.equal(out.make.name, "PR4 Maker Probe 2026-11-01");

  const list = await macros["maker.list"](ctx("u-1"), {});
  assert.deepEqual(list.makes.map((m) => m.name), ["PR4 Maker Probe 2026-11-01"]);

  // The source project still stands in App Maker, marker stamped.
  const source = projects.get("u-1").find((p) => p.id === "proj_make");
  assert.equal(source.reclaimedAsMake, out.make.id);
  assert.equal(source.pages.length, 1);

  // And it is never re-offered; a second reclaim refuses.
  const again = await macros["maker.reclaimables"](ctx("u-1"), {});
  assert.deepEqual(again.projects.map((p) => p.id), ["proj_app"]);
  const twice = await macros["maker.reclaim"](ctx("u-1"), { projectId: "proj_make" });
  assert.equal(twice.ok, false);
  assert.equal(twice.reason, "already_reclaimed");
});

test("a reclaimed make renames on the bench (the F3 displaced leg)", async () => {
  const out = await macros["maker.reclaim"](ctx("u-1"), { projectId: "proj_make" });
  const renamed = await macros["maker.update"](ctx("u-1"), { id: out.make.id, name: "PR4 Maker Probe — renamed" });
  assert.equal(renamed.ok, true);
  const list = await macros["maker.list"](ctx("u-1"), {});
  assert.equal(list.makes[0].name, "PR4 Maker Probe — renamed");
});

test("another user's project cannot be reclaimed", async () => {
  const out = await macros["maker.reclaim"](ctx("u-1"), { projectId: "proj_other" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "not_found");
  const list = await macros["maker.list"](ctx("u-1"), {});
  assert.equal(list.makes.length, 0);
});
