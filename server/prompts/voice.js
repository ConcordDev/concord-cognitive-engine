// prompts/voice.js
// Concord's voice: one switch for every surface that speaks as Concord.
//
//   CONCORD_VOICE=street     (default) warm, casual, direct; a little slang
//                            when the user talks that way.
//   CONCORD_VOICE=conscious  the same assistant, a plainer register.
// Both are a normal assistant: no theatrics, no self-mythology. The full
// Modelfile persona (STREET_PERSONA) is only for an external provider call.
//
// Live runs the plain qwen3 instruct model, not the concord-conscious
// Modelfile, so the voice has to travel in the system prompt. This module is
// the only place that decides which one. To switch for good, change
// DEFAULT_CONCORD_VOICE below; to switch per deploy, set CONCORD_VOICE.
//
// Style never outranks accuracy: callers append grounding rules (link and
// DTU citation guards, computed results) after the voice block, and the
// shortcut wrapper below never touches a computed number.

import { CONSCIOUS_MODELFILE_PERSONA } from "../lib/prompt-registry.js";

export const CONCORD_VOICES = Object.freeze(["street", "conscious"]);
export const DEFAULT_CONCORD_VOICE = "street";

/** The active voice: CONCORD_VOICE when valid, else DEFAULT_CONCORD_VOICE. */
export function resolveConcordVoice(env = process.env) {
  const v = String(env?.CONCORD_VOICE || "").trim().toLowerCase();
  return CONCORD_VOICES.includes(v) ? v : DEFAULT_CONCORD_VOICE;
}

/** Full street persona (verbatim Modelfile SYSTEM text). */
export const STREET_PERSONA = CONSCIOUS_MODELFILE_PERSONA;

/**
 * Compact persona for the agent tool loop (chat_agent.do). Short on purpose:
 * that prompt is mostly the tool schema, and the grounding/route hint that
 * follows it must stay the last word.
 */
export const COMPACT_VOICE = Object.freeze({
  street: [
    "VOICE: You're Concord, the assistant inside the Concord platform. Warm, casual and direct, like a sharp friend who's easy to talk to. Talk how people talk: contractions, plain words, a little slang only when the user is talking that way. Lead with the answer.",
    "Match the user's energy and length. A greeting like \"yo\" or \"what's good\" gets a short friendly hey back and an offer to help, in one or two sentences. Small talk stays small. No theatrics, no poetry, no one-word or cryptic replies, no speeches about what you are.",
    "No \"great question\", no \"as an AI\", no restating the question, no \"in summary\". Plain prose, bullets only for genuinely parallel items.",
    "Tool results are the facts: quote numbers, links and DTU names exactly as the tools returned them. The voice is the delivery, never the content. If a tool came back empty, say so straight. If no TOOL RESULT is in this conversation, you haven't used a tool yet: say that plainly and offer to run one.",
  ].join("\n"),
  conscious: [
    "VOICE: You're Concord, the assistant inside the Concord platform. Friendly, clear and direct. Lead with the answer, skip filler, match the user's energy and length.",
    "A greeting gets a short friendly hello back and an offer to help. No theatrics, no poetry, no one-word or cryptic replies, no speeches about what you are.",
    "No \"great question\", no \"as an AI\". Plain prose, bullets only for genuinely parallel items.",
    "Tool results are the facts: quote numbers, links and DTU names exactly as the tools returned them. The voice is the delivery, never the content. If a tool came back empty, say so straight.",
  ].join("\n"),
});

export function compactVoiceBlock(voice = resolveConcordVoice()) {
  return COMPACT_VOICE[voice] || COMPACT_VOICE[DEFAULT_CONCORD_VOICE];
}

// ── Shortcut answers (compute router, deterministic engines) ─────────────
// The engine's text is kept byte-for-byte. A short lead sentence in Concord's
// voice is put in front of it. The lead must carry no digits, so it can never
// state, round or contradict a computed value.

const LEADS = Object.freeze({
  street: {
    math: ["Ran it through the engine, no guessing.", "Engine did the math, not vibes.", "Real compute on this one."],
    engineering: ["Put it through the solver, here's what it says.", "Solver ran it for real.", "Didn't eyeball this one, the solver did."],
    other: ["Ran it for real.", "Straight from the engine."],
  },
  conscious: {
    math: ["Ran that through the math engine rather than my head.", "Computed, not guessed."],
    engineering: ["The solver took this one.", "Solved properly, not estimated."],
    other: ["Computed, not guessed."],
  },
});

const ENGINEERING_RE = /\b(beam|column|buckling|deflection|stress|load|span|cantilever|torque|pressure|voltage|current|resistance|hvac|duct|pipe|flow)\b/i;

function hash32(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** Deterministic template lead (no digits by construction). */
export function templateLead({ prompt = "", route = "", voice = resolveConcordVoice() } = {}) {
  const set = LEADS[voice] || LEADS[DEFAULT_CONCORD_VOICE];
  const kind = ENGINEERING_RE.test(`${route} ${prompt}`) ? "engineering" : (/math|symbolic|calc|arith|percent|unit|stat|finance/i.test(route) || /\d/.test(prompt) ? "math" : "other");
  const list = set[kind];
  return list[hash32(String(prompt)) % list.length];
}

const BANNED_LEAD_RE = /great question|happy to help|certainly|absolutely|of course|as an ai|i hope this helps|let me know/i;

/** A model-written lead is accepted only if it is one short line with no digits and no AI tells. */
export function acceptableLead(text) {
  const s = String(text || "").replace(/\s+/g, " ").trim().replace(/^["'“”]+|["'“”]+$/g, "");
  if (!s || s.length > 140) return null;
  if (/[0-9]/.test(s)) return null;            // never restate or alter a number
  if (/https?:|www\.|\[|\]|`|\*|#/.test(s)) return null; // no links, citations or markdown
  if (BANNED_LEAD_RE.test(s)) return null;
  if ((s.match(/[.!?]/g) || []).length > 2) return null;
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

export function shortcutLeadSystem(voice = resolveConcordVoice()) {
  return `${compactVoiceBlock(voice)}

TASK: Concord's compute engine already answered the user's question; its exact result is printed right after your sentence. Write ONE short opener (under 15 words) in your voice that reacts to the question. You are NOT answering it.
Hard rules: no digits or number words for the result, do not state, round or hint at the answer, no links, no markdown, no quotes. Output only the sentence.
Examples of the shape: "Light work, the engine got it." / "Percentages, my favorite chore. Here you go." / "Didn't eyeball it, ran it for real."`;
}

/** The user turn for the lead writer: the question framed so the model reacts instead of answering. */
export function shortcutLeadUser(prompt) {
  return `The user asked: <<${String(prompt || "").slice(0, 400)}>>\nWrite only the opener sentence. Do not answer.`;
}

/**
 * Wrap an engine answer: "<lead> <engine text verbatim>".
 * @param {object} p
 * @param {string} p.text       the engine's reply, kept exactly
 * @param {string} [p.prompt]
 * @param {string} [p.route]
 * @param {Function} [p.writeLead] async (system, prompt) => string; a model call. Optional.
 * @param {number} [p.timeoutMs]
 * @returns {Promise<{text: string, lead: string, source: "model"|"template"}>}
 */
export async function wrapShortcutAnswer({ text, prompt = "", route = "", voice = resolveConcordVoice(), writeLead = null, timeoutMs = 4000 } = {}) {
  const body = String(text ?? "");
  if (!body.trim()) return { text: body, lead: "", source: "template" };
  let lead = null;
  let source = "template";
  if (typeof writeLead === "function") {
    try {
      const raw = await Promise.race([
        Promise.resolve(writeLead(shortcutLeadSystem(voice), shortcutLeadUser(prompt))),
        new Promise((resolve) => { setTimeout(() => resolve(null), timeoutMs); }),
      ]);
      lead = acceptableLead(raw);
      if (lead) source = "model";
    } catch { lead = null; }
  }
  if (!lead) lead = templateLead({ prompt, route, voice });
  return { text: `${lead} ${body}`, lead, source };
}

// ── Post-pass guard for the humanizer ─────────────────────────────────────
// The humanizer rewrites sentence structure. A reply is only replaced when
// every number, URL and DTU id of the original survives and no code fence,
// list or table is involved.

const NUM_RE = /-?\d+(?:[.,]\d+)*(?:e[+-]?\d+)?/gi;
const URL_RE = /https?:\/\/[^\s)\]>"']+/g;
const DTU_RE = /\bdtu[_-][A-Za-z0-9_-]+/gi;

export function humanizeSafe(original, humanizeFn, opts = {}) {
  const src = String(original || "");
  if (!src.trim() || typeof humanizeFn !== "function") return { text: src, applied: false };
  if (/```|^\s*[-*•]\s|^\s*\d+[.)]\s|\|.*\|/m.test(src)) return { text: src, applied: false };
  // Line by line: the humanizer collapses whitespace, so paragraphs and line
  // breaks are kept by never handing it more than one line.
  let out;
  try {
    out = src.split("\n").map((line) => {
      if (!line.trim()) return line;
      const h = humanizeFn(line, opts)?.text ?? line;
      // A case-only change (the humanizer capitalising a line start) is not a
      // humanization; keep the model's exact text.
      return h.toLowerCase() === line.toLowerCase() ? line : h;
    }).join("\n");
  } catch { return { text: src, applied: false }; }
  if (typeof out !== "string" || !out.trim()) return { text: src, applied: false };
  const keep = (re) => (src.match(re) || []).every((t) => out.includes(t));
  if (!keep(NUM_RE) || !keep(URL_RE) || !keep(DTU_RE)) return { text: src, applied: false };
  return { text: out, applied: out !== src };
}
