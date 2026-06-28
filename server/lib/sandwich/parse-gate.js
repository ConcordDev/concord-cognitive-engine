// server/lib/sandwich/parse-gate.js
//
// Parse gate — the TOP slice of the "verified semantic sandwich".
//
// Translates a natural-language query into a strict, validated intent
// ({ domain, name, input }, or a short ordered list for a multi-step DAG)
// using the utility brain with Ollama STRUCTURED OUTPUT (JSON-schema
// constrained decoding via opts.format). The returned args are validated
// against the candidate macro's declarative param schema
// (validateParamSchema) BEFORE anything downstream trusts them.
//
// Honesty contract: this gate NEVER guesses. If the model returns invalid
// JSON or args that fail the schema, it retries ONCE, then returns
// { ok:false, reason:'parse_failed' } so the caller can surface an honest
// "I couldn't understand that" instead of dispatching a fabricated macro.
//
// `llmFn` is injectable (defaults to the real ollamaChat) so tests run
// fully deterministically with no brain.
//
// NOTE: the deterministic decode/validate happens on CPU. The only model
// call here is the NL→JSON parse; there is no acceleration claim.

import { ollamaChat } from "../inference/ollama-client.js";
import { validateParamSchema } from "../macro-param-schema.js";

const PARSE_BRAIN = "utility";

/**
 * Default LLM function — real utility brain, structured-output mode.
 * @param {{ messages: object[], format: object }} args
 * @returns {Promise<{ ok:boolean, text:string }>}
 */
async function defaultLlmFn({ messages, format }) {
  return ollamaChat(PARSE_BRAIN, messages, { format, temperature: 0 });
}

/**
 * A candidate macro the parse gate may select. Shape:
 *   { domain, name, description?, paramSchema?, category? }
 * paramSchema is the same declarative shape macro-param-schema.js validates.
 */

/**
 * Build the JSON schema we hand to Ollama's `format` param. We constrain the
 * output to one of the candidate macros (enum on a "macro" key encoded as
 * "domain.name") plus a free-form input object. We deliberately keep `input`
 * permissive at the schema level (object) and enforce the REAL per-macro
 * param contract afterwards with validateParamSchema — the model is bad at
 * nested conditional schemas, good at "pick one label + emit a flat object".
 */
function buildResponseSchema(candidates) {
  const macroEnum = candidates.map((c) => `${c.domain}.${c.name}`);
  return {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            macro: { type: "string", enum: macroEnum },
            input: { type: "object" },
          },
          required: ["macro", "input"],
        },
      },
    },
    required: ["steps"],
  };
}

/**
 * Render the candidate catalog the model picks from. We include each macro's
 * declared params so the model fills the right keys (the #1 param-drift bug
 * class the schema validator then double-checks).
 */
function renderCatalog(candidates) {
  return candidates
    .map((c) => {
      const params = c.paramSchema
        ? Object.entries(c.paramSchema)
            .map(([k, r]) => {
              const bits = [r.type || "any"];
              if (r.required) bits.push("required");
              if (Array.isArray(r.enum)) bits.push(`enum:${r.enum.join("|")}`);
              return `${k} (${bits.join(", ")})`;
            })
            .join("; ")
        : "(no declared params)";
      return `- ${c.domain}.${c.name}: ${c.description || "no description"} | params: ${params}`;
    })
    .join("\n");
}

function buildMessages(nl, candidates) {
  const catalog = renderCatalog(candidates);
  const system =
    `You translate a user's request into one or more tool calls. ` +
    `Choose ONLY from the catalog below. Emit a JSON object ` +
    `{"steps":[{"macro":"domain.name","input":{...}}]}. ` +
    `Fill input with EXACTLY the declared param keys for the chosen macro — ` +
    `no extra keys, correct types. If the request needs several tools in order, ` +
    `list multiple steps. Never invent a macro that is not in the catalog.\n\n` +
    `CATALOG:\n${catalog}`;
  return [
    { role: "system", content: system },
    { role: "user", content: String(nl || "") },
  ];
}

function findCandidate(candidates, macroId) {
  const [domain, name] = String(macroId || "").split(".", 2);
  return candidates.find((c) => c.domain === domain && c.name === name) || null;
}

/**
 * Validate one model-proposed step against its candidate's param schema.
 * Returns { ok, step } or { ok:false }.
 */
function validateStep(step, candidates) {
  if (!step || typeof step !== "object") return { ok: false };
  const cand = findCandidate(candidates, step.macro);
  if (!cand) return { ok: false }; // hallucinated a macro outside the catalog
  const input = step.input && typeof step.input === "object" ? step.input : {};
  if (cand.paramSchema) {
    const v = validateParamSchema(cand.paramSchema, input);
    if (!v.ok) return { ok: false, errors: v.errors };
  }
  return { ok: true, step: { domain: cand.domain, name: cand.name, input } };
}

/**
 * Parse a single LLM response into validated, schema-checked steps.
 */
function parseResponse(text, candidates) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const rawSteps = Array.isArray(parsed?.steps) ? parsed.steps : null;
  if (!rawSteps || rawSteps.length === 0) return { ok: false, reason: "no_steps" };

  const steps = [];
  for (const raw of rawSteps) {
    const v = validateStep(raw, candidates);
    if (!v.ok) return { ok: false, reason: "schema_violation", errors: v.errors };
    steps.push(v.step);
  }
  return { ok: true, steps };
}

/**
 * Translate NL → validated intent.
 *
 * @param {string} nl
 * @param {{ candidates: object[], llmFn?: Function }} opts
 * @returns {Promise<{ ok:true, steps:Array<{domain,name,input}> } | { ok:false, reason:string }>}
 */
export async function parseIntent(nl, { candidates, llmFn = defaultLlmFn } = {}) {
  if (!nl || typeof nl !== "string" || !nl.trim()) {
    return { ok: false, reason: "empty_query" };
  }
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { ok: false, reason: "no_candidates" };
  }

  const messages = buildMessages(nl, candidates);
  const format = buildResponseSchema(candidates);

  // Two attempts: structured output occasionally fumbles. The second attempt
  // appends the prior failure so the model can self-correct. After two, we
  // fail honestly — no guessing.
  let lastReason = "parse_failed";
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      const attemptMessages =
        attempt === 0
          ? messages
          : [
              ...messages,
              {
                role: "user",
                content: `Your previous answer was rejected (${lastReason}). Return ONLY valid JSON matching the schema, with input keys exactly matching the chosen macro's declared params.`,
              },
            ];
      res = await llmFn({ messages: attemptMessages, format });
    } catch (e) {
      lastReason = "llm_error";
      continue;
    }
    if (!res || res.ok === false || !res.text) {
      lastReason = "llm_error";
      continue;
    }
    const parsed = parseResponse(res.text, candidates);
    if (parsed.ok) return { ok: true, steps: parsed.steps };
    lastReason = parsed.reason || "parse_failed";
  }

  return { ok: false, reason: "parse_failed", detail: lastReason };
}

export default { parseIntent };
