/**
 * GRC v1 Formatter — Grounded Recursive Closure output formatter
 *
 * Transforms raw LLM output + DTU context into the canonical GRC shape.
 * Handles both cases:
 *   1) LLM returns structured GRC JSON → validate and pass through
 *   2) LLM returns freeform text → wrap into GRC envelope with inferred anchors
 *
 * This is the single exit gate for all Concord LLM responses.
 */

import { validateGRC, FORBIDDEN_PATTERNS } from "./schema.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

// ---- Formatting ----

/**
 * Format a raw LLM response into GRC shape.
 *
 * @param {string} rawContent - Raw LLM output text
 * @param {object} context - Execution context
 * @param {string[]} context.dtuRefs - DTU IDs/titles used in prompt
 * @param {string[]} context.macroRefs - Macro domain.name references
 * @param {string[]} context.stateRefs - State keys referenced
 * @param {string} context.mode - Governance mode (e.g. 'governed-response')
 * @param {string[]} context.invariantsApplied - Invariants enforced during run
 * @param {object} context.realitySnapshot - { facts, assumptions, unknowns }
 * @returns {{ ok: boolean, grc: object|null, raw: string, validation: object }}
 */
export function formatGRC(rawContent, context = {}) {
  const {
    dtuRefs = [],
    macroRefs = [],
    stateRefs = [],
    mode = "governed-response",
    invariantsApplied = [],
    realitySnapshot = null,
  } = context;

  // Attempt 1: Try to parse as structured GRC JSON from LLM
  const parsed = tryParseGRC(rawContent);
  if (parsed) {
    // LLM returned structured output — validate and enrich
    const enriched = enrichGRC(parsed, context);
    const validation = validateGRC(enriched);
    return { ok: validation.valid, grc: enriched, raw: rawContent, validation };
  }

  // Attempt 2: Wrap freeform text into GRC envelope
  const envelope = buildGRCEnvelope(rawContent, {
    dtuRefs,
    macroRefs,
    stateRefs,
    mode,
    invariantsApplied,
    realitySnapshot,
  });

  const validation = validateGRC(envelope);
  return { ok: validation.valid, grc: envelope, raw: rawContent, validation };
}

/**
 * Try to extract a GRC JSON object from raw LLM output.
 * Handles: pure JSON, JSON in code fences, JSON prefix/suffix.
 */
function tryParseGRC(raw) {
  if (!raw || typeof raw !== "string") return null;

  // Strip markdown code fences
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Find JSON object boundaries
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    // Check if it looks like a GRC object
    if (obj.toneLock && obj.payload && obj.anchor) return obj;
    if (obj.payload && obj.nextLoop) return obj;
    return null;
  } catch {
    return null;
  }
}

/**
 * Enrich a parsed GRC object with context that the LLM may have missed.
 */
function enrichGRC(grc, context) {
  const out = { ...grc };

  // Ensure anchor has at least context refs
  if (!out.anchor) out.anchor = {};
  if (!out.anchor.dtus?.length && context.dtuRefs?.length) {
    out.anchor.dtus = context.dtuRefs;
  }
  if (!out.anchor.macros?.length && context.macroRefs?.length) {
    out.anchor.macros = context.macroRefs;
  }
  if (!out.anchor.mode && context.mode) {
    out.anchor.mode = context.mode;
  }

  // Ensure invariants include context ones
  if (!Array.isArray(out.invariants)) out.invariants = [];
  if (context.invariantsApplied?.length) {
    const existing = new Set(out.invariants);
    for (const inv of context.invariantsApplied) {
      if (!existing.has(inv)) out.invariants.push(inv);
    }
  }

  // Ensure toneLock exists
  if (!out.toneLock) out.toneLock = "Aligned.";

  // Ensure reality object exists
  if (!out.reality) {
    out.reality = context.realitySnapshot || { facts: [], assumptions: [], unknowns: [] };
  }

  return out;
}

/**
 * Build a GRC envelope around freeform text.
 * Used when the LLM did not return structured GRC JSON.
 */
function buildGRCEnvelope(rawContent, context) {
  const {
    dtuRefs = [],
    macroRefs = [],
    stateRefs = [],
    mode = "governed-response",
    invariantsApplied = [],
    realitySnapshot = null,
  } = context;

  // Select tone lock
  const toneLock = "Aligned.";

  // Build anchor from context
  const anchor = {
    dtus: dtuRefs.length > 0 ? dtuRefs : ["general-context"],
    macros: macroRefs,
    stateRefs: stateRefs,
    mode: mode,
  };

  // Build invariants (always include core set + context ones)
  const coreInvariants = ["NoNegativeValence", "RealityGateBeforeEffects"];
  const invariants = [...new Set([...coreInvariants, ...invariantsApplied])];

  // Build reality from context or derive minimal
  const reality = realitySnapshot || {
    facts: dtuRefs.length > 0
      ? [`Context includes ${dtuRefs.length} DTU reference(s)`]
      : ["No specific DTU context provided"],
    assumptions: ["LLM output is freeform; GRC envelope auto-applied"],
    unknowns: ["Full lattice state not inspected for this response"],
  };

  // Clean the payload
  const payload = cleanPayload(rawContent);

  // Generate recursion hook from payload content
  const nextLoop = inferNextLoop(payload, dtuRefs);

  // Generate recursive question
  const question = inferQuestion(payload, dtuRefs);

  return {
    toneLock,
    anchor,
    invariants,
    reality,
    payload,
    nextLoop,
    question,
  };
}

/**
 * Clean payload text: strip forbidden patterns, trim preambles.
 */
function cleanPayload(text) {
  if (!text || typeof text !== "string") return "";

  let cleaned = text.trim();

  // Remove forbidden patterns
  for (const pat of FORBIDDEN_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }

  // Collapse multiple newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

  return cleaned.trim();
}

/**
 * Infer a next loop from payload content.
 */
function inferNextLoop(payload, dtuRefs) {
  if (dtuRefs.length > 0) {
    return {
      name: "DTU Context Deepening",
      why: `Deepen grounding against ${dtuRefs.length} referenced DTU(s) and verify lattice consistency.`,
    };
  }
  return {
    name: "Lattice Anchor Discovery",
    why: "Locate relevant DTUs/state to ground future responses and reduce assumption surface.",
  };
}

/**
 * Infer a recursive question from payload content.
 */
function inferQuestion(payload, dtuRefs) {
  if (dtuRefs.length > 0) {
    return `Which DTU anchor should be deepened next to reduce unknowns in this context?`;
  }
  return `What lattice anchors should be established to ground this response domain?`;
}

// ---- GRC Prompt Template ----

/**
 * Returns the system prompt that forces LLM output into GRC shape.
 * Feed this to any of the Ollama brains (conscious/subconscious/utility).
 */
export function getGRCSystemPrompt(contextAnchors = {}) {
  const anchorStr = contextAnchors.dtus?.length
    ? `DTUs: [${contextAnchors.dtus.join(", ")}]`
    : "DTUs: [general-context]";

  return TASK_PROMPTS.grcFormatter({ anchorStr });
}
