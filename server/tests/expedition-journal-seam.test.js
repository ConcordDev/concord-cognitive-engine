// Expedition-Journal — the F1/F2 selection seam, pinned behaviourally.
//
// The first pass (2026-10-30) failed both core writes live with
// "unknown world:" — the keyed writes inherited an empty world key. The
// premise at main 1f7a2f925 found the seam wired entire (the domain's
// saved-class registration fix + the page's activeWorld state + StageCard's
// worldId props). This suite drives the domain through its own register
// export — the same (ctx, input) shape the dispatcher delivers — and pins
// the seam so it cannot silently regress: a selected world persists
// entries, accrues XP, and reads back; the "unknown world" refusal survives
// ONLY for a genuinely keyless or unknown-world call.

import test from "node:test";
import assert from "node:assert/strict";

import registerExpeditionJournalActions from "../domains/expedition-journal.js";

function harness() {
  globalThis._concordSTATE = {};
  const handlers = new Map();
  registerExpeditionJournalActions((d, a, h) => handlers.set(`${d}.${a}`, h));
  const ctx = { actor: { userId: "seam-tester" } };
  const call = (name, input = {}) => handlers.get(`expedition-journal.${name}`)(ctx, input);
  return { call };
}

test("the worlds list enumerates six worlds and twenty-three stages", async () => {
  const { call } = harness();
  const r = await call("worlds");
  assert.equal(r.ok, true);
  assert.equal(r.result.worlds.length, 6);
  assert.equal(r.result.worlds.reduce((n, w) => n + w.stages.length, 0), 23);
});

test("a journal entry persists against the selected world and reads back", async () => {
  const { call } = harness();
  const worlds = await call("worlds");
  const cyber = worlds.result.worlds.find((w) => w.worldId === "cyber");
  const add = await call("entry-add", { worldId: "cyber", stageId: cyber.stages[0].id, text: "Seam probe entry." });
  assert.equal(add.ok, true);
  assert.ok(add.result.entry.id);
  const list = await call("entry-list", { worldId: "cyber" });
  assert.equal(list.ok, true);
  assert.equal(list.result.entries.length, 1);
  assert.equal(list.result.entries[0].text, "Seam probe entry.");
});

test("marking a stage complete against the selected world awards its XP", async () => {
  const { call } = harness();
  const worlds = await call("worlds");
  const cyber = worlds.result.worlds.find((w) => w.worldId === "cyber");
  const stage = cyber.stages[0];
  const mark = await call("mark-stage", { worldId: "cyber", stageId: stage.id, done: true });
  assert.equal(mark.ok, true);
  assert.equal(mark.result.totalXp, stage.xp);
  const progress = await call("progress", { worldId: "cyber" });
  assert.equal(progress.result.completed, 1);
  assert.equal(progress.result.total, cyber.stages.length);
});

test("the unknown-world refusal survives only for keyless or unknown calls", async () => {
  const { call } = harness();
  const keyless = await call("entry-add", { text: "no world named" });
  assert.equal(keyless.ok, false);
  assert.equal(keyless.error, "unknown world: ");
  const unknown = await call("mark-stage", { worldId: "atlantis", stageId: "arrive", done: true });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, "unknown world: atlantis");
});
