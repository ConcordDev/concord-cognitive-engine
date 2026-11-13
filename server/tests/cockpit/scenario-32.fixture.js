// The 32-step beam-design scenario (CKPT-21). The plan is a fixture, so the run is deterministic.
// Every tool id is a real AGENT_TOOL_SPECS id; the test asserts that in a setup check.

export const DTU_ID = "dtu_note_1";
export const DOC_ID = "doc_final_1";
export const INDUCED = Object.freeze({ badArg: "s05", unknownTool: "s11", timeout: "s17", staleId: "s23" });
// s30 is a write (create_document): the plan's "high" row has no non-idempotent high tool in AGENT_TOOL_SPECS.
export const CONFIRM_STEPS = Object.freeze(["s14", "s30"]);
export const RESTART_AT = "s30";

const id = (k) => `stp_${k}`;
const ref = (k, path = "result.value") => ({ $ref: `${id(k)}.${path}` });
const S = (k, goal, tool, args, extra = {}) => ({ key: k, id: id(k), goal, tool, args, expects: [], dependsOn: extra.after ? extra.after.map(id) : [], required: extra.required !== false });

export const GOALS = Object.freeze({
  s05: "Convert the 12 ft span to metres",
  s11: "Combine the dead and live loads into one design load",
  s19: "Work out the bending moment at midspan",
  s21: "Work out the shear at the support",
  s23: "Export the interim note you saved earlier",
  s32: "Write the summary of the finished design",
});

export const SCENARIO_STEPS = [
  S("s01", "Recall my notes on beam spans", "dtu_search", { query: "beam notes" }),
  S("s02", "Read my notes on span tables", "dtu_search", { query: "span tables" }),
  S("s03", "Look up simply supported beam deflection", "textbook_lookup", { query: "simply supported beam deflection" }),
  S("s04", "Search for a span table", "web_search", { query: "douglas fir span table" }),
  S("s05", GOALS.s05, "run_compute", null),
  S("s06", "Start the load total", "run_compute", { key: "math.add", input: { a: 2, b: 3 } }),
  S("s07", "Add the self weight", "run_compute", { key: "math.add", input: { a: ref("s06"), b: 4 } }, { after: ["s06"] }),
  S("s08", "Add the snow load", "run_compute", { key: "math.add", input: { a: ref("s07"), b: 1 } }, { after: ["s07"] }),
  S("s09", "Add the point load", "run_compute", { key: "math.add", input: { a: ref("s08"), b: 2 } }, { after: ["s08"] }),
  S("s10", "Add the safety margin", "run_compute", { key: "math.add", input: { a: ref("s09"), b: 3 } }, { after: ["s09"] }),
  S("s11", GOALS.s11, "run_compute", null),
  S("s12", "Run the deflection recipe", "run_recipe", { recipe: "beam.deflection", inputs: { load: ref("s10") } }, { after: ["s10"] }),
  S("s13", "Run the moment recipe", "run_recipe", { recipe: "beam.moment", inputs: { load: ref("s10") } }, { after: ["s10"] }),
  S("s14", "Save an interim note", "create_dtu", { title: "Interim beam note", content: "Load total and recipe results so far." }),
  S("s15", "Read the interim note back", "dtu_search", { query: "Interim beam note" }),
  S("s16", "Check the moment value", "run_compute", { key: "math.add", input: { a: ref("s13"), b: 0 } }, { after: ["s13"] }),
  S("s17", "Look up the allowable stress table", "web_search", { query: "allowable stress table" }),
  S("s18", "Scale the moment to kN m", "run_compute", { key: "math.add", input: { a: ref("s16"), b: 1 } }, { after: ["s16"] }),
  S("s19", GOALS.s19, "run_compute", null),
  S("s20", "Add the support allowance", "run_compute", { key: "math.add", input: { a: ref("s18"), b: 2 } }, { after: ["s18"] }),
  S("s21", GOALS.s21, "run_compute", null),
  S("s22", "Add the bearing allowance", "run_compute", { key: "math.add", input: { a: ref("s20"), b: 3 } }, { after: ["s20"] }),
  S("s23", GOALS.s23, "export_dtu", null),
  S("s24", "Add the lateral allowance", "run_compute", { key: "math.add", input: { a: ref("s22"), b: 1 } }, { after: ["s22"] }),
  S("s25", "Read my notes on connections", "dtu_search", { query: "connection notes" }),
  S("s26", "Add the connection allowance", "run_compute", { key: "math.add", input: { a: ref("s24"), b: 2 } }, { after: ["s24"] }),
  S("s27", "Add the optional fire allowance", "run_compute", { key: "math.add", input: { a: ref("s26"), b: 1 } }, { after: ["s26"], required: false }),
  S("s28", "Read my notes on finishes", "dtu_search", { query: "finish notes" }),
  S("s29", "Total the design", "run_compute", { key: "math.add", input: { a: ref("s26"), b: 5 } }, { after: ["s26"] }),
  S("s30", "Save the final design", "create_document", { title: "Final beam design", content: "The finished beam design with all checks." }),
  S("s31", "Read the saved design back", "dtu_search", { query: "Final beam design" }),
  S("s32", GOALS.s32, null, null),
];

const call = (tool, args) => ({ tool, args });
const addInput = { value: 12, from: "ft", to: "m" };

/** What the mock model returns for each step goal that needs it, in order (the last repeats). */
export const SCENARIO_MODEL_SCRIPT = {
  [GOALS.s05]: [call("run_compute", { key: "physics.length.convert", input: addInput }), call("run_compute", { key: "units.convert", input: addInput })],
  [GOALS.s11]: [call("load_combo_calc", {}), call("run_compute", { key: "math.add", input: { a: 1.2, b: 1.6 } })],
  [GOALS.s19]: [call("run_compute", { key: "math.add", input: { a: 8, b: 4 } })],
  [GOALS.s21]: [call("run_compute", { key: "math.add", input: { a: 3, b: 4 } })],
  [GOALS.s23]: [call("export_dtu", { dtuId: "dtu_stale_999", format: "json" }), call("export_dtu", { dtuId: DTU_ID, format: "json" })],
  [GOALS.s32]: [call("done", { summary: "The beam design is saved and read back." })],
};

/**
 * Tool behaviour for fakeExec, with the induced failures. Returns { table, counters, outcomes }.
 * `outcomes` records every call and whether it succeeded, for the report.
 */
export function makeScenarioExec({ failTimeoutOnce = true } = {}) {
  const counters = { create_dtu: 0, create_document: 0, timeouts: 0 };
  const outcomes = [];
  let webSearchStress = 0;
  const done = (c, ok, result) => { outcomes.push({ tool: c.tool, params: c.params, ok }); return ok ? { tool: c.tool, ok: true, result } : result; };
  const table = {
    dtu_search: (c) => done(c, true, { results: [{ id: "dtu_a", title: "Notes" }], total: 1 }),
    textbook_lookup: (c) => done(c, true, { title: "Beam deflection", total: 1 }),
    web_search: (c) => {
      if (failTimeoutOnce && c.params.query === "allowable stress table" && webSearchStress++ === 0) {
        counters.timeouts += 1;
        return done(c, false, { tool: c.tool, ok: false, reason: "timeout", error: "timed out" });
      }
      return done(c, true, { title: "Table", total: 2 });
    },
    run_compute: (c) => {
      const p = c.params || {};
      if (p.key === "physics.length.convert") return done(c, false, { tool: c.tool, ok: false, error: "unknown compute function physics.length.convert", validKeys: ["units.convert", "math.add"] });
      if (p.key === "units.convert") return done(c, true, { value: 3.6576, unit: "m" });
      if (p.key === "math.add") return done(c, true, { value: Number(p.input?.a ?? 0) + Number(p.input?.b ?? 0) });
      return done(c, false, { tool: c.tool, ok: false, error: "missing required key", missing: ["key"] });
    },
    run_recipe: (c) => done(c, true, { value: Number(c.params?.inputs?.load ?? 0) * 2 }),
    create_dtu: (c) => { counters.create_dtu += 1; return done(c, true, { dtuId: DTU_ID, title: c.params.title }); },
    create_document: (c) => { counters.create_document += 1; return done(c, true, { docId: DOC_ID, title: c.params.title }); },
    export_dtu: (c) => (c.params?.dtuId === DTU_ID ? done(c, true, { exported: true, dtuId: DTU_ID }) : done(c, false, { tool: c.tool, ok: false, error: "dtu not found" })),
  };
  return { table, counters, outcomes };
}
