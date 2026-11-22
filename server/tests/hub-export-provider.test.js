// Behavior test for export.no_file.hub (§D remainder): the hub's
// recorded activity lives in STATE.hubActivity — a flat event array,
// not a <domain>Lens bag — so no export leg enumerated it and the hub
// Export produced no file. Pins: the caller's own recorded activity
// events export through the registered provider; another user's events
// and actor-less rows never ride; an anonymous caller gets nothing;
// stateBacked reports true once the provider is registered.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerHubActions = (await import("../domains/hub.js")).default;
_clearLensExportProvidersForTests();
registerHubActions(() => {});

globalThis._concordSTATE = {
  hubActivity: [
    { id: "hub_1", districtId: "sere", kind: "building", actor: "user-a", summary: "Raised a granary", source: "recorded", at: "2026-11-12T10:00:00.000Z", ts: 1762941600000 },
    { id: "hub_2", districtId: "sere", kind: "trade", actor: "user-b", summary: "Sold iron at the market", source: "recorded", at: "2026-11-12T11:00:00.000Z", ts: 1762945200000 },
    { id: "hub_3", districtId: "ruins", kind: "discovery", actor: null, summary: "A gate was found", source: "recorded", at: "2026-11-12T12:00:00.000Z", ts: 1762948800000 },
    { id: "hub_4", districtId: "hub", kind: "validation", actor: "user-a", summary: "Validated a receipt", source: "recorded", at: "2026-11-12T13:00:00.000Z", ts: 1762952400000 },
  ],
};

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("hub export includes the caller's own recorded activity only", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "hub", ctx: { actor: { userId: "user-a" } } });
  assert.equal(out.ok, true);
  const byId = new Map(out.artifacts.map((r) => [r.id, r]));
  assert.ok(byId.has("hub_1"), "caller's first event exported");
  assert.ok(byId.has("hub_4"), "caller's second event exported");
  assert.equal(byId.get("hub_1").title, "Raised a granary");
  assert.equal(byId.get("hub_1").type, "activity");
  assert.ok(!byId.has("hub_2"), "another user's event must not leak");
  assert.ok(!byId.has("hub_3"), "actor-less rows never ride a personal export");
  assert.equal(out.stateBacked, true);
  assert.ok(out.sources.stateRecords >= 2, "provider rows counted as state records");
});

test("hub export for an anonymous caller is empty", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "hub", ctx: { actor: { userId: "anon" } } });
  assert.equal(out.ok, true);
  assert.equal(out.artifacts.length, 0);
});
