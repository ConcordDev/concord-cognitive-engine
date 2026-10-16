// server/lib/conkay/physics/solvers/process-window.js
//
// Blend D brief item 8: process.window — the stated processing temperature of a
// Material node's formulation (or props.process) against the sourced HDPE melt
// windows, the matrix melting range and the degradation onset.

import { registerSolver } from "../registry.js";
import { setup, formulated } from "./material-stiffness.js";
import { processWindow } from "../../knowledge/process-window.js";

export const processWindowSolver = registerSolver({
  id: "process.window",
  version: "1.0.0",
  domain: "process.window",
  fidelity: 0,
  method: "Stated processing temperature against cited HDPE melt windows (MOL 2023), the HDPE melting range, the nitrogen onset of mass loss (Evgin 2020) and HDPE OIT at 200 °C; terminology flags; required process inputs listed",
  reference: "server/lib/conkay/knowledge/process-window.js",
  regime: "HDPE-matrix compounds; melt processing (extrusion, blow moulding, film)",
  units: { inputs: "°C, min", outputs: "—" },
  tolerance: "the sourced ranges; out of window = WARN, never PASS",
  screening: true,
  targets: formulated,
  run(ctx, id) {
    const s = setup(ctx, id);
    if (s.notComputed) return s;
    if (!s.ir.constituents.some((c) => c.classId === "hdpe")) return { notComputed: "no HDPE matrix: the sourced windows are HDPE's" };
    const given = ctx.get(id, "props.process") || {};
    const stated = s.ir.process?.steps?.find((st) => Number.isFinite(st.temperatureC));
    const temperatureC = given.temperatureC ?? stated?.temperatureC;
    if (!Number.isFinite(temperatureC)) return { notComputed: "no processing temperature stated (props.process.temperatureC)" };
    const r = processWindow({ temperatureC, process: given.process, residenceTimeMin: given.residenceTimeMin, statedAs: given.statedAs ?? stated?.statedAs });
    const missing = s.ir.process?.missing || [];
    return {
      inputs: { temperatureC: { value: temperatureC, source: given.temperatureC != null ? "props.process" : `formulation ${stated?.locator || ""}`.trim() } },
      outputs: { checks: { value: r.checks }, notComputed: { value: r.notComputed }, missingProcessRecord: { value: missing } },
      failures: r.checks.filter((c) => c.id === "above-melting" && !c.pass).map((c) => c.detail),
      warnings: [...r.warnings, ...r.notComputed.map((x) => `not computed: ${x}`)],
    };
  },
});
