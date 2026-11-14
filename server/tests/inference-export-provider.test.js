// Behavior test for FIX-inference-003: the inference knowledge base
// (STATE.inferenceLens.kb, userId -> { facts, rules }) is a bucket
// shape the export state leg cannot enumerate, so the header export
// said "nothing to export" over a populated KB. Pins: the caller's
// facts and rules export; another user's do not.
import { test } from "node:test";
import assert from "node:assert/strict";

process.chdir(new URL("../", import.meta.url).pathname);
const { collectLensExport, _clearLensExportProvidersForTests } = await import("../lib/lens-export.js");
const registerInferenceActions = (await import("../domains/inference.js")).default;
_clearLensExportProvidersForTests();
registerInferenceActions(() => {});

globalThis._concordSTATE = {
  inferenceLens: {
    kb: new Map([
      ["user-a", {
        facts: [{ id: "fact_1", predicate: "parent", args: ["alice", "bob"], subject: "alice", object: "bob", addedAt: "2026-11-12T09:00:00.000Z" }],
        rules: [{ id: "rule_1", name: "grandparent_rule", priority: 0, if: [{ predicate: "parent", args: ["?X", "?Y"] }], then: { predicate: "grandparent", args: ["?X", "?Y"] }, addedAt: "2026-11-12T09:01:00.000Z", text: "grandparent(?X,?Y) :- parent(?X,?Y)." }],
      }],
      ["user-b", {
        facts: [{ id: "fact_9", predicate: "parent", args: ["mallory", "eve"], addedAt: "2026-11-12T09:00:00.000Z" }],
        rules: [],
      }],
    ]),
  },
};

const noMacro = async (domain, action) => {
  if (domain === "lens" && action === "list") return { ok: true, total: 0, artifacts: [] };
  if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
  return { ok: false, error: "no_macro_in_harness" };
};

test("inference export includes the caller's facts and rules only", async () => {
  const out = await collectLensExport({ runMacro: noMacro, domain: "inference", ctx: { actor: { userId: "user-a" } } });
  const ids = out.artifacts.map((r) => r.id);
  assert.ok(ids.includes("fact_1"), "fact exported");
  assert.ok(ids.includes("rule_1"), "rule exported");
  assert.ok(!ids.includes("fact_9"), "another user's fact must not leak");
  const fact = out.artifacts.find((r) => r.id === "fact_1");
  assert.equal(fact.data.predicate, "parent");
});
