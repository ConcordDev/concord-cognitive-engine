// server/lib/conkay/agent-turn.js
//
// ConKay turn plan: which tool an ask needs, the hint the agent loop gets, and
// the call to run if the model answers from memory instead (runAgentLoop's
// opts.fallbackCall). Ramaj, 2026-10-17: ConKay "isn't using tools, isn't
// searching things up, just falls back to the model's knowledge". Live: the
// stream route gave the model no route hint at all (Chat's agent route did),
// so "run FEA on it" re-solved a different part, "render a concept image"
// drew a text graph, and a created task got an invented due date.
//
// Reuses Chat's router (lib/chat/agent-route.js) so both agree; adds the
// ConKay engineering cases (design → conkay_design, FEA on "it" → the last
// design brief).

import { chatAgentRoute, routeHint, webAgentMessage, realMusicTerm, isTextbookAsk } from "../chat/agent-route.js";

const PART_RE = /\b(?:bracket|beam|i-?beam|cantilever|shaft|truss|column|plate|frame|part|mount|bridge|footbridge|joist|girder|lintel|shelf|hook|axle|spring|rod|bar)s?\b/i;
const DESIGN_VERB_RE = /\b(?:design|build|size|sizing|make|create|model|engineer|spec|check)\b/i;
const LOAD_RE = /\b\d+(?:\.\d+)?\s*(?:k?n|kgs?|kilograms?|lbs?|pounds?|tons?|tonnes?|kn)\b|\b(?:holds?|support(?:s|ing)?|carry|carries|load(?:ed)?)\b/i;
const FEA_RE = /\b(?:fea|finite[- ]element|stress analysis|structural analysis|simulat(?:e|ion)|analy[sz]e (?:it|this|that|the (?:design|part|bracket|beam|model))|re-?run (?:it|the solver)|check (?:the )?(?:stress|deflection|safety factor))\b/i;
const NEW_MUSIC_RE = /\b(?:make|compose|write|create|generate|produce)\b/i;

/** A ConKay design ask: a part noun + a design verb or a load. */
export function isDesignAsk(text) {
  const p = String(text || "");
  return PART_RE.test(p) && (DESIGN_VERB_RE.test(p) || LOAD_RE.test(p)) && !/\b(?:image|picture|photo|illustration|drawing|song|music)\b/i.test(p);
}

/** The most recent design brief the user gave in this conversation. */
export function lastDesignBrief(history = []) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role === "user" && isDesignAsk(h.content)) return String(h.content).trim().slice(0, 600);
  }
  return null;
}

const DESIGN_HINT = "This is a ConKay design ask. Call conkay_design with the user's spec in words (part, load, material, supports, safety factor). It runs the hand calculation and the FEA solver and returns a 3D model the interface shows below your reply. Report the solver's real numbers and pass/fail, list the assumed defaults, and say the model is shown below. Never state numbers the tool did not return.";

const POLICY = [
  "TOOL POLICY (ConKay, overrides any style instruction above): you answer with tools, not from memory.",
  "• Facts, products, prices, specs, current events, anything you would otherwise recall: web_search first, then answer from the results with their links. If the snippets lack the number asked for, browse_url the best result and quote the number from that page. For news, lead with the newest dated items and name each outlet and date.",
  "• Textbook, science and engineering facts (material constants, laws, definitions, formulas) or any ask for a textbook/OpenStax source: textbook_lookup first; quote the numbers with units and cite book, section and link. If it has nothing, web_search. Never guess a value; if no source has it, say so.",
  "• Designing or sizing a part: conkay_design (hand calc + FEA + 3D model). FEA on a design already discussed: conkay_design again with that same brief. If an FEA result has ok:false, say the FEA failed; never claim an FEA pass. A part conkay_design does not support (shaft, gear, spring...): work it out with run_python, showing the formula and inputs.",
  "• Images: generate_image. A new song: run_lens_action studio.compose; a real song: run_lens_action music.ingest-itunes. Say it is ready to play below, never that it is playing.",
  "• Creating or changing something in Concord (tasks, events, notes): run_lens_action (find_lens_actions if unsure), then report only what the tool stored. Never invent dates, ids or details.",
  "• Do not say \"On it\" or describe a tool you did not call. If a tool fails or returns nothing, say so plainly.",
].join("\n");

/** The fixed ConKay tool policy, appended after the persona. */
export function conkayToolPolicy() {
  return POLICY;
}

/**
 * @returns {{ route: string, hint: string, fallbackCall: object|null, brief?: string } | null}
 */
export function conkayTurnPlan(message, history = []) {
  const p = String(message || "").trim();
  if (!p) return null;
  const prevReply = [...(history || [])].reverse().find((h) => h?.role === "assistant")?.content || "";
  const route = chatAgentRoute(p, { prevReply });
  // "create a task: call the machinist about the bracket" is a lens write, not a design.
  const writeFirst = route === "action" || route === "save" || route === "music" || route === "browse";

  if (!writeFirst && FEA_RE.test(p)) {
    const brief = isDesignAsk(p) ? p : lastDesignBrief(history);
    if (brief) {
      return {
        route: "fea",
        brief,
        hint: `The user wants FEA on this design: "${brief}". Call conkay_design with exactly that brief (it runs the FEA solver as well as the hand calculation and returns the 3D model). Report fea.ok, the FEA max stress, deflection and utilization next to the hand numbers. If fea.ok is false, say the FEA failed and why; never claim an FEA pass.`,
        fallbackCall: { tool: "conkay_design", params: { text: brief } },
      };
    }
  }
  if (!writeFirst && isDesignAsk(p)) {
    return { route: "design", hint: DESIGN_HINT, fallbackCall: { tool: "conkay_design", params: { text: p } } };
  }

  if (!route) return null;
  const hint = route === "design" ? DESIGN_HINT : routeHint(route);
  let fallbackCall = null;
  if ((route === "lookup" || route === "web") && isTextbookAsk(p)) {
    fallbackCall = { tool: "textbook_lookup", params: { query: p.slice(0, 200) } };
  } else if (route === "web" || route === "lookup") {
    fallbackCall = { tool: "web_search", params: { query: webAgentMessage(p, history).replace(/^\s*(?:please\s+)?(?:search\s+(?:the\s+)?(?:web|internet|online)\s+for|look\s+up|google)\s+/i, "").slice(0, 200) } };
  } else if (route === "design") {
    fallbackCall = { tool: "conkay_design", params: { text: p } };
  } else if (route === "music") {
    fallbackCall = NEW_MUSIC_RE.test(p)
      ? { tool: "run_lens_action", params: { domain: "studio", action: "compose", params: { genre: /\b(lofi|jazz|rock|house|techno|ambient|hip[- ]?hop|trap|pop|synthwave|edm)\b/i.exec(p)?.[1]?.toLowerCase() || "lofi", key: "C", bpm: 85, bars: 8, title: "ConKay Sketch" } } }
      : (realMusicTerm(p) ? { tool: "run_lens_action", params: { domain: "music", action: "ingest-itunes", params: { term: realMusicTerm(p), limit: 3 } } } : null);
  }
  return { route, hint, fallbackCall };
}
