// server/lib/conkay/build/planner.js
//
// Kay plans a build (owner, 2026-11-26: "Kay designs, solvers check"). The
// model reads the brief and the catalogue of what ConKay can check, and
// writes a Design IR graph: parts with shapes and materials, and on them the
// solver inputs the brief touches (a frame, a pipe network, a DC budget…).
// It lists what it needs to look up and the questions only the person can
// answer. Lookups run against the textbook index and the passages go back to
// the model so the constants it uses carry their source. The plan is then
// normalised to SI, compiled, and repaired from the compiler's own errors.
//
// The model never states a result. Every number the person sees comes from
// a solver run on this graph; what no solver checked is reported as a gap.

import { selectFamilies, catalogueText } from "./catalogue.js";
import { normalizePlan } from "./normalize.js";
import { softenDesignIR, formatIrErrors } from "../compiler/soften-ir.js";
import { DesignGraph } from "../graph/design-graph.js";

const MAX_REPAIRS = 3;
const MAX_LOOKUPS = 4;

const SYSTEM = [
  "You are Kay, ConKay's design engineer. You turn what a person wants built into a design graph that ConKay's solvers check.",
  "Reply with ONE JSON object and nothing else:",
  '{ "summary": "one sentence: what you are building", "ir": { "design": { "id", "name" }, "materials"?: {…}, "nodes": [...], "edges": [...] },',
  '  "lookups": [{ "query": "words to search a textbook for", "for": "which value it gives" }],',
  '  "questions": [{ "ask": "a question only the person can answer", "blocking": true|false, "default"?: "what you assume if they do not answer" }],',
  '  "assumptions": ["each choice you made that the person did not state, and why"] }',
  "Rules:",
  "- Build what was asked, whatever it is. Break it into its real parts and put on them every check from the catalogue that applies. Do not turn it into a single beam.",
  "- Write quantities as strings with units, in the person's own units when they gave them (\"3 ft\", \"2 fl oz\", \"70 °F\").",
  "- Never invent a material constant. Use a library material, or a value from a textbook passage you were given (cite it as the source), or put a lookup for it. A value the person gave is sourced \"the person\".",
  "- A material you define under materials gets its \"category\" (metal, wood, ceramic, polymer, composite) so its scatter is known when the design is checked for uncertainty.",
  "- Ask a question only when the answer changes the design and you cannot reasonably assume it; mark it blocking only when nothing useful can be checked without it. Otherwise assume, and say so in assumptions.",
  "- Give parts positions so the assembly is laid out; z is up.",
].join("\n");

function extractJson(text) {
  const s = String(text || "");
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const body = fence ? fence[1] : s;
  const a = body.indexOf("{");
  if (a < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = a; i < body.length; i++) {
    const c = body[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) { try { return JSON.parse(body.slice(a, i + 1)); } catch { return null; } }
  }
  return null;
}

/** Compile a planned IR the same way openDesign will; returns { ok, ir (solver-ready), source (as written), errors, warnings }. */
export function checkPlan(rawIr) {
  if (!rawIr || typeof rawIr !== "object" || !Array.isArray(rawIr.nodes) || !rawIr.nodes.length) return { ok: false, errors: ["the plan has no nodes"] };
  const norm = normalizePlan({ design: { id: "build", name: "build" }, ...rawIr });
  if (norm.errors.length) return { ok: false, errors: norm.errors };
  const soft = softenDesignIR(norm.ir);
  const built = DesignGraph.fromIR(soft.ir);
  if (!built.ok) return { ok: false, errors: built.errors, warnings: soft.warnings };
  // `source` keeps the plan as written (the person's units); `ir` is what the solvers read.
  return { ok: true, ir: soft.ir, source: { design: { id: "build", name: "build" }, edges: [], loadCases: [], requirements: [], ...rawIr }, warnings: [...soft.warnings, ...(built.warnings || [])] };
}

/**
 * Plan a build. chat(messages) → { ok, text, error? } is the model;
 * lookup(query) → { ok, results: [{ book, section, url, passage }] } is the textbook index.
 * Returns { ok, ir, summary, questions, assumptions, sources, warnings, attempts } or { ok:false, error, ... }.
 */
export async function planBuild({ brief, answers = [], previous = null, chat, lookup }) {
  const text = [brief, ...answers.map((a) => `${a.ask ? `${a.ask} → ` : ""}${a.answer}`)].join("\n");
  if (!String(brief || "").trim()) return { ok: false, error: "tell me what to build" };
  if (typeof chat !== "function") return { ok: false, error: "no_model", message: "I need my language model to plan a new design, and I can't reach it right now. Try again in a minute." };
  const families = selectFamilies(text);
  const messages = [
    { role: "system", content: `${SYSTEM}\n\n# What ConKay can check\n\n${catalogueText(families)}` },
    { role: "user", content: [
      `Build: ${brief}`,
      answers.length ? `The person answered:\n${answers.map((a) => `- ${a.ask ? `${a.ask}: ` : ""}${a.answer}`).join("\n")}` : "",
      previous ? `Your previous plan (revise it with the answers; keep what still holds):\n${JSON.stringify(previous).slice(0, 6000)}` : "",
    ].filter(Boolean).join("\n\n") },
  ];
  const sources = [];
  let attempts = 0;
  let lookedUp = false;
  let plan = null;
  let lastErrors = [];
  while (attempts < 1 + MAX_REPAIRS + 1) {
    attempts += 1;
    const r = await chat(messages);
    if (!r?.ok) return { ok: false, error: "no_model", message: "I can't reach my language model right now, so I can't plan this design yet. Try again in a minute.", detail: r?.error || null };
    plan = extractJson(r.text);
    messages.push({ role: "assistant", content: String(r.text || "").slice(0, 12000) });
    if (!plan) { messages.push({ role: "user", content: "That was not one JSON object. Reply with only the JSON object described." }); lastErrors = ["reply was not JSON"]; continue; }
    // Textbook lookups once: run them, hand the passages back, let the model place the values.
    const asks = Array.isArray(plan.lookups) ? plan.lookups.filter((l) => l?.query).slice(0, MAX_LOOKUPS) : [];
    if (asks.length && !lookedUp && typeof lookup === "function") {
      lookedUp = true;
      const found = [];
      for (const l of asks) {
        let res = null;
        try { res = await lookup(String(l.query)); } catch (e) { res = { ok: false, error: e.message }; }
        const hits = res?.ok ? (res.results || []).slice(0, 2) : [];
        for (const h of hits) sources.push({ for: l.for || l.query, query: l.query, book: h.book, section: h.section, url: h.url, passage: String(h.passage || "").slice(0, 600) });
        found.push(hits.length
          ? `For "${l.for || l.query}" (searched "${l.query}"):\n${hits.map((h) => `[${h.book}, ${h.section}] ${String(h.passage || "").slice(0, 600)}`).join("\n")}`
          : `For "${l.for || l.query}": nothing found${res?.error ? ` (${res.error})` : ""}. Ask the person or leave the value out; do not guess it.`);
      }
      messages.push({ role: "user", content: `Textbook passages:\n\n${found.join("\n\n")}\n\nUse the values these passages state, cited as "<book>, <section>". Reply with the full revised JSON object, lookups empty.` });
      continue;
    }
    const checked = checkPlan(plan.ir);
    if (checked.ok) {
      return {
        ok: true, ir: checked.source, summary: String(plan.summary || "").slice(0, 400),
        questions: (Array.isArray(plan.questions) ? plan.questions : []).filter((q) => q?.ask).map((q) => ({ ask: String(q.ask), blocking: q.blocking === true, ...(q.default ? { default: String(q.default) } : {}) })).slice(0, 6),
        assumptions: (Array.isArray(plan.assumptions) ? plan.assumptions : []).map(String).slice(0, 20),
        sources, warnings: checked.warnings, attempts,
      };
    }
    lastErrors = checked.errors;
    if (attempts > MAX_REPAIRS) break;
    const fmt = formatIrErrors(checked.errors, checked.warnings || []);
    messages.push({ role: "user", content: `The compiler rejected the design graph:\n${checked.errors.slice(0, 12).map((e) => `- ${e}`).join("\n")}${fmt?.hints?.length ? `\nHints:\n${fmt.hints.map((h) => `- ${h}`).join("\n")}` : ""}\nFix these and reply with the full JSON object.` });
  }
  return { ok: false, error: "plan_invalid", message: "I couldn't turn that into a design graph the solvers accept.", errors: lastErrors, attempts, sources };
}
