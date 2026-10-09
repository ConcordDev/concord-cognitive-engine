// server/lib/conkay/verification/realization.js
//
// The Realization Package: what a design hands to the people who build it,
// from what the design actually computed. Every number in it comes from a
// solver envelope; anything not computed says so. Parts of the full package
// that don't exist yet (STEP geometry, drawings, toolpaths) are listed as
// missing in the README rather than left out silently.

import { getMaterial } from "../materials/index.js";

const csvCell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildRealizationPackage(session) {
  const g = session.graph;
  const results = session.results();
  const byRun = new Map(results.map((e) => [e.runId, e]));
  const parentOf = new Map(g.edges("CONTAINS").map((e) => [e.to, e.from]));

  const requirements = g.requirements.map((r) => {
    const e = byRun.get(`requirement.check@${r.id}`);
    return { id: r.id, label: r.label, of: r.of, max: r.max ?? null, min: r.min ?? null, status: e?.status ?? "NOT_COMPUTED", reason: e?.reason ?? null, value: e?.outputs?.value ?? null };
  });

  const usedMaterials = [...new Set([...g.nodes.values()].map((n) => n.material).filter(Boolean))];
  const materials = usedMaterials.map((id) => {
    const m = g.materialOf([...g.nodes.values()].find((n) => n.material === id).id) || getMaterial(id);
    return { id, label: m.label, basis: m.basis ?? null, source: m.source, densityKgM3: m.densityKgM3, youngsModulusPa: m.youngsModulusPa, yieldPa: m.yieldPa, ultimatePa: m.ultimatePa, costPerKgUsd: m.costPerKgUsd, costSource: m.costSource ?? null };
  });

  const bomRows = [["id", "name", "kind", "parent", "material", "mass_kg", "material_cost_usd", "notes"]];
  for (const n of g.nodes.values()) {
    if (!n.geometry && !["Tire", "Seat", "Actuator", "Part", "Bolt", "Plate", "Beam"].includes(n.kind)) continue;
    const mass = byRun.get(`mass.part@${n.id}`);
    const cost = byRun.get(`cost.part@${n.id}`);
    const notes = [];
    if (!n.geometry) notes.push("no geometry yet");
    else if (mass?.status === "NOT_COMPUTED") notes.push(`mass not computed: ${mass.reason}`);
    if (cost?.status === "NOT_COMPUTED") notes.push(`cost not computed: ${cost.reason}`);
    bomRows.push([n.id, n.name, n.kind, parentOf.get(n.id) ?? "", n.material ?? "",
      Number.isFinite(mass?.outputs?.mass?.value) ? mass.outputs.mass.value.toFixed(4) : "not computed",
      Number.isFinite(cost?.outputs?.cost?.value) ? cost.outputs.cost.value.toFixed(2) : "not computed",
      notes.join("; ")]);
  }

  // Mass by state and the acceptance gate, for every vehicle that has them.
  const massBreakdowns = results.filter((e) => e?.solver?.id === "mass.breakdown");
  const acceptances = results.filter((e) => e?.solver?.id === "vehicle.acceptance");
  const fmt = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "not computed");
  const massLines = massBreakdowns.flatMap((e) => (e.status === "NOT_COMPUTED"
    ? [`- ${e.target}: not computed (${e.reason})`]
    : [
      `- ${e.target}: ${fmt(e.outputs.totalMass.value)} kg (${e.outputs.totalMass.note}); uncertainty ${fmt(e.outputs.uncertaintyLow.value)}–${fmt(e.outputs.uncertaintyHigh.value)} kg`,
      ...["sourced", "estimated", "computed", "placeholder"].map((st) => `  - ${st}: ${fmt(e.outputs.byState.value[st].kg)} kg (${fmt(e.outputs.byState.value[st].pct)}%), ${e.outputs.byState.value[st].count} part(s)`),
    ]));
  const acceptanceLines = acceptances.flatMap((e) => [
    `- ${e.target}: ${e.status === "FAIL" ? "FAIL" : e.status} (${e.outputs?.verdict?.value ?? e.reason})`,
    ...(e.failures || []).map((f) => `  - ${f}`),
    ...(e.outputs?.caveats?.value || []).map((c) => `  - caveat: ${c}`),
    ...(e.outputs?.performanceClaims?.value || []).filter((c) => Number.isFinite(c.mph)).map((c) => `  - ${c.claim}: ${c.mph.toFixed(1)} mph, ${c.status}; unverified: ${c.unverifiedDependencies.map((d) => d.id).join(", ")}`),
  ]);

  const coverage = session.coverage();
  const summary = session.summary();
  const gaps = coverage.flatMap((c) => c.domains.filter((d) => d.status === "not computed" || d.status === "NOT_COMPUTED").map((d) => `${c.node}: ${d.domain} (${d.reason})`));
  const readme = [
    `# ${g.design.name}: realization package`,
    "",
    `Revision ${g.revision}. ${summary.runs} solver runs: ${summary.pass} pass, ${summary.warn} warn, ${summary.fail} fail, ${summary.notComputed} not computed, ${summary.error} error.`,
    "",
    "Every number here comes from a deterministic solver run; its receipt (inputs, solver, version, fidelity, margins, input hash) is in engineering/simulation-results.json. Results are screening level unless a receipt says otherwise. Nothing here is a certification.",
    "",
    "## Requirements",
    ...requirements.map((r) => `- ${r.label}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`),
    "",
    ...(massLines.length ? ["## Mass by state (sourced / estimated / computed / placeholder)", ...massLines, ""] : []),
    ...(acceptanceLines.length ? ["## Acceptance", ...acceptanceLines, ""] : []),
    "## Not computed",
    ...(gaps.length ? gaps.map((x) => `- ${x}`) : ["- nothing"]),
    "",
    "## Not in this package yet",
    "- geometry/master.step, visualization.glb, mesh.stl (no B-rep body for this design yet)",
    "- manufacturing drawings, tolerances, toolpaths, assembly order",
    "- procurement suppliers and quotes",
    "",
  ].join("\n");

  return {
    files: {
      "README.md": readme,
      "engineering/requirements.json": JSON.stringify(requirements, null, 2),
      "engineering/materials.json": JSON.stringify(materials, null, 2),
      "engineering/simulation-results.json": JSON.stringify(results, null, 2),
      "engineering/verification.json": JSON.stringify({ summary, coverage }, null, 2),
      ...(massBreakdowns.length ? { "engineering/mass-breakdown.json": JSON.stringify(massBreakdowns, null, 2) } : {}),
      ...(acceptances.length ? { "engineering/acceptance.json": JSON.stringify(acceptances, null, 2) } : {}),
      "manufacturing/bom.csv": bomRows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n",
    },
  };
}
