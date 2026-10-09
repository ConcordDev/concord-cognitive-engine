// server/lib/conkay/knowledge/claim-analyzer.js
//
// Claim analyzer (start of deliverable 5). Every statement in a source text
// becomes one Claim per property it is about, with:
//   status   ["unknown"]  — nothing in the text is evidence for itself
//   support  "unsupported" unless a curated assessment (assessments.js) cites
//            documents that support, partly support or contradict it
//   requiredEvidence     — the test (or record, or identification) that would
//                          establish it, linked to the test plan by property
//   assertedBy           — the source text, with line locator and quote
// Statements that match no rule are kept as unclassified claims for review.

import { makeClaim, knownProperty } from "./claims.js";
import { classify, GENERIC_SUBJECT, COMPARISON, VAGUE } from "./claim-rules.js";
import { assessmentFor } from "./assessments.js";
import { evidenceRef } from "./sources.js";
import { constituentClassOf } from "./formulation.js";
import { CONSTITUENTS } from "./constituents.js";
import { PROPERTIES } from "./properties.js";

const pad = (n) => String(n).padStart(2, "0");

/**
 * statements: [{ text, locator, quote?, attributedTo?, section? }]
 * ctx: { base, subject, polymerText, sourceTitle }
 */
export function analyzeStatements(statements, ctx) {
  const claims = [];
  statements.forEach((st, idx) => {
    const n = pad(idx + 1);
    const assertedBy = { source: ctx.sourceTitle, locator: st.locator, quote: st.quote || st.text };
    const generic = GENERIC_SUBJECT.test(st.text);
    // explicit mention, or a comparative sentence inside a "… vs marine blend" section
    const comparison = COMPARISON.test(st.text) || (COMPARISON.test(st.section || "") && /\b(higher|lower|more|less|stronger|weaker)\b/i.test(st.text));
    const vague = VAGUE.filter((v) => v.re.test(st.text)).map((v) => v.note);
    const first = st.text.split(/\s+/)[0] || "";
    const constituent = !st.attributedTo && /^HDPE\b/.test(st.text) && / is /.test(st.text) ? constituentClassOf(first) : null;
    const subject = generic ? "general-statement" : constituent?.classId ? CONSTITUENTS[constituent.classId].id : ctx.subject;
    const props = classify(st.text);
    const common = {
      subject, statement: st.text, assertedBy, attributedTo: st.attributedTo || null,
      kind: "qualitative", status: ["unknown"],
    };
    const baseFlags = [];
    if (generic) baseFlags.push("generic-statement");
    if (comparison) baseFlags.push("comparison-target-not-on-record");
    if (vague.length) baseFlags.push("vague-wording");

    if (comparison) {
      claims.push(makeClaim({
        ...common, id: `claim:${ctx.base}:s${n}-comparison`, property: null, support: "unsupported",
        requiredEvidence: [{ kind: "record", property: null, reason: "the marine blend formulation and its test data are not on record, so the comparison can't be checked; ingest it first", testPlanRef: null }],
        flags: [...baseFlags], notes: vague,
      }));
    }
    if (!props.length && !comparison) {
      claims.push(makeClaim({
        ...common, id: `claim:${ctx.base}:s${n}-unclassified`, property: null, support: "unsupported",
        requiredEvidence: [{ kind: "review", property: null, reason: "statement matched no property rule; a person must say what it claims", testPlanRef: null }],
        flags: [...baseFlags, "unclassified"], notes: vague,
      }));
    }
    for (const p of props) {
      if (!knownProperty(p)) continue;
      const a = generic ? null : assessmentFor(st.text, p, ctx.polymerText);
      const required = generic
        ? [{ kind: "source_document", property: p, reason: "general statement about a material class, not this formulation: cite literature, or drop it", testPlanRef: null }]
        : [{ kind: "test", property: p, reason: `${PROPERTIES[p].label}${PROPERTIES[p].scope === "component" ? " (finished part / vessel level)" : ""} for this formulation and process version`, testPlanRef: `test:${p}` }];
      claims.push(makeClaim({
        ...common, id: `claim:${ctx.base}:s${n}-${p}`, property: p, support: a ? a.support : "unsupported",
        evidence: a ? a.docs.map(evidenceRef) : [],
        requiredEvidence: required,
        flags: [...baseFlags, ...(a?.flag ? [a.flag] : [])],
        notes: [...vague, ...(a ? [a.note] : [])],
        label: a ? `assessment ${a.id}` : null,
      }));
    }
  });
  return claims;
}
