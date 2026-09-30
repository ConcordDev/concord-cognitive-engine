// server/lib/pce/ip-similarity.js
//
// PCE-3 — IP similarity detector (AST-normalized structure comparison).

import { createHash } from "node:crypto";
import * as acorn from "acorn";

function normalizeAst(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type) out.push(node.type);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) normalizeAst(c, out);
    } else if (child && typeof child === "object" && child.type) {
      normalizeAst(child, out);
    }
  }
  return out;
}

export function structuralFingerprint(code) {
  try {
    const ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
    const types = normalizeAst(ast);
    return createHash("sha256").update(types.join("|")).digest("hex").slice(0, 24);
  } catch {
    return null;
  }
}

export function tokenSimilarity(a, b) {
  const ta = new Set(String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
  const tb = new Set(String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  return inter / Math.max(ta.size, tb.size);
}

export function compareCodeSimilarity(generated, reference) {
  const genFp = structuralFingerprint(generated);
  const refFp = structuralFingerprint(reference);
  if (genFp && refFp && genFp === refFp) {
    return { level: "exact", score: 1.0, structuralMatch: true };
  }
  const tokenScore = tokenSimilarity(generated, reference);
  let level = "low";
  if (tokenScore >= 0.92) level = "exact";
  else if (tokenScore >= 0.75) level = "high";
  else if (tokenScore >= 0.5) level = "medium";
  return { level, score: tokenScore, structuralMatch: false };
}

export function ipSimilarityGate(generatedCode, referenceCorpus = [], { maxHigh = 0 } = {}) {
  const violations = [];
  for (const ref of referenceCorpus) {
    const cmp = compareCodeSimilarity(generatedCode, ref.content || ref);
    if (cmp.level === "exact" || cmp.level === "high") {
      violations.push({ ...cmp, source: ref.source_id || ref.path || "unknown" });
    }
  }
  if (violations.length > maxHigh) {
    return { ok: false, reason: "ip_similarity_violation", violations };
  }
  return { ok: true, violations };
}
