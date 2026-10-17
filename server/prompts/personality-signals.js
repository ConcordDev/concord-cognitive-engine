// prompts/personality-signals.js
// Read evolution signals (prompts/personality.js recordInteraction) off one
// finished Concord reply. Pure text heuristics, bounded 0..1; the tracker
// itself caps every shift at 0.02 per interaction and waits for 10.

const clamp01 = (v) => Math.max(0, Math.min(1, v));

const DISAGREE_RE = /\b(nah|no,|i disagree|that's wrong|that ain't it|not really|actually,|i'd push back|wrong about)\b/i;
const CONTRACTION_RE = /\b\w+'(?:s|re|ve|ll|d|t|m)\b/gi;
const CASUAL_RE = /\b(yeah|nah|fr|lemme|gonna|wanna|kinda|bro|deadass|ain't)\b/gi;

export function personalitySignalsFromReply(reply) {
  const text = String(reply || "");
  const words = text.split(/\s+/).filter(Boolean);
  const n = words.length || 1;
  const questions = (text.match(/\?/g) || []).length;
  const contractions = (text.match(CONTRACTION_RE) || []).length;
  const casual = (text.match(CASUAL_RE) || []).length;
  return {
    verbosity_used: clamp01(n / 300),
    questions_asked: clamp01(questions / 2),
    disagreement_expressed: DISAGREE_RE.test(text) ? 0.8 : 0.3,
    formality_level: clamp01(0.7 - ((contractions + 2 * casual) / n) * 6),
  };
}
