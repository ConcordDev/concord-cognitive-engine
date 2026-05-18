// server/domains/studio-mastering.js
//
// Studio Sprint A — Item #9: brain-coached mastering assistant.
//
// The frontend's `lib/daw/mastering-analysis.ts` runs a BS.1770-compliant
// loudness analyser + spectral-balance pass against the live master bus
// and ships the compact summary here. We ask the utility brain to
// translate the numbers into producer-readable coaching ("kick is
// fighting bass at 60Hz, try -3dB shelf").
//
// A deterministic fallback runs when the brain is unavailable so the
// macro never blocks the panel.

const TIMEOUT_MS = 8000;
const MAX_NARRATIVE_CHARS = 1200;

function clampTarget(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return -14;
  return Math.min(-6, Math.max(-24, n));
}

function validateSummary(s) {
  if (!s || typeof s !== "object") return null;
  const integrated = Number(s.integratedLUFS);
  const truePeak = Number(s.truePeak);
  const dr = Number(s.dynamicRange);
  if (!Number.isFinite(integrated) || !Number.isFinite(truePeak)) return null;
  return {
    integratedLUFS: integrated,
    truePeak,
    dynamicRange: Number.isFinite(dr) ? dr : 0,
    hottestBand: String(s.hottestBand || "mid"),
    quietestBand: String(s.quietestBand || "air"),
    imbalances: Array.isArray(s.imbalances) ? s.imbalances.slice(0, 8).map(String) : [],
    loudnessVsTarget: Number.isFinite(Number(s.loudnessVsTarget)) ? Number(s.loudnessVsTarget) : 0,
  };
}

/**
 * Deterministic fallback. Reads the analysis summary and writes a
 * coaching narrative + a list of actionable suggestions. Never calls
 * out to the brain.
 */
function deterministicCoach(summary, target) {
  const suggestions = [];
  const gap = summary.integratedLUFS - target;
  if (gap < -2) {
    suggestions.push({
      kind: "loudness",
      severity: "high",
      text: `You're ${Math.abs(gap).toFixed(1)} LU under the ${target} LUFS target. Push the limiter ceiling or raise pre-gain on the master bus.`,
    });
  } else if (gap > 1) {
    suggestions.push({
      kind: "loudness",
      severity: "medium",
      text: `You're ${gap.toFixed(1)} LU over target. Pull the limiter back to keep dynamics intact.`,
    });
  }
  if (summary.truePeak > -0.3) {
    suggestions.push({
      kind: "true_peak",
      severity: "high",
      text: `True peak at ${summary.truePeak.toFixed(1)} dBTP risks inter-sample clipping on consumer DACs. Drop the limiter ceiling to at least -1.0 dBTP.`,
    });
  }
  if (summary.dynamicRange > 0 && summary.dynamicRange < 4) {
    suggestions.push({
      kind: "dynamics",
      severity: "medium",
      text: `Loudness range is only ${summary.dynamicRange.toFixed(1)} dB — the mix is very flat. Consider relaxing the multiband compressor on the loud sections.`,
    });
  }
  for (const note of summary.imbalances) {
    suggestions.push({ kind: "spectral", severity: "low", text: note });
  }
  if (suggestions.length === 0) {
    suggestions.push({
      kind: "ok",
      severity: "low",
      text: `Loudness, peak and balance all sit in spec. Master is ready for export.`,
    });
  }
  const narrative = `Integrated loudness ${summary.integratedLUFS.toFixed(1)} LUFS (target ${target}). True peak ${summary.truePeak.toFixed(1)} dBTP, range ${summary.dynamicRange.toFixed(1)} dB. Hottest band: ${summary.hottestBand}; quietest: ${summary.quietestBand}.`;
  return {
    ok: true,
    composer: "deterministic",
    narrative,
    suggestions,
  };
}

async function brainCoach(summary, target) {
  let chat;
  try {
    const router = await import("../lib/brain-router.js");
    if (typeof router.callBrain === "function") {
      chat = (sys, user) => router.callBrain("utility", { system: sys, prompt: user });
    }
  } catch { /* router missing — fall through */ }
  if (!chat) return null;
  const sys = [
    "You are a mastering engineer coaching a producer.",
    "You will be given a master-bus analysis. Reply with two short paragraphs:",
    "1) One sentence stating loudness vs target and any true-peak risk.",
    "2) One sentence per real problem (max 3) naming the band in Hz and a specific dB move.",
    "Never invent measurements outside what you were given. No headers, no lists, no preamble.",
  ].join(" ");
  const body = [
    `Target: ${target} LUFS`,
    `Integrated: ${summary.integratedLUFS.toFixed(1)} LUFS`,
    `True peak: ${summary.truePeak.toFixed(1)} dBTP`,
    `Loudness range: ${summary.dynamicRange.toFixed(1)} dB`,
    `Hottest band: ${summary.hottestBand}`,
    `Quietest band: ${summary.quietestBand}`,
    `Imbalances: ${summary.imbalances.join("; ") || "none"}`,
  ].join("\n");
  try {
    const timeout = new Promise((_r, reject) => setTimeout(() => reject(new Error("llm_timeout")), TIMEOUT_MS));
    const result = await Promise.race([chat(sys, body), timeout]);
    const text = typeof result === "string" ? result
      : result?.content || result?.text || result?.message?.content;
    if (typeof text !== "string" || text.length < 20) return null;
    return text.trim().slice(0, MAX_NARRATIVE_CHARS);
  } catch {
    return null;
  }
}

export default function registerStudioMasteringMacros(register) {
  register("studio", "coach_mastering", async (_ctx, input = {}) => {
    const summary = validateSummary(input.summary);
    if (!summary) return { ok: false, reason: "invalid_summary" };
    const target = clampTarget(input.targetLUFS ?? -14);
    const det = deterministicCoach(summary, target);
    if (input.deterministic === true) return det;
    const llm = await brainCoach(summary, target);
    if (!llm) return det;
    return {
      ok: true,
      composer: "utility_brain",
      narrative: llm,
      // Suggestions stay deterministic (they're the actionable list);
      // the narrative is what the brain writes.
      suggestions: det.suggestions,
    };
  }, { note: "coach a mastering session from a BS.1770 analysis summary", requiresLLM: true });
}
