// server/tests/silver-registry.test.js
//
// Universal Silver phase 1: the read-only registry. Fixture tests pin how
// sources are scored and folded (sub-lens delegates into their parent, one
// shared handler mounted on many domains into one entry, a capability's
// declarations merged onto its macro, the two candidate signals and their
// exclusions). Then one live check: the booted server's `silver.summary`
// macro reports the same totals as the live maps it reads.

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { buildSilverRegistry } from "../lib/silver/registry.js";
import { assessConkaySolver, referencedTests, candidateReason, CONTRACT_FIELDS } from "../lib/silver/contract.js";
import { renderGapReport } from "../lib/silver/report.js";
import { lensRun, load } from "./depth/_harness.js";

const classify = (d, n) => (/^calc/.test(n) ? { class: "A", reason: "deterministic_calculator", headlessSafe: true } : { class: "B", reason: "default_structured", headlessSafe: false });

function fixture(over = {}) {
  return buildSilverRegistry({
    conkaySolvers: [
      { id: "structure.frame", version: "1.0.0", domain: "structural.frame", domains: ["structural.frame"], fidelity: 2, method: "frame FE", reference: "lib/x.js; benchmarks in tests/conkay-frame-fe.test.js", regime: "linear elastic", units: { inputs: {}, outputs: {} } },
      { id: "mass.part", version: "1.3.0", domain: "mass", domains: ["mass"], fidelity: 1, method: "volume × density", reference: null },
    ],
    capabilities: [
      { capability: "chem.calcMolarity", owner: "chem", risk: "compute", inputs: ["moles", "litres"], outputs: ["molarity"], description: "molarity" },
      { capability: "ghost.action", owner: "nobody", risk: "read" },
      { capability: "incident.watch", owner: "incident_engine", risk: "read", implementation: "mcp", mcp_tool_name: "incident_watch" },
    ],
    lensActionKeys: ["chem.calcMolarity", "chem.calcPh", "code.git-commit", "code.rust.git-commit", "code.go.git-commit", "a.save", "b.save", "c.save", "chem.list-presets"],
    macroKeys: ["chem.calcPh", "physics.calcDrop"],
    handlerIds: { "a.save": 7, "b.save": 7, "c.save": 7, "chem.calcMolarity": 1, "chem.calcPh": 2, "code.git-commit": 3, "code.rust.git-commit": 4, "code.go.git-commit": 5, "chem.list-presets": 6 },
    inputHints: { "chem.calcPh": [{ name: "conc" }] },
    macroDepth: [
      { domain: "chem", macro: "calcPh", hasTest: true, tier: "utility", stateTouch: false, externalIO: false },
      { domain: "code", macro: "git-commit", hasTest: true, tier: "production-grade", stateTouch: false, externalIO: false },
      { domain: "chem", macro: "list-presets", hasTest: true, tier: "utility", stateTouch: false, externalIO: false },
      { domain: "physics", macro: "calcDrop", hasTest: false, tier: "utility", stateTouch: false, externalIO: false },
    ],
    oracleCases: [{ id: "chem-molarity", domain: "chem", action: "calcMolarity" }],
    classify,
    testExists: (p) => p === "server/tests/conkay-frame-fe.test.js",
    ...over,
  });
}

describe("silver registry: scoring and folding", () => {
  const r = fixture();
  const by = (k) => r.entries.find((e) => e.key === k);

  it("every entry carries every contract field and starts uncertified", () => {
    for (const e of r.entries) {
      assert.deepEqual(Object.keys(e.fields), CONTRACT_FIELDS.map((f) => f.id), e.key);
      assert.equal(e.validation, "uncertified", e.key);
    }
    assert.equal(r.summary.validation.benchmarked + r.summary.validation.accepted, 0);
  });

  it("a ConKay solver: declared metadata, runtime receipts, referenced tests checked on disk", () => {
    const f = by("conkay:structure.frame");
    assert.equal(f.fields.units, "declared");
    assert.equal(f.fields.limits, "declared");
    assert.equal(f.fields.inputs, "runtime");
    assert.equal(f.fields.provenance, "declared");
    assert.equal(f.fields.frame, "missing");
    assert.deepEqual(f.evidence.referencedTests, [{ path: "tests/conkay-frame-fe.test.js", exists: true }]);
    const m = by("conkay:mass.part");
    assert.equal(m.fields.units, "missing");
    assert.equal(m.fields.limits, "missing");
    assert.deepEqual(referencedTests("a; tests/a.test.js and tests/a.test.js, tests/b/c.test.js"), ["tests/a.test.js", "tests/b/c.test.js"]);
  });

  it("sub-lens delegates fold into their parent", () => {
    assert.ok(!by("macro:code.rust.git-commit") && !by("macro:code.go.git-commit"));
    assert.deepEqual(by("macro:code.git-commit").subLensDelegates, ["code.go", "code.rust"]);
    assert.equal(r.summary.registryKeys.subLensDelegatesFolded, 2);
  });

  it("one handler mounted on many domains is one entry", () => {
    const shared = r.entries.filter((e) => e.sharedHandler);
    assert.equal(shared.length, 1);
    assert.equal(shared[0].id, "*.save");
    assert.equal(shared[0].sharedHandler.domains, 3);
    assert.equal(r.summary.registryKeys.sharedHandlerKeysFolded, 2);
    assert.equal(r.summary.registryKeys.raw, 10, "9 lens actions + 1 MACROS-only key");
  });

  it("a capability's declarations merge onto its macro; one without a macro is flagged", () => {
    const m = by("macro:chem.calcMolarity");
    assert.equal(m.fields.inputs, "declared");
    assert.equal(m.fields.outputs, "declared");
    assert.equal(m.fields.risk, "declared");
    assert.equal(m.capability.owner, "chem");
    const g = by("capability:ghost.action");
    assert.equal(g.evidence.unregisteredMacro, true, "declares a macro implementation that is not registered");
    const mcp = by("capability:incident.watch");
    assert.equal(mcp.evidence.unregisteredMacro, undefined, "an MCP-implemented capability is not an orphan");
    assert.equal(mcp.evidence.mcpTool, "incident_watch");
    assert.equal(r.summary.capabilitiesOutsideMacroMaps, 2);
    assert.equal(r.summary.capabilitiesUnregisteredMacro, 1);
  });

  it("candidates need a test or an oracle and one of the two signals; non-solver names are excluded", () => {
    assert.equal(candidateReason(by("macro:chem.calcMolarity")), "classifier", "oracle case + calculator name");
    assert.equal(candidateReason(by("macro:chem.calcPh")), "classifier");
    assert.equal(candidateReason(by("macro:code.git-commit")), "pure-compute", "parsed pure, tested, not a listed non-solver name");
    assert.equal(candidateReason(by("macro:chem.list-presets")), null, "a catalogue read is not a solver");
    assert.equal(candidateReason(by("macro:physics.calcDrop")), null, "no test, no oracle");
    assert.deepEqual(by("macro:chem.calcPh").registries, ["LENS_ACTIONS", "MACROS"]);
    assert.equal(by("macro:chem.calcPh").fields.inputs, "hint");
  });

  it("the report renders the totals it was given", () => {
    const md = renderGapReport(r, { generatedAt: "2026-10-15T00:00:00Z", head: "abc1234", precisionSample: { judgedAt: "x", rows: [{ id: "a", solver: true }, { id: "b", solver: false }, { id: "c", solver: null }] } });
    assert.match(md, /\*\*10\*\* keys/);
    assert.match(md, /1 of 2 sampled candidates \(50\.0 %\)/);
    assert.match(md, /conkay:|`structure\.frame`/);
  });

  it("assessConkaySolver never promotes", () => {
    assert.equal(assessConkaySolver({ id: "x", version: "1", domain: "d", fidelity: 0, method: "m", reference: "tests/x.test.js", units: {}, regime: "r" }, { testExists: () => true }).validation, "uncertified");
  });
});

describe("silver registry: live, through the booted server", () => {
  let summary;
  before(async () => {
    await load();
    const r = await lensRun("silver", "summary", {});
    assert.equal(r.ok, true, JSON.stringify(r).slice(0, 300));
    summary = (r.result?.result ?? r.result).summary;
  });

  it("counts what the live maps hold, with ConKay solvers registered", () => {
    const la = globalThis.__concordLensActions;
    let mk = 0;
    for (const sub of globalThis._concordMACROS.values()) mk += sub.size;
    const both = [...la.keys()].filter((k) => { const i = k.indexOf("."); return globalThis._concordMACROS.get(k.slice(0, i))?.has(k.slice(i + 1)); }).length;
    assert.equal(summary.registryKeys.raw, la.size + mk - both, "every live key is accounted for");
    assert.ok(summary.bySource["conkay-solver"].count >= 50, `${summary.bySource["conkay-solver"].count} ConKay solvers`);
    assert.ok(summary.registryKeys.distinctMacroEntries < summary.registryKeys.raw);
    assert.equal(summary.validation.benchmarked + summary.validation.accepted, 0, "v0 promotes nothing");
  });

  it("entries and entry filters work, and bad input is refused", async () => {
    const e = await lensRun("silver", "entries", { params: { source: "conkay-solver", limit: 5 } });
    const res = e.result?.result ?? e.result;
    assert.equal(res.entries.length, 5);
    assert.ok(res.entries.every((x) => x.source === "conkay-solver"));
    const one = await lensRun("silver", "entry", { params: { key: res.entries[0].key } });
    assert.equal((one.result?.result ?? one.result).key, res.entries[0].key);
    const bad = await lensRun("silver", "entry", { params: {} });
    assert.equal((bad.result ?? bad).ok ?? bad.ok, false);
    const badFilter = await lensRun("silver", "entries", { params: { state: "missing" } });
    assert.match(JSON.stringify(badFilter), /state filter needs a field/);
  });
});
