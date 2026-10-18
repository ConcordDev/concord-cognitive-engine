// server/lib/chat/fea-honesty.js
//
// INC-128: ConKay ran engineering.runFEA twice, both failed ("model must have
// at least one node and one member"), and the answer still said "FEA and hand
// analysis both confirm pass". When every FEA run in the turn failed, claims
// of an FEA pass are removed and the failure is stated.

const FEA_KEY_RE = /runFEA|\bfea\b/i;

function feaOutcomes(toolCalls) {
  const out = [];
  for (const tc of Array.isArray(toolCalls) ? toolCalls : []) {
    if (!tc || typeof tc !== "object") continue;
    const key = String(tc.key || (tc.domain && tc.action ? `${tc.domain}.${tc.action}` : "") || tc.tool || "");
    let result = tc.result;
    if (typeof result === "string") { try { result = JSON.parse(result); } catch { result = null; } }
    if (tc.tool === "conkay_design" && result && typeof result === "object" && result.fea && typeof result.fea === "object") {
      out.push(result.fea.ok === true ? { ok: true } : { ok: false, error: String(result.fea.error || "the FEA solve failed") });
      continue;
    }
    if (tc.tool === "run_lens_action" && FEA_KEY_RE.test(key)) {
      const failed = tc.ok === false || (result && typeof result === "object" && result.ok === false);
      out.push(failed ? { ok: false, error: String(tc.error || result?.error || "the FEA run failed") } : { ok: true });
    }
  }
  return out;
}

const CLAIM_RES = [
  /\bFEA\b[^.!?\n]{0,80}\b(?:pass(?:es|ed)?|confirm\w*|verif\w*|validat\w*|check(?:s|ed)?\s+out|agree\w*|OK)\b/i,
  /\b(?:confirm\w*|verif\w*|validat\w*|back(?:ed)?\s+up)\s+(?:by|with|through|via)\s+(?:the\s+)?FEA\b/i,
  /\bFEA\b[^.!?\n]{0,40}\bshows?\b[^.!?\n]{0,60}\b(?:safe|pass\w*|within)\b/i,
];

/** Remove FEA-pass claims when the turn's FEA runs all failed; otherwise unchanged. */
export function guardFeaClaim(answer, toolCalls) {
  const text = String(answer ?? "");
  const runs = feaOutcomes(toolCalls);
  if (!runs.length || runs.some((r) => r.ok)) return text;
  const sentences = text.split(/(?<=[.!?])\s+|\n/);
  const kept = sentences.filter((s) => !CLAIM_RES.some((re) => re.test(s)));
  const err = runs.find((r) => r.error)?.error || "the FEA run failed";
  const note = `Note: the FEA run failed (${err.slice(0, 160)}), so there is no FEA result. Only the hand calculation stands.`;
  if (text.includes("Note: the FEA run failed")) return text;
  const body = kept.length === sentences.length ? text.trim() : kept.join(" ").replace(/\s{2,}/g, " ").trim();
  return body ? `${body}\n\n${note}` : note;
}

export default guardFeaClaim;
