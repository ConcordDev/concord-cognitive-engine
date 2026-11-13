// Turns a finished scenario run into the numbers PLAN.md section 5 asks for (CKPT-21).
import { canonicalJson, verifyAttestation } from "../../lib/receipts/attest.js";

const WRITE_TOOLS = new Set(["create_dtu", "create_document"]);

/**
 * @param {{ run: object, steps: object[], events: object[], packets: object[], execCalls: Array<{tool:string,params:object,ok:boolean}> }} a
 */
export function scenarioReport(a) {
  const done = a.steps.filter((s) => s.status === "done");
  const groups = new Map();
  for (const c of a.execCalls) {
    if (!WRITE_TOOLS.has(c.tool) || !c.ok) continue;
    const k = `${c.tool}|${canonicalJson(c.params)}`;
    groups.set(k, (groups.get(k) || 0) + 1);
  }
  const duplicateWrites = [...groups.values()].reduce((n, g) => n + (g - 1), 0);
  const receipted = done.filter((s) => s.receipt);
  const receiptsValid = receipted.filter((s) => { try { return verifyAttestation(s.receipt).valid === true; } catch { return false; } }).length;
  const failedClasses = a.steps.filter((s) => s.errorClass);
  return {
    stepsDone: done.length,
    total: a.steps.length,
    recovered: {},
    humanInterventions: a.run.usage?.humanInterventions || 0,
    duplicateWrites,
    receiptsValid,
    receiptsTotal: done.length,
    maxPacketTokens: Math.max(0, ...a.packets.map((p) => p?.estTokens || 0)),
    maxMenu: Math.max(0, ...a.packets.map((p) => p?.menu?.length || 0)),
    runsEndedBySingleFailure: a.run.status === "failed" && failedClasses.length === 1 ? 1 : 0,
  };
}

const TARGETS = { ci: { stepsDone: "32 of 32", humanInterventions: "2", duplicateWrites: "0", receipts: "all valid", maxPacketTokens: "<= 2500", maxMenu: "<= 8", single: "0" } };

/** Markdown table of the report against PLAN.md section 5. */
export function reportMarkdown(report, column = "ci") {
  const t = TARGETS[column] || TARGETS.ci;
  const rec = Object.entries(report.recovered).map(([k, v]) => `${k}: ${v ? "yes" : "NO"}`).join(", ");
  return [
    `| Measure | Target (${column}) | Got |`,
    "|---|---|---|",
    `| Steps completed | ${t.stepsDone} | ${report.stepsDone} of ${report.total} |`,
    `| Induced failures recovered | all 4 | ${rec} |`,
    `| Human interventions | ${t.humanInterventions} | ${report.humanInterventions} |`,
    `| Duplicate writes | ${t.duplicateWrites} | ${report.duplicateWrites} |`,
    `| Receipts valid | ${t.receipts} | ${report.receiptsValid} of ${report.receiptsTotal} |`,
    `| Largest packet (tokens) | ${t.maxPacketTokens} | ${report.maxPacketTokens} |`,
    `| Largest menu | ${t.maxMenu} | ${report.maxMenu} |`,
    `| Runs ended by one failure | ${t.single} | ${report.runsEndedBySingleFailure} |`,
  ].join("\n");
}
