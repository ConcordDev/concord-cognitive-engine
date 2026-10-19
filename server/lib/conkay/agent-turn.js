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

import { chatAgentRoute, routeHint, webAgentMessage, realMusicTerm, isTextbookAsk, CODE_TEST_RE, continueAgentMessage, deterministicRouteReply, confirmedAsk } from "../chat/agent-route.js";
import { conceptKind } from "./concept-assembly.js";

import { ROBOT_RE } from "./robot-assembly.js";
const PART_RE = /\b(?:bracket|beam|i-?beam|cantilever|shaft|truss|column|plate|frame|part|mount|bridge|footbridge|joist|girder|lintel|shelf|hook|axle|spring|rod|bar|stand|holder|gear\s*box|gearbox|enclosure|housing|table|desk|chair|stool|bookshelf)s?\b/i;
const CAD_RE = /\b(?:3[- ]?d|cad|solid|mesh|printable|stl)\s+(?:model|models|part|parts|file|mesh|object|version|design|print)\b|\b3[- ]?d[- ]print(?:ed|able|ing)?\b|\bstl\b/i;
const DESIGN_VERB_RE = /\b(?:design|build|size|sizing|make|create|model|engineer|spec|check)\b/i;
const LOAD_RE = /\b\d+(?:\.\d+)?\s*(?:k?n|kgs?|kilograms?|lbs?|pounds?|tons?|tonnes?|kn)\b|\b(?:holds?|support(?:s|ing)?|carry|carries|load(?:ed)?)\b/i;
const FEA_RE = /\b(?:fea|finite[- ]element|stress analysis|structural analysis|simulat(?:e|ion)|analy[sz]e (?:it|this|that|the (?:design|part|bracket|beam|model))|re-?run (?:it|the solver)|check (?:the )?(?:stress|deflection|safety factor))\b/i;
const NEW_MUSIC_RE = /\b(?:make|compose|write|create|generate|produce)\b/i;

/** A ConKay design ask: a part noun + a design verb or a load. */
export function isDesignAsk(text) {
  const p = String(text || "");
  return (PART_RE.test(p) || ROBOT_RE.test(p)) && (DESIGN_VERB_RE.test(p) || LOAD_RE.test(p)) && !/\b(?:image|picture|photo|illustration|drawing|song|music)\b/i.test(p);
}

/** The most recent design brief the user gave in this conversation. */
export function lastDesignBrief(history = []) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role === "user" && isDesignAsk(h.content)) return String(h.content).trim().slice(0, 600);
  }
  return null;
}

const DESIGN_HINT = "This is a ConKay design ask. Call conkay_design with the user's spec in words (part, load, material, supports, safety factor). It runs the hand calculation and the FEA solver and returns a 3D model the interface shows below your reply; for everyday objects it has no solver for (phone stand, truss, gearbox, shelf, table, chair, enclosure) it returns a concept 3D assembly with a parts list. Report the solver's real numbers and pass/fail (or the concept parts and sizes), list the assumed defaults, and say the model is shown below. Never state numbers the tool did not return.";
const FREEFORM_3D_HINT = "The user wants a free-form 3D model. Call generate_3d with the object in a few words; it returns a rotatable mesh and its concept image below your reply. If it fails, say plainly 3D generation is unavailable right now; never substitute generate_image and call it a 3D model.";

const POLICY = [
  "TOOL POLICY (ConKay, overrides any style instruction above): you answer with tools, not from memory.",
  "• Facts, products, prices, specs, current events, anything you would otherwise recall: web_search first, then answer from the results with their links. If the snippets lack the number asked for, browse_url the best result and quote the number from that page. For news, lead with the newest dated items and name each outlet and date.",
  "• Textbook, science and engineering facts (material constants, laws, definitions, formulas) or any ask for a textbook/OpenStax source: textbook_lookup first; quote the numbers with units and cite book, section and link. If it has nothing, web_search. Never guess a value; if no source has it, say so.",
  "• Designing or sizing a part: conkay_design (hand calc + FEA + 3D model). FEA on a design already discussed: conkay_design again with that same brief. If an FEA result has ok:false, say the FEA failed; never claim an FEA pass. A part conkay_design does not support (shaft, gear, spring, phone stand...): say so, then work it out by formula in your reply (formula, inputs, result) or give practical design guidance; do not call run_python for it.",
  "• 3D / CAD / STL / printable asks: conkay_design for engineered or functional objects (it returns a concept 3D assembly for stands, trusses, gearboxes, furniture, enclosures), generate_3d for free-form objects. Never generate_image for a 3D ask.",
  "• If a tool fails, read its hint and try one other way (a different tool, key or input) before telling the user it failed.",
  "• Images: generate_image. A new song: run_lens_action studio.compose; a real song: run_lens_action music.ingest-itunes. Say it is ready to play below, never that it is playing.",
  "• Creating or changing something in Concord (tasks, events, notes): run_lens_action (find_lens_actions if unsure), then report only what the tool stored. Never invent dates, ids or details.",
  "• Do not say \"On it\" or describe a tool you did not call. If a tool fails or returns nothing, say so plainly.",
].join("\n");

/** The fixed ConKay tool policy, appended after the persona. */
export function conkayToolPolicy() {
  return POLICY;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * The calendar dates the user's words point at, worked out here so the model
 * doesn't do weekday arithmetic (live: "friday" on Sat Oct 17 stored as Oct 22).
 * Server local time, which is the user's zone.
 */
export function relativeDateHint(message, now = new Date()) {
  const p = String(message || "").toLowerCase();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
  const parts = [];
  if (/\btoday\b|\btonight\b/.test(p)) parts.push(`today = ${ymd(today)}`);
  if (/\btomorrow\b/.test(p)) parts.push(`tomorrow = ${ymd(at(1))}`);
  for (const [i, name] of WEEKDAYS.entries()) {
    const m = new RegExp(`\\b(next\\s+)?${name}\\b`).exec(p);
    if (!m) continue;
    let n = (i - today.getDay() + 7) % 7;
    if (m[1] && n === 0) n = 7;
    parts.push(`${m[0]} = ${WEEKDAYS[at(n).getDay()]} ${ymd(at(n))}`);
  }
  if (!parts.length) return "";
  return `Dates (use these exactly, do not work them out): today is ${WEEKDAYS[today.getDay()]} ${ymd(today)}; ${parts.join("; ")}.`;
}

/**
 * @returns {{ route: string, hint: string, fallbackCall: object|null, brief?: string } | null}
 */
export function conkayTurnPlan(message, history = []) {
  const p = String(message || "").trim();
  if (!p) return null;
  const prevReply = [...(history || [])].reverse().find((h) => h?.role === "assistant")?.content || "";
  const route = chatAgentRoute(p, { prevReply });
  // Background jobs: started / reported deterministically by the stream route
  // (lib/chat/agent-route.js#answerLongTaskRoute), no model turn needed.
  if (route === "long" || route === "jobs") {
    return { route, hint: routeHint(route), fallbackCall: route === "long" ? { tool: "start_long_task", params: { goal: p.slice(0, 2000) } } : { tool: "check_long_task", params: {} } };
  }
  // Remember / recall a stated value / "what happened?": answered without a model.
  if (route === "remember" || route === "status" || route === "recall") {
    const reply = deterministicRouteReply(route, p, history, "");
    if (reply) return { route, hint: routeHint(route), fallbackCall: null, reply };
    if (route !== "recall") return { route, hint: routeHint(route), fallbackCall: null };
  }
  // "Yes run it" after a design brief or an offer: re-run the planned action.
  if (route === "continue") {
    const ask = confirmedAsk(history);
    const brief = lastDesignBrief(history);
    const designish = /\b(?:design|model|fea|cad|brief|solver|conkay|3d|stl|part|assembly)\b/i.test(`${prevReply.slice(-600)} ${ask}`);
    let fallbackCall = null;
    if (brief && designish) fallbackCall = { tool: "conkay_design", params: { text: brief } };
    else if (ask && CAD_RE.test(ask) && conceptKind(ask)) fallbackCall = { tool: "conkay_design", params: { text: ask } };
    return { route, hint: routeHint("continue"), fallbackCall, message: continueAgentMessage(p, history), ...(brief && designish ? { brief } : {}) };
  }
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
  // "make a 3d model / CAD / STL of X": engineered objects to conkay_design, free-form to generate_3d.
  if (!writeFirst && CAD_RE.test(p) && !isDesignAsk(p)) {
    if (conceptKind(p)) return { route: "design", hint: DESIGN_HINT, fallbackCall: { tool: "conkay_design", params: { text: p } } };
    return { route: "design", hint: FREEFORM_3D_HINT, fallbackCall: { tool: "generate_3d", params: { prompt: p.replace(/^.*?\b(?:3[- ]?d|cad|stl)\s+(?:model|file|mesh|object|version|print)?\s*(?:of\s+)?/i, "").slice(0, 300) || p.slice(0, 300) } } };
  }
  if (!writeFirst && isDesignAsk(p)) {
    const hint = ROBOT_RE.test(p)
      ? "This is a ConKay robot build. Call conkay_design with the user's words. It returns a concept 3D assembly the interface shows below your reply, with the parts list. Name the parts with their sizes and the overall size, say the model is shown below, and say it is a layout concept (no structural, motor or battery sizing was run). Never invent numbers the tool did not return."
      : DESIGN_HINT;
    return { route: "design", hint, fallbackCall: { tool: "conkay_design", params: { text: p } } };
  }

  if (!route) return null;
  let hint = route === "design" ? DESIGN_HINT : routeHint(route);
  if (route === "action") {
    const dates = relativeDateHint(p);
    if (dates) hint = `${hint || ""}\n${dates}`.trim();
  }
  let fallbackCall = null;
  if ((route === "lookup" || route === "web") && isTextbookAsk(p)) {
    fallbackCall = { tool: "textbook_lookup", params: { query: p.slice(0, 200) } };
  } else if (route === "web" || route === "lookup") {
    fallbackCall = { tool: "web_search", params: { query: webAgentMessage(p, history).replace(/^\s*(?:please\s+)?(?:search\s+(?:the\s+)?(?:web|internet|online)\s+for|look\s+up|google)\s+/i, "").slice(0, 200) } };
  } else if (route === "code" && !CODE_TEST_RE.test(p)) {
    fallbackCall = { tool: "run_lens_action", params: { domain: "code", action: "build", params: { request: p.slice(0, 2000) } } };
  } else if (route === "design") {
    fallbackCall = { tool: "conkay_design", params: { text: p } };
  } else if (route === "music") {
    fallbackCall = NEW_MUSIC_RE.test(p)
      ? { tool: "run_lens_action", params: { domain: "studio", action: "compose", params: { genre: /\b(lofi|jazz|rock|house|techno|ambient|hip[- ]?hop|trap|pop|synthwave|edm)\b/i.exec(p)?.[1]?.toLowerCase() || "lofi", key: "C", bpm: 85, bars: 8, title: "ConKay Sketch" } } }
      : (realMusicTerm(p) ? { tool: "run_lens_action", params: { domain: "music", action: "ingest-itunes", params: { term: realMusicTerm(p), limit: 3 } } } : null);
  }
  return { route, hint, fallbackCall };
}
