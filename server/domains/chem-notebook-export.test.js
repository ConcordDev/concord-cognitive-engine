// chem-notebook-export.test.js
// FIX-chem-007 — the chem lab notebook (and saved structures) live in
// per-user state maps, not the artifact store, so the lens export —
// artifacts-only for chem — declared "Nothing to export" over standing
// records. Chem now registers a state-backed export provider with the
// shared export (lib/lens-export.js), scoped to the calling user: the
// same adoption the affect lens made for its state-resident check-ins.
//
// Run: node --test server/domains/chem-notebook-export.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import registerChemActions from "./chem.js";
import { collectLensExport, hasLensExportProvider } from "../lib/lens-export.js";

const actions = new Map();
registerChemActions((domain, action, fn) => actions.set(`${domain}:${action}`, fn));
const call = (name, userId, params = {}) =>
  actions.get(`chem:${name}`)({ actor: { userId }, userId }, null, params);

const noArtifacts = async (domain, name) => {
  if (domain === "lens" && name === "list") return { ok: true, artifacts: [] };
  if (domain === "dtu" && name === "list") return { ok: true, dtus: [] };
  return { ok: true };
};
const ctxFor = (userId) => ({ actor: { userId }, userId });

describe("chem-007 — state-resident records ride the lens export", () => {
  beforeEach(() => { globalThis._concordSTATE = {}; });

  it("registers an export provider for the chem domain", () => {
    assert.equal(hasLensExportProvider("chem"), true);
  });

  it("a notebook entry the user saved appears in their export", async () => {
    const added = call("notebook-add", "u-export", { title: "Nitration log", equation: "HNO3 + H2SO4" });
    assert.equal(added.ok, true);
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "chem", ctx: ctxFor("u-export") });
    assert.equal(out.ok, true);
    const rows = out.artifacts.filter((r) => r.type === "lab-notebook-entry");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Nitration log");
    assert.ok(out.sources.stateRecords >= 1);
  });

  it("a saved structure rides the export too", async () => {
    const saved = call("save-structure", "u-export", { smiles: "CCO", name: "Ethanol" });
    assert.equal(saved.ok, true);
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "chem", ctx: ctxFor("u-export") });
    const rows = out.artifacts.filter((r) => r.type === "structure");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Ethanol");
  });

  it("another user's records never ride the caller's export", async () => {
    call("notebook-add", "u-other", { title: "Someone else's log" });
    call("notebook-add", "u-export", { title: "My log" });
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "chem", ctx: ctxFor("u-export") });
    const titles = out.artifacts.map((r) => r.title);
    assert.ok(titles.includes("My log"));
    assert.ok(!titles.includes("Someone else's log"));
  });

  it("an empty notebook exports zero state rows, honestly", async () => {
    const out = await collectLensExport({ runMacro: noArtifacts, domain: "chem", ctx: ctxFor("u-empty") });
    assert.equal(out.ok, true);
    assert.equal(out.artifacts.filter((r) => r.type === "lab-notebook-entry").length, 0);
  });
});
