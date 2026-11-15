// Behavior test for FIX-cri-006: CRI's export must include its own
// panel records (score snapshots, DTU flags, regression alerts,
// baselines) from STATE.criLens — no export leg enumerated the bag,
// so the menu said "Nothing to export yet" with 179 scored DTUs on
// screen. Pins: the caller's records export; another user's do not.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerCriActions = (await import("../domains/cri.js")).default;
_clearLensExportProvidersForTests();
registerCriActions(() => {});

globalThis._concordSTATE = {
  criLens: {
    snapshots: new Map([
      ["user-a", [{ at: "2026-11-12T10:00:00.000Z", count: 179, scored: 179, avg: 0.81, dims: {} }]],
      ["user-b", [{ at: "2026-11-12T10:00:00.000Z", count: 3, scored: 3, avg: 0.5, dims: {} }]],
    ]),
    rules: new Map(),
    flags: new Map([
      ["user-a", new Map([["dtu_1", { dtuId: "dtu_1", title: "Flagged DTU", score: 0.42, status: "watch", at: "2026-11-12T10:05:00.000Z" }]])],
      ["user-b", new Map([["dtu_9", { dtuId: "dtu_9", title: "Not yours", score: 0.1, status: "watch", at: "2026-11-12T10:05:00.000Z" }]])],
    ]),
    alerts: new Map([
      ["user-a", [{ id: "al_1", dtuId: "dtu_1", title: "Flagged DTU", prev: 0.9, current: 0.42, drop: 0.48, at: "2026-11-12T10:06:00.000Z", acknowledged: false }]],
    ]),
    baselines: new Map([
      ["user-a", new Map([["dtu_1", { score: 0.9, at: "2026-11-11T10:00:00.000Z" }]])],
    ]),
  },
};

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("cri export includes the caller's quality-loop records only", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "cri", ctx: { actor: { userId: "user-a" } } });
  const ids = out.artifacts.map((r) => r.id);
  assert.ok(ids.includes("cri-snapshot:2026-11-12T10:00:00.000Z"), "snapshot exported");
  assert.ok(ids.includes("cri-flag:dtu_1"), "flag exported");
  assert.ok(ids.includes("al_1"), "alert exported");
  assert.ok(ids.includes("cri-baseline:dtu_1"), "baseline exported");
  assert.ok(!ids.includes("cri-flag:dtu_9"), "another user's flag must not leak");
  assert.equal(out.artifacts.filter((r) => r.type === "score-snapshot").length, 1, "only the caller's snapshot");
});
