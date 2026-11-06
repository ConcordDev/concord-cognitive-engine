// Event-Timeline build pins (F-C row 18):
//  - the saved-view lifecycle the guards wrap: saveView's same-name
//    OVERWRITE is the server's standing semantics (the FE build consents
//    to it in words; it does not change it);
//  - the NEW lens export provider surfaces the caller's saved views to
//    the generic export (S5's one-story clause).
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.ARTIFACT_DIR = process.env.ARTIFACT_DIR || "/tmp";

const domainMod = await import("../domains/event-timeline.js");
const lensExport = await import("../lib/lens-export.js");

function capture() {
  const handlers = new Map();
  domainMod.default((d, n, fn) => handlers.set(`${d}.${n}`, fn), {});
  return handlers;
}

test("saveView: a same-name save overwrites (the consented semantics)", async () => {
  globalThis._concordSTATE = {};
  const h = capture();
  const ctx = { actor: { userId: "u-over" }, db: null };
  const a = await h.get("event_timeline.saveView")(ctx, { name: "Combat", channels: ["combat"], worldId: null, query: "" });
  assert.equal(a.ok, true);
  const b = await h.get("event_timeline.saveView")(ctx, { name: "Combat", channels: ["npc"], worldId: "hub", query: "x" });
  assert.equal(b.ok, true);
  assert.equal(b.total, 1, "the duplicate replaced, not duplicated");
  const list = await h.get("event_timeline.listViews")(ctx, {});
  assert.equal(list.count, 1);
  assert.deepEqual(list.views[0].channels, ["npc"], "the newer filter stands");
});

test("the export provider returns the caller's saved views — and only theirs", async () => {
  globalThis._concordSTATE = {};
  lensExport._clearLensExportProvidersForTests();
  const h = capture();
  const mine = { actor: { userId: "u-mine" }, db: null };
  const other = { actor: { userId: "u-other" }, db: null };
  await h.get("event_timeline.saveView")(mine, { name: "Errors", channels: ["system:error"], worldId: null, query: "fail" });
  await h.get("event_timeline.saveView")(other, { name: "Theirs", channels: [], worldId: null, query: "" });
  const runMacro = async () => ({ ok: true, artifacts: [] });
  const out = await lensExport.collectLensExport({ runMacro, domain: "event-timeline", ctx: mine, limit: 50 });
  assert.equal(out.artifacts.length, 1);
  const row = out.artifacts[0];
  assert.equal(row.type, "saved_view");
  assert.equal(row.title, "Errors");
  const data = row.data || row;
  assert.match(String(data.content || ""), /channels: system:error/);
  assert.match(String(data.content || ""), /search: fail/);
});

test("deleteView removes by id and reports the removal", async () => {
  globalThis._concordSTATE = {};
  const h = capture();
  const ctx = { actor: { userId: "u-del" }, db: null };
  const a = await h.get("event_timeline.saveView")(ctx, { name: "Temp", channels: [], worldId: null, query: "" });
  const r = await h.get("event_timeline.deleteView")(ctx, { id: a.view.id });
  assert.equal(r.ok, true);
  assert.equal(r.removed, 1);
  const list = await h.get("event_timeline.listViews")(ctx, {});
  assert.equal(list.count, 0);
});
