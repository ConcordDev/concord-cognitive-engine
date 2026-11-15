// chem-notebook-export.test.js
//
// FIX-chem-007 regression pin: lab-notebook entries live in
// STATE.chemLabNotebook, not the artifact store. The lens export
// collector reaches them through its generic state-bag leg
// (lensStateBag finds the chem-prefixed root maps). If that leg
// breaks, the chem Export button falls back to "Nothing to export"
// over standing notebook entries — the walk-era symptom.
import { test } from "node:test";
import assert from "node:assert/strict";

test("chem notebook entries reach the lens export collector", async () => {
  globalThis._concordSTATE = {};
  const actions = new Map();
  const { default: registerChemActions } = await import("../domains/chem.js");
  registerChemActions((domain, action, fn) => actions.set(`${domain}.${action}`, fn));
  const { collectLensExport, exportCallerLensState, lensStateBag } = await import("../lib/lens-export.js");

  const ctx = { actor: { userId: "chem-user" }, userId: "chem-user" };
  const add = actions.get("chem.notebook-add");
  const added = add(ctx, { id: null, data: {}, meta: {} }, { title: "Esterification log", equation: "AcOH + EtOH" });
  assert.equal(added.ok, true);

  const bag = lensStateBag(globalThis._concordSTATE, "chem");
  const stateRows = exportCallerLensState(globalThis._concordSTATE, "chem", ctx);

  const runMacro = async (domain, action) => {
    if (domain === "lens" && action === "list") return { ok: true, artifacts: [] };
    if (domain === "dtu" && action === "list") return { ok: true, dtus: [] };
    return { ok: false, error: "unstubbed" };
  };
  const out = await collectLensExport({ runMacro, domain: "chem", ctx });
  assert.ok(out.artifacts.some((r) => r.title === "Esterification log"), "notebook entry must be in the export");
});
