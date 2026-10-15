// scripts/engineering-workflow.mjs
//
// Integrated engineering workflow against the live Concord MCP.
// 6 steps, each verified end-to-end with the JWT:
//   1. dtu_search — find an engineering requirement in the DTU knowledge base
//   2. dtu_get    — pull the full requirement (criteria, sources, provenance)
//   3. conkay_design.open  — create a design from the requirement
//   4. conkay_design.get   — pull the run results (mass, cost, structural, drawing)
//   5. conkay_design.export — get the realization package (README + materials + receipts + BOM)
//   6. dtu_create — save the artifact + evidence back to Concord
//
// Run:
//   JWT=$(cat /tmp/concord-jwt.txt) node scripts/engineering-workflow.mjs
//
// Or without JWT — the call will be rejected by the governance envelope.

import fs from "node:fs";
import path from "node:path";

const MCP_URL = "http://localhost:5050/mcp/call";
const TOKEN = fs.existsSync("/tmp/concord-jwt.txt")
  ? fs.readFileSync("/tmp/concord-jwt.txt", "utf8").trim()
  : process.env.JWT;

if (!TOKEN) {
  console.error("No JWT — set /tmp/concord-jwt.txt or $JWT env var");
  process.exit(1);
}

const USER_ID = "aae8c7bb-efb9-4672-b0c7-0990a27f3825";
const OUT_DIR = "/tmp/concord-workflow";
fs.mkdirSync(OUT_DIR, { recursive: true });

async function call(tool, args = {}, opts = {}) {
  const body = JSON.stringify({ tool, args });
  const res = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TOKEN}`,
    },
    body,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 200) }; }
  // The lens_action call shape is triple-wrapped:
  //   data = { result: { ok, key, domain, action, ..., result: { ok, result: { designId, ... } } } }
  // Drill down if this is a lens_action result.
  if (data.result && data.result.key && data.result.result && data.result.result.result && !opts.keepEnvelope) {
    return data.result.result.result;
  }
  return data.result || data;
}

function log(stage, payload) {
  const stamp = new Date().toISOString();
  console.log(`\n[${stage}] ${stamp}`);
  if (typeof payload === "string") {
    console.log(payload.slice(0, 800));
  } else {
    console.log(JSON.stringify(payload, null, 2).slice(0, 1200));
  }
}

async function main() {
  // ── STEP 1: find a requirement in the DTU knowledge base ────────────────
  console.log("\n========================================");
  console.log("STEP 1: search DTU knowledge base for an engineering requirement");
  console.log("========================================\n");

  const searchRes = await call("dtu_search", {
    query: "lap splice bracket bolt shear requirement",
    limit: 5,
  });
  log("dtu_search", searchRes);

  // Pick the first result or fall back to a hand-written requirement
  let requirement;
  let requirementId;
  if (searchRes.ok && searchRes.results && searchRes.results.length > 0) {
    requirementId = searchRes.results[0].id;
    console.log(`\n>>> picked DTU ${requirementId} from search results`);
    const fullRes = await call("dtu_get", { id: requirementId });
    log("dtu_get", fullRes);
    requirement = fullRes.dtu || fullRes.result || fullRes;
  } else {
    console.log("\n>>> no matching DTU found, using hand-written requirement");
    requirement = {
      title: "Lap-splice bracket for 40 kN shear load",
      body: "A structural bracket that joins two plates via a bolted lap splice. Must carry 40 kN of shear load using ASTM A325 bolts in a single shear plane against an A36 steel plate. Target: PASS for bolt shear + bearing with utilization under 60%.",
      source: "synthetic",
    };
  }

  // ── STEP 2: synthesize a design IR from the requirement ──────────────────
  console.log("\n========================================");
  console.log("STEP 2: synthesize design IR from requirement");
  console.log("========================================\n");

  // The supported parts in conkay_design include "bracket". Build a bracket IR
  // that satisfies the requirement: 4 M16 A325 bolts in 1 shear plane, 200x100x10 A36 plate.
  const designIR = {
    design: { id: "lap-splice-bracket", name: "Lap-splice bracket for 40 kN shear" },
    materials: {
      "astm-a325": { costPerKgUsd: "4 USD/kg" },
    },
    nodes: [
      { id: "A1", kind: "Assembly" },
      { id: "P1", kind: "Plate", material: "steel-a36",
        geometry: { shape: "plate", length: "200 mm", width: "100 mm", thickness: "10 mm" } },
      { id: "B1", kind: "Bolt", material: "astm-a325",
        geometry: { shape: "bolt", diameter: "16 mm", length: "40 mm" }, qty: 4 },
      { id: "J1", kind: "Joint", props: { shearPlanes: 1 } },
    ],
    edges: [
      { type: "CONTAINS", from: "A1", to: "P1" },
      { type: "CONTAINS", from: "A1", to: "B1" },
      { type: "CONTAINS", from: "J1", to: "P1" },
      { type: "CONTAINS", from: "J1", to: "B1" },
    ],
    loadCases: [{ id: "LC1", loads: [{ target: "J1", shear: "40 kN" }] }],
  };
  log("design IR", designIR);

  // ── STEP 3: open the design in ConKay (runs all applicable solvers) ─────
  console.log("\n========================================");
  console.log("STEP 3: conkay_design.open — run all applicable solvers");
  console.log("========================================\n");

  const openRes = await call("run_lens_action", {
    domain: "conkay_design",
    action: "open",
    params: { ir: designIR },
    approval: true,
  });
  log("conkay_design.open", openRes);

  if (!openRes.designId) {
    console.error("\n!!! design.open failed");
    console.error("response:", JSON.stringify(openRes).slice(0, 500));
    process.exit(1);
  }
  const designId = openRes.designId;
  console.log(`\n>>> design created: ${designId}`);

  // ── STEP 4: pull the run results ────────────────────────────────────────
  console.log("\n========================================");
  console.log(`STEP 4: conkay_design.get — pull run results for ${designId}`);
  console.log("========================================\n");

  const getRes = await call("run_lens_action", {
    domain: "conkay_design",
    action: "get",
    params: { designId },
    approval: true,
  });
  const design = getRes;
  const results = design.results || [];
  console.log(`>>> ${results.length} solver runs`);

  const summary = design.summary || {};
  console.log(`>>> summary: ${summary.pass} pass / ${summary.warn} warn / ${summary.fail} fail / ${summary.notComputed} not computed`);

  // Per-run breakdown
  for (const r of results) {
    const outputs = JSON.stringify(r.outputs || {});
    console.log(`    ${r.runId.padEnd(35)} ${r.status.padEnd(13)} ${outputs.slice(0, 120)}`);
  }

  // Save the results JSON
  const resultsPath = path.join(OUT_DIR, `${designId}.results.json`);
  fs.writeFileSync(resultsPath, JSON.stringify(design, null, 2));
  console.log(`\n>>> results saved: ${resultsPath}`);

  // ── STEP 5: export the realization package ─────────────────────────────
  console.log("\n========================================");
  console.log("STEP 5: conkay_design.export — get realization package (README, materials, BOM, receipts)");
  console.log("========================================\n");

  const exportRes = await call("run_lens_action", {
    domain: "conkay_design",
    action: "export",
    params: { designId, format: "markdown" },
    approval: true,
  });
  const files = exportRes.files || exportRes.result?.files || {};
  console.log(`>>> realization package: ${Object.keys(files).length} files`);
  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(OUT_DIR, `${designId}.${name.replace(/\//g, "_")}`);
    fs.writeFileSync(filePath, content);
    console.log(`    ${name.padEnd(40)} ${content.length} bytes  ->  ${filePath}`);
  }

  // ── STEP 6: save the artifact back to Concord as a DTU ──────────────────
  console.log("\n========================================");
  console.log("STEP 6: save the artifact back to Concord as a DTU");
  console.log("========================================\n");

  // Build the DTU content: a structured summary with all the evidence
  const dtuTitle = `Engineering: ${designIR.design.name} (${designId})`;
  const dtuContent = {
    requirement,
    designId,
    designName: designIR.design.name,
    summary,
    results: results.map(r => ({
      runId: r.runId,
      solver: r.solver?.id,
      version: r.solver?.version,
      fidelity: r.solver?.fidelity,
      status: r.status,
      outputs: r.outputs,
      provenance: r.provenance,
    })),
    realization: Object.keys(files),
    evidence: {
      resultsJson: resultsPath,
      realizationFiles: Object.keys(files).map(n => `${designId}.${n.replace(/\//g, "_")}`),
    },
    workflow: "integrated-engineering-pipeline-v1",
    operator: USER_ID,
    generatedAt: new Date().toISOString(),
  };

  // We don't have a direct dtu_create tool exposed via MCP, but vault_write
  // is exposed and works as a DTU mint. Use it with type=report.
  const saveRes = await call("vault_write", {
    namespace: "engineering-workflow",
    vault_type: "report",
    title: dtuTitle,
    content: JSON.stringify(dtuContent, null, 2),
    tags: ["engineering", "conkay", "lapsplice", designId, `pass:${summary.pass}`, `fail:${summary.fail}`],
  });
  log("vault_write", saveRes);

  if (saveRes.ok) {
    console.log(`\n>>> artifact saved as DTU: ${saveRes.entryId || saveRes.id || saveRes.dtuId || "(see result)"}`);
  } else {
    console.log("\n>>> vault_write returned non-ok, see above");
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  console.log("\n========================================");
  console.log("DONE — integrated engineering workflow");
  console.log("========================================\n");
  console.log(`Design:        ${designId}`);
  console.log(`Requirement:   ${requirementId || "synthetic"}`);
  console.log(`Solvers run:   ${results.length}`);
  console.log(`PASS:          ${summary.pass}`);
  console.log(`WARN:          ${summary.warn}`);
  console.log(`FAIL:          ${summary.fail}`);
  console.log(`Not computed:  ${summary.notComputed}`);
  console.log(`Output dir:    ${OUT_DIR}`);
  console.log(`Realization:   ${Object.keys(files).length} files`);
  console.log(`DTU saved:     ${saveRes.ok ? "yes" : "no"}`);
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(1);
});