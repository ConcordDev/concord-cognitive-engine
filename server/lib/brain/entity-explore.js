// lib/brain/entity-explore.js
//
// The entity "explore a lens" call (POST /api/brain/entity/explore and the
// heartbeat explorer). Every successful call is saved as a DTU, so a bad
// generation does not just look wrong once: it lands in the substrate.
//
// Live test on the A40 brains (2026-10-17): the utility slot
// (concord-core-v6, a 1.9B qwen3.5 fine-tune) answered with empty text, a
// bare [TOOL_CALL ...] marker, or rambling. Three causes, measured
// directly against the pod:
//   1. The model thinks by default. callBrain never sent think:false, and
//      the 400-token budget went to the hidden thinking channel; content
//      came back empty or cut off.
//   2. The prompt fought itself: the utility identity says "you execute,
//      you don't get creative, you don't talk", the task says "generate an
//      insight", and enableTools appended a tool catalog the model then
//      answered with instead of an insight. The marker was saved as a DTU.
//   3. temperature 0.8 plus the Modelfile's presence_penalty 1.5 on a 2B
//      model drifts off topic.
// With a focused prompt, think:false, temperature 0.2 and presence 0 it
// writes a short on-topic sentence. It is still shallow, which is why the
// brain slot can be pointed at the conscious instruct model
// (CONCORD_ENTITY_EXPLORE_BRAIN=conscious).

const MAX_NOTES_CHARS = 3500;

/** The DTU notes as text (buildBrainContext can return a sovereign object). */
export function contextText(lensData) {
  if (lensData == null) return "";
  if (typeof lensData === "string") return lensData;
  if (typeof lensData === "object" && typeof lensData.context === "string") return lensData.context;
  return "";
}

/** One focused instruction: an insight drawn from the notes, plain prose. */
export function buildEntityExplorePrompt({ lens, context, entity } = {}) {
  const domain = String(lens || "general").replace(/[_-]+/g, " ").slice(0, 60);
  const notes = contextText(context).slice(0, MAX_NOTES_CHARS).trim();
  const who = entity?.species && entity.species !== "unknown" ? ` Write as a curious ${String(entity.species).slice(0, 40)} explorer, but do not mention yourself.` : "";
  const system = notes
    ? `You are a ${domain} research assistant. From the domain notes below, write ONE specific insight that connects two or more of the notes. 2-4 sentences of plain prose. No lists, no headings, no tool calls, no questions back. Do not mention entities, brains, DTUs or Concord. Use only facts that are in the notes.${who}\n\nNOTES:\n${notes}`
    : `You are a ${domain} research assistant. Write ONE specific, factual insight about ${domain} in 2-4 sentences of plain prose. No lists, no headings, no tool calls. Do not mention entities, brains, DTUs or Concord. If you are not sure of a fact, leave it out.${who}`;
  return { system, user: "Write the insight." };
}

/** callBrain options for the explore call. */
export function exploreCallOptions(system) {
  return {
    system,
    temperature: 0.2,
    presencePenalty: 0,
    think: false,
    maxTokens: 300,
    timeout: 30000,
    enableTools: false,
  };
}

/** Which brain slot runs the explore call. Default utility; conscious is the measured better fit. */
export function exploreBrainName(env = process.env) {
  const v = String(env.CONCORD_ENTITY_EXPLORE_BRAIN || "utility").trim().toLowerCase();
  return ["utility", "conscious", "subconscious"].includes(v) ? v : "utility";
}

const WORD_RE = /[A-Za-z][A-Za-z'’-]*/g;

/**
 * Is this worth saving as a DTU? Rejects empty text, a bare tool-call
 * marker, leaked thinking, very short fragments, text that is mostly not
 * words, and heavy repetition. Cheap and deterministic; it does not judge
 * truth, only whether the text is a usable sentence or two.
 */
export function assessExploreOutput(text) {
  const t = String(text || "").trim();
  if (!t) return { ok: false, reason: "empty" };
  if (/\[TOOL_CALL:/i.test(t)) return { ok: false, reason: "tool_call_marker" };
  if (/<\/?think>/i.test(t) || /^(?:thinking process|okay, (?:so|let'?s))/i.test(t)) return { ok: false, reason: "thinking_leak" };
  // The fine-tune's chat persona leaking into what should be a domain note.
  if (/\b(?:speaking for myself|not the company|as an ai\b|i'?m an assistant|as a language model)/i.test(t)) return { ok: false, reason: "persona_leak" };
  const words = t.match(WORD_RE) || [];
  if (words.length < 12) return { ok: false, reason: "too_short" };
  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters / t.length < 0.6) return { ok: false, reason: "not_prose" };
  const lower = words.map((w) => w.toLowerCase());
  const uniq = new Set(lower).size;
  if (uniq / lower.length < 0.4) return { ok: false, reason: "repetitive" };
  // Made-up all-caps tokens repeated ("DHTP made this a DHTP word").
  const caps = words.filter((w) => w.length >= 3 && w === w.toUpperCase());
  if (caps.length >= 2 && new Set(caps).size < caps.length) return { ok: false, reason: "garbled" };
  if (!/[.!?]["')\]]?\s*$/.test(t)) return { ok: false, reason: "unfinished" };
  return { ok: true, reason: null };
}
