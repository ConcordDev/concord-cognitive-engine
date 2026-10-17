// server/lib/chat/agent-route.js
//
// Chat lens → agent tool loop for tool-worthy prompts.
//
// Live-test finding (2026-10-17, A40 brains): /api/chat and /api/chat/stream
// never called a tool. chat.respond has its own one-shot tool pass, but it
// only fires when the conscious model writes a [TOOL_CALL: …] marker inside
// the long persona prompt, and qwen3-30b-instruct never did (toolCallCount 0
// on every turn): "search the web … cite links" got an answer from memory
// with invented Bloomberg/Reuters URLs, "what do my DTUs know about heat
// pumps" got five invented DTUs. /api/chat-agent/stream runs the same model
// through runAgentLoop with a proper tool schema and it does call tools.
//
// So a prompt that plainly needs a tool (explicit web search, a lookup in
// the user's DTUs, a computation, a ConKay design) is answered by the same
// loop (chat_agent.do). Everything else keeps the conversational path.
// CONCORD_CHAT_AGENT_ROUTE=0 turns the routing off.

import { collectRetrievedDtus, guardDtuCitations } from "./dtu-citation-guard.js";
import { compactVoiceBlock } from "../../prompts/voice.js";

const WEB_RE = [
  /\b(?:search|check|look)\s+(?:the\s+)?(?:web|internet|online)\b/i,
  /\bsearch\s+(?:for|online)\b/i,
  /\blook\s+(?:it\s+|this\s+|that\s+)?up\b/i,
  /\b(?:latest|today'?s|this week'?s|breaking)\s+news\b/i,
  /\bnews\s+(?:today|about|on)\b/i,
  /\b(?:current|latest|live|today'?s)\s+(?:price|prices|rate|rates|score|scores|status|weather|trend)\b/i,
  /\bprice\s+(?:trend|today|now)\b/i,
  /\bcite\s+(?:your\s+)?sources?\b/i,
  /\bwith\s+(?:links|sources|citations)\b/i,
  /\bfact[- ]?check\b/i,
];

const DTU_RE = [
  /\b(?:my|our|the)\s+(?:concord\s+)?(?:dtus?|substrate|lattice|knowledge\s+base)\b/i,
  /\b(?:search|find|look\s+up|list|show)\s+(?:my\s+)?dtus?\b/i,
  /\bcite\s+the\s+dtus?\b/i,
  /\bdtus?\s+(?:about|on|for|that)\b/i,
];

const COMPUTE_RE = [
  /\b(?:compute|calculate|evaluate|integrate|differentiate|solve|simplify)\b/i,
  /\b(?:integral|derivative|eigenvalues?|determinant)\s+of\b/i,
];

const MATH_CONTENT_RE = /\d|[\^=+*/]|\b(?:integral|derivative|equation|matrix|sqrt|log|sin|cos|tan|polynomial|eigen\w*|determinant)\b/i;

const DESIGN_RE = [
  /\bconkay\b/i,
  /\b(?:design|size|sizing)\b[^.?!]{0,60}\b(?:cantilever|beam|bracket|shaft|gear|truss|column|spring|bolt|weld|plate|frame|part)\b/i,
  /\bsafety\s+factor\b/i,
];

// "save this as a DTU" is an explicit write; chat.respond handles it.
const DTU_SAVE_RE = /\b(?:save|store|remember|mint|create|make)\b[^.?!]{0,40}\b(?:as\s+(?:a\s+)?dtu|dtu)\b/i;

/**
 * Why this prompt should go through the agent tool loop, or null.
 * @returns {null | "web" | "dtu" | "compute" | "design"}
 */
export function chatAgentRoute(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length > 4000) return null;
  if (String(process.env.CONCORD_CHAT_AGENT_ROUTE || "1") === "0") return null;
  if (DTU_SAVE_RE.test(p)) return null;
  if (DESIGN_RE.some((r) => r.test(p))) return "design";
  if (WEB_RE.some((r) => r.test(p))) return "web";
  if (DTU_RE.some((r) => r.test(p))) return "dtu";
  // "solve conflicts with my coworker" is not a computation: needs math content too.
  if (COMPUTE_RE.some((r) => r.test(p)) && MATH_CONTENT_RE.test(p)) return "compute";
  return null;
}

const ROUTE_HINT = {
  web: "This request needs live web information: call web_search first and answer only from its results.",
  dtu: "This request is about the user's DTUs: look them up with run_lens_action dtu.search (or expert_mode) and cite only DTUs the tool returned. If none match, say so.",
  compute: "This request is a computation: use run_compute (or the compute engines) rather than doing the math in your head.",
  design: "This request is a ConKay design: call the conkay_design tool with the spec in words (span, load, material, supports, safety factor) and report the solver's real numbers. For a full design from a brief, use run_lens_action conkay_design.from-brief.",
};

/** One-line system hint for the agent loop, by route. */
export function routeHint(route) {
  return ROUTE_HINT[route] || "";
}

/** Pull web sources out of agent tool calls for the chat envelope. */
export function sourcesFromToolCalls(toolCalls) {
  const out = [];
  const seen = new Set();
  for (const tc of Array.isArray(toolCalls) ? toolCalls : []) {
    if (tc?.tool !== "web_search" || !tc.ok) continue;
    let parsed = null;
    try { parsed = typeof tc.result === "string" ? JSON.parse(tc.result) : tc.result; } catch { parsed = null; }
    for (const r of parsed?.results || []) {
      if (!r?.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ type: "web", title: r.title || r.url, url: r.url, snippet: r.snippet || "" });
    }
  }
  return out;
}

/**
 * Answer one chat turn through chat_agent.do.
 * @param {object} deps
 * @param {Function} deps.runMacro      server runMacro(domain, name, input, ctx)
 * @param {object}   deps.ctx           chat ctx (needs db + actor.userId)
 * @param {Array}    deps.history       prior turns as {role, content}, current turn excluded
 * @param {string}   deps.prompt
 * @param {string}   deps.route         from chatAgentRoute
 * @returns {Promise<null | {reply, toolCalls, artifacts, sources, provider, model, linksRemoved, dtuRefsRemoved}>}
 */
export async function answerViaAgent({ runMacro, ctx, history = [], prompt, route }) {
  if (typeof runMacro !== "function" || !ctx?.db || !ctx?.actor?.userId || !route) return null;
  const r = await runMacro("chat_agent", "do", {
    message: prompt,
    history: (history || []).slice(-12),
    maxTurns: 5,
    routeHint: routeHint(route),
    // Concord's voice for the reply (CONCORD_VOICE); the route hint stays last.
    voiceBlock: compactVoiceBlock(),
  }, ctx);
  if (!r?.ok || !String(r.answer || "").trim()) return null;
  // DTUs the reply may cite: the ones the loop put in its prompt plus any a
  // tool returned. Anything else is invented.
  const g = guardDtuCitations(String(r.answer).trim(), collectRetrievedDtus(r.contextDtus || [], r.toolCalls || []), { prompt });
  return {
    reply: g.text,
    toolCalls: Array.isArray(r.toolCalls) ? r.toolCalls : [],
    artifacts: Array.isArray(r.artifacts) ? r.artifacts : [],
    sources: sourcesFromToolCalls(r.toolCalls),
    provider: r.provider || null,
    model: r.model || null,
    linksRemoved: r.linksRemoved || [],
    dtuRefsRemoved: g.removed,
  };
}
