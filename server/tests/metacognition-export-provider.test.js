// Behavior test for the §E metacognition wrong-content row: the
// metacognition export provider emitted its rows WITHOUT ids, so the
// shared export's dedupe (keyed on row id) could not drop the STATE
// gather's copies of the same records — every decision and reflection
// rode the export TWICE, once per source. The substrate stamps ids
// (mcId("dec") / mcId("ref")); the provider now emits them. Pins: each
// of the caller's records exports exactly once; another user's never.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerMetacognitionActions = (await import("../domains/metacognition.js")).default;
_clearLensExportProvidersForTests();
registerMetacognitionActions(() => {});

globalThis._concordSTATE = {
  metacognitionLens: {
    decisions: new Map([
      ["user-a", [{ id: "dec_1", title: "Ship the walker first", domain: "work", status: "open", confidence: 0.7, createdAt: "2026-11-12T09:00:00.000Z" }]],
      ["user-b", [{ id: "dec_9", title: "Not yours", domain: "work", status: "open", confidence: 0.2, createdAt: "2026-11-12T09:00:00.000Z" }]],
    ]),
    reflections: new Map([
      ["user-a", [{ id: "ref_1", title: "Weekly review", note: "n", answers: [1, 2], createdAt: "2026-11-12T10:00:00.000Z" }]],
    ]),
    streaks: new Map(),
  },
};

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("metacognition export carries each of the caller's records exactly once", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "metacognition", ctx: { actor: { userId: "user-a" } } });
  assert.equal(out.ok, true);
  const ids = out.artifacts.map((r) => r.id);
  assert.deepEqual([...ids].sort(), ["dec_1", "ref_1"]);
  assert.equal(out.total, 2, "no duplicated records from the second export source");
  assert.ok(!ids.includes("dec_9"), "another user's decision must not leak");
});
