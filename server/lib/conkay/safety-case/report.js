// server/lib/conkay/safety-case/report.js — markdown for the safety-case demo / report.

import { REG_SOURCES } from "./sources.js";
import { METHOD } from "./support-graph.js";

const cs = (sets) => (sets.length ? sets.map((s) => `{${s.join(", ")}}`).join(", ") : "none");

export function renderSafetyCaseMarkdown(r) {
  const L = [];
  L.push(`> **${r.banner}**`, "");
  L.push(`# ConKay safety-case screening — ${r.caseId}`, "");
  L.push("Generic two-function, two-train demo topology. Not a real plant design and not derived from one.", "");
  L.push(`Design of record sha256 \`${r.designOfRecord.irSha256}\`, unchanged by this run: **${r.designOfRecord.unchanged}**. ${r.designOfRecord.note}`, "");

  L.push("## Requirements completeness", "", "| Requirement | Design of record | With proposals | Missing (design of record) |", "| --- | --- | --- | --- |");
  for (const q of r.requirements) L.push(`| ${q.record.id} | ${q.designOfRecord.status} | ${q.proposedDesign.status} | ${q.designOfRecord.missing.map((m) => (m.reason.startsWith(m.field) ? m.reason : `${m.field}: ${m.reason}`)).join("; ") || "—"} |`);
  L.push("", "Requirement texts are written for this demo, not regulatory text. Cited regulatory locators are context only.", "");

  L.push("## Findings (design of record)", "");
  if (!r.findings.length) L.push("None.");
  for (const f of r.findings) {
    L.push(`- **${f.kind}**: ${f.message}`);
    for (const p of f.paths) L.push(`  - path: ${p.text}`);
  }
  L.push("");

  L.push("## Minimal cut sets of order ≤ 2 (design of record)", "", `Method: ${METHOD.cutSets}.`, "");
  for (const [fid, c] of Object.entries(r.cutSets)) {
    L.push(`- **${fid}**: order 1: ${cs(c.order1)}`);
    L.push(`  - order 2 (${c.order2.length}): ${cs(c.order2)}`);
  }
  L.push("");

  L.push("## Proposals (pending human decision)", "");
  for (const p of r.proposals) L.push(`- **${p.id}** \`${p.change.node}\` ${p.change.path}: ${p.change.from} → ${p.change.to}. Status: **${p.status}**; applied to design of record: ${p.appliedToDesignOfRecord}. ${p.rationale}.`);
  L.push("", "### Re-analysis with all proposals applied (on a copy)", "");
  for (const c of r.reanalysis.checksBefore) {
    const a = r.reanalysis.checksAfter.find((x) => x.runId === c.runId);
    L.push(`- ${c.runId}: ${c.engineStatus} → ${a?.engineStatus ?? "?"}`);
  }
  L.push(`- findings after: ${r.reanalysis.findingsAfter.length}`);
  for (const [fid, c] of Object.entries(r.reanalysis.cutSetsAfter)) L.push(`- ${fid} after: order 1: ${cs(c.order1)}; order 2: ${c.order2.length} sets`);
  L.push("");

  L.push("## Human sign-offs needed", "");
  for (const s of r.signOffs) L.push(`- ${s.item}: **${s.needed}** — ${s.reason}`);
  L.push("", "## Open items", "");
  for (const o of r.openItems) L.push(`- ${o}`);

  L.push("", "## Change log", "", `Hash-chained, append-only: ${r.changeLog.entries.length} entries, chain valid: ${r.changeLog.verification.valid}, head \`${r.changeLog.verification.head}\`. ConKay entries are drafts and proposals only; accepting a proposal is a human-only action.`, "");

  L.push("## Cut-set engine benchmark (NUREG-0492)", "");
  for (const b of r.benchmarks) {
    L.push(`- ${b.title}: ConKay ${cs(b.cutSets)}; published "${b.published.text}"; match: **${b.cutSetsMatch}**.`);
    if (b.quantification) {
      L.push(`  - rare-event sum with Table VIII-1 data: ${b.quantification.rareEvent.toExponential(4)} (handbook prints P(E1) ≅ ${b.published.topProbability.toExponential(1)}; the exact sum of its five listed terms is 3.5016×10⁻⁵, and its 14 %/86 % importances match 3.5×10⁻⁵).`);
      L.push(`  - importances: ${b.quantification.terms.map((t) => `${t.cutSet.join("·")} ${(t.importance * 100).toFixed(2)} %`).join(", ")}`);
    }
  }

  L.push("", "## Sources (verified 2026-10-09)", "");
  for (const [id, s] of Object.entries(REG_SOURCES)) L.push(`- \`${id}\`: ${s.regulation}, ${s.locator}. ${s.url}${s.sha256 ? ` (sha256 ${s.sha256.slice(0, 12)}…)` : ""}`);
  L.push("", `> **${r.banner}**`);
  return L.join("\n");
}
