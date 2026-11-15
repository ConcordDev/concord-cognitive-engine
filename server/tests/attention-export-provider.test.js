// Behavior test for FIX-attention-004: the attention export must
// include the lens's own panel records (planner tasks, reserved
// blocks, distraction-log entries, focus sessions) — they live in
// STATE.attentionLens, which no export leg enumerated, so the menu
// said "Nothing to export yet" and stayed disabled with records on
// screen. Pins: the caller's records export; another user's do not.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerAttentionActions = (await import("../domains/attention.js")).default;
_clearLensExportProvidersForTests();
registerAttentionActions(() => {});

globalThis._concordSTATE = {
  attentionLens: {
    focusSessions: new Map([
      ["user-a", [{ id: "fs_1", taskName: "Deep work", startedAt: "2026-11-12T14:00:00.000Z", endedAt: "2026-11-12T14:25:00.000Z", actualMinutes: 25 }]],
      ["user-b", []],
    ]),
    pomodoro: new Map(),
    plannerDays: new Map([
      ["user-a", { "2026-11-12": { date: "2026-11-12", dayStartMinute: 540, dayEndMinute: 1080, tasks: [{ id: "tk_1", name: "Late task", startMinute: 1439, durationMinutes: 15 }] } }],
      ["user-b", { "2026-11-12": { date: "2026-11-12", dayStartMinute: 540, dayEndMinute: 1080, tasks: [{ id: "tk_9", name: "Not yours", startMinute: 60, durationMinutes: 30 }] } }],
    ]),
    distractions: new Map([
      ["user-a", [{ id: "dx_1", source: "phone", kind: "notification", durationMinutes: 3, loggedAt: "2026-11-12T15:00:00.000Z" }]],
      ["user-b", [{ id: "dx_9", source: "other", kind: "person", loggedAt: "2026-11-12T15:00:00.000Z" }]],
    ]),
    focusMode: new Map(),
    calendarBlocks: new Map([
      ["user-a", [{ id: "cb_1", date: "2026-11-12", startMinute: 600, durationMinutes: 90, endMinute: 690, title: "Focus Block", createdAt: "2026-11-12T09:00:00.000Z" }]],
    ]),
  },
};

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("attention export includes the caller's panel records only", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "attention", ctx: { actor: { userId: "user-a" } } });
  const byId = new Map(out.artifacts.map((r) => [r.id, r]));
  // the ticket's fixture shape: a planner task at 23:59 for 15m
  const task = byId.get("tk_1");
  assert.ok(task, "planner task exported");
  assert.equal(task.data.startMinute, 1439);
  assert.equal(task.data.durationMinutes, 15);
  assert.ok(byId.has("planner:2026-11-12"), "planner day exported");
  assert.ok(byId.has("cb_1"), "reserved block exported");
  assert.ok(byId.has("dx_1"), "distraction entry exported");
  assert.ok(byId.has("fs_1"), "focus session exported");
  assert.ok(!byId.has("dx_9") && !byId.has("tk_9"), "another user's records must not leak");
});
