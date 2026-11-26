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

import { chatAgentRoute, routeHint, webAgentMessage, realMusicTerm, isTextbookAsk, CODE_TEST_RE, continueAgentMessage, deterministicRouteReply, confirmedAsk, OWN_DATA_RE } from "../chat/agent-route.js";
import { conceptKind } from "./concept-assembly.js";

import { ROBOT_RE, designTextParams } from "./robot-assembly.js";
const PART_RE = /\b(?:bracket|beam|i-?beam|cantilever|shaft|truss|column|plate|frame|part|mount|bridge|footbridge|joist|girder|lintel|shelf|hook|axle|spring|rod|bar|stand|holder|gear\s*box|gearbox|enclosure|housing|table|desk|chair|stool|bookshelf)s?\b/i;
// Unambiguous engineering parts. The rest of PART_RE (table, bar, frame, stand,
// part, plate, column, bridge, desk...) are everyday words too: "a table of my
// expenses", "a bar chart", "a frame for my essay" are not parts, so those need
// a physical cue (a size, a load, a material, CAD words) before ConKay designs.
const STRONG_PART_RE = /\b(?:bracket|i-?beam|beam|cantilever|shaft|truss|joist|girder|lintel|axle|gear\s*box|gearbox|footbridge|enclosure)s?\b/i;
const PHYSICAL_CUE_RE = /\b\d+(?:\.\d+)?\s*(?:mm|cm|m|km|in|inch(?:es)?|ft|feet|foot|"|'|k?n|kgs?|kg|kilograms?|lbs?|pounds?|tons?|tonnes?|psi|mpa|gpa)\b|\b(?:steel|aluminium|aluminum|wood(?:en)?|timber|plywood|oak|pine|concrete|plastic|pla|abs|titanium|carbon fiber|safety factor|load|loads|holds?|support(?:s|ing)?|carry|carries|weight|span|cad|stl|3[- ]?d|printable|weld(?:ed)?|bolt(?:ed)?)\b/i;
const NOT_PART_RE = /\b(?:chart|graph|plot|table\s+of|spreadsheet|summary|report|essay|argument|story|budget|schedule|plan|logo|website|slide|presentation|resume|cv|email|letter|playlist|menu|reservation|seat)\b/i;
const CAD_RE = /\b(?:3[- ]?d|cad|solid|mesh|printable|stl)\s+(?:model|models|part|parts|file|mesh|object|version|design|print)\b|\b3[- ]?d[- ]print(?:ed|able|ing)?\b|\bstl\b/i;
const DESIGN_VERB_RE = /\b(?:design|build|size|sizing|make|create|model|engineer|spec|check)\b/i;
const LOAD_RE = /\b\d+(?:\.\d+)?\s*(?:k?n|kgs?|kilograms?|lbs?|pounds?|tons?|tonnes?|kn)\b|\b(?:holds?|support(?:s|ing)?|carry|carries|load(?:ed)?)\b/i;
const FEA_RE = /\b(?:fea|finite[- ]element|stress analysis|structural analysis|simulat(?:e|ion)|analy[sz]e (?:it|this|that|the (?:design|part|bracket|beam|model))|re-?run (?:it|the solver)|check (?:the )?(?:stress|deflection|safety factor))\b/i;
const NEW_MUSIC_RE = /\b(?:make|compose|write|create|generate|produce)\b/i;

/** A ConKay design ask: a part noun + a design verb or a load. */
export function isDesignAsk(text) {
  const p = String(text || "");
  if (/\b(?:image|picture|photo|illustration|drawing|song|music)\b/i.test(p)) return false;
  if (!(DESIGN_VERB_RE.test(p) || LOAD_RE.test(p))) return false;
  if (ROBOT_RE.test(p) || STRONG_PART_RE.test(p)) return true;
  return PART_RE.test(p) && PHYSICAL_CUE_RE.test(p) && !NOT_PART_RE.test(p);
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
const FREEFORM_3D_HINT = "The user wants a free-form 3D model. Call generate_3d with the object in a few words; it returns a rotatable mesh and its concept image below your reply. If it fails, tell the user 3D generation is busy or unavailable and to try again in a minute. Do not call conkay_design for a creature, character, statue or plant, and do not substitute a different object. Never substitute generate_image and call it a 3D model.";

const POLICY = [
  "HOW YOU WORK (ConKay, overrides any style instruction above):",
  "• Take the person seriously. Read what they actually asked and answer that, about their situation, in their words. If they ask for your opinion, give it with your reasons; if something is a bad idea, say so kindly and say why; if it depends, say on what. Never deflect, never answer a different question, never reply with only links, and never tell them to ask someone else instead of helping.",
  "• Think first, then look up. Answer from your own reasoning when the question is about ideas, advice, explanations, writing, planning, or knowledge that doesn't change. Use a tool when the answer hinges on a specific fact you could get wrong: a current price, a recent event, a statistic, a law, a product spec, a person or place, or the user's own Concord data. Say briefly what you looked up.",
  "• When you need facts: Concord's own knowledge first (a CONCORD KNOWLEDGE block of retrieved DTUs: answer from it and name the DTU). For anything outside it, web_search first, then answer from the results with their links (browse_url the best result when the snippet lacks the number); textbook_lookup for science and engineering constants and formulas. For news, lead with the newest dated items and name each outlet and date. Never invent a number, a date, a source or a link.",
  "• When they want something made or changed, do it with the tool that does it, then say what was made: conkay_design for an engineered part (hand calc + FEA + a 3D model shown below; if FEA has ok:false, say it failed), generate_3d for a free-form 3D object, generate_image for a picture, run_lens_action studio.compose for a new song, run_lens_action (find_lens_actions if unsure) for tasks, events, notes, plans and the user's records. Report only what the tool stored.",
  "• If a request is unclear, ask one short question, or make a sensible assumption, say it, and go ahead. If a tool fails, try one other way, then tell them plainly what failed and what they can do.",
  "• Be concise and warm, like a sharp colleague: lead with the answer, then the why. No filler, no \"On it\", no describing a tool you did not call.",
].join("\n");

/** The fixed ConKay tool policy, appended after the persona. */
export function conkayToolPolicy() {
  return POLICY;
}

// Asks whose answer is a specific, checkable or current fact: these get a
// search even if the model would rather answer from memory.
const FACT_NEEDED_RE = /\b(?:price|prices|cost|costs|how much|cheapest|best|top \d+|vs\.?|versus|compare|review|reviews|rating|weather|forecast|news|latest|today|tonight|this week|current(?:ly)?|right now|recent(?:ly)?|score|scores|who won|stock|stocks|crypto|bitcoin|exchange rate|release date|launch|hours|open now|near me|address|phone number|population|gdp|statistics?|stats|law|legal|regulation|tax|salary|salaries|schedule for|tickets?|flight|flights|specs?|dimensions of|how (?:tall|big|old|far|heavy|fast|long) (?:is|are|was|does)|yield|tensile|strength of|modulus|density|melting point|boiling point|specific heat|conductivity|coefficient|weigh(?:s|t of)?|when (?:is|was|did|does)|who (?:is|was|are|were))\b|\b(?:19|20)\d\d\b/i;
const LOOKUP_THINK_HINT = "Answer this. If it is stable knowledge you know well (how something works, what a concept means, how to do something common), answer directly and clearly, with an example if it helps. If the answer depends on a specific fact you are not sure of, or anything that changes over time, web_search first and say what you found, with the link. Do not reply with a list of links instead of an answer.";

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
    if (brief && designish) fallbackCall = { tool: "conkay_design", params: designTextParams(brief) };
    else if (ask && CAD_RE.test(ask) && conceptKind(ask)) fallbackCall = { tool: "conkay_design", params: designTextParams(ask) };
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
        fallbackCall: { tool: "conkay_design", params: designTextParams(brief) },
      };
    }
  }
  // "make a 3d model / CAD / STL of X": engineered objects to conkay_design, free-form to generate_3d.
  if (!writeFirst && CAD_RE.test(p) && !isDesignAsk(p)) {
    if (conceptKind(p)) return { route: "design", hint: DESIGN_HINT, fallbackCall: { tool: "conkay_design", params: designTextParams(p) } };
    return { route: "design", hint: FREEFORM_3D_HINT, fallbackCall: { tool: "generate_3d", params: { prompt: p.replace(/^.*?\b(?:3[- ]?d|cad|stl)\s+(?:model|file|mesh|object|version|print)?\s*(?:of\s+)?/i, "").slice(0, 300) || p.slice(0, 300) } } };
  }
  if (!writeFirst && isDesignAsk(p)) {
    const hint = ROBOT_RE.test(p)
      ? "This is a ConKay robot build. Call conkay_design with the user's words. It returns a concept 3D assembly the interface shows below your reply, with the parts list. Name the parts with their sizes and the overall size, say the model is shown below, and say it is a layout concept (no structural, motor or battery sizing was run). Never invent numbers the tool did not return."
      : DESIGN_HINT;
    return { route: "design", hint, fallbackCall: { tool: "conkay_design", params: designTextParams(p) } };
  }

  if (!route) return null;
  let hint = route === "design" ? DESIGN_HINT : routeHint(route);
  if (route === "action") {
    const dates = relativeDateHint(p);
    if (dates) hint = `${hint || ""}\n${dates}`.trim();
  }
  // Think, then look up: ideas, advice and explanations get her own answer;
  // only asks that hinge on a current or specific fact force a search.
  if (route === "think") return { route, hint: routeHint("think"), fallbackCall: null };
  if (route === "lookup" && OWN_DATA_RE.test(p)) {
    return { route: "own-data", hint: "The user is asking about their own records in Concord (schedule, tasks, budget, projects...). Call find_lens_actions with what they want, then run_lens_action as this user, and answer from what it returns. Do not web_search for it. If nothing is stored yet, say so and offer to add it.", fallbackCall: { tool: "find_lens_actions", params: { query: p.slice(0, 200) } } };
  }
  if (route === "lookup" && !FACT_NEEDED_RE.test(p) && !isTextbookAsk(p)) {
    return { route: "lookup", hint: LOOKUP_THINK_HINT, fallbackCall: null };
  }
  let fallbackCall = null;
  if ((route === "lookup" || route === "web") && isTextbookAsk(p)) {
    fallbackCall = { tool: "textbook_lookup", params: { query: p.slice(0, 200) } };
  } else if (route === "web" || route === "lookup") {
    fallbackCall = { tool: "web_search", params: { query: webAgentMessage(p, history).replace(/^\s*(?:please\s+)?(?:search\s+(?:the\s+)?(?:web|internet|online)\s+for|look\s+up|google)\s+/i, "").slice(0, 200) } };
  } else if (route === "code" && !CODE_TEST_RE.test(p)) {
    fallbackCall = { tool: "run_lens_action", params: { domain: "code", action: "build", params: { request: p.slice(0, 2000) } } };
  } else if (route === "design") {
    fallbackCall = { tool: "conkay_design", params: designTextParams(p) };
  } else if (route === "music") {
    fallbackCall = NEW_MUSIC_RE.test(p)
      ? { tool: "run_lens_action", params: { domain: "studio", action: "compose", params: { genre: /\b(lofi|jazz|rock|house|techno|ambient|hip[- ]?hop|trap|pop|synthwave|edm)\b/i.exec(p)?.[1]?.toLowerCase() || "lofi", key: "C", bpm: 85, bars: 8, title: "ConKay Sketch" } } }
      : (realMusicTerm(p) ? { tool: "run_lens_action", params: { domain: "music", action: "ingest-itunes", params: { term: realMusicTerm(p), limit: 3 } } } : null);
  }
  return { route, hint, fallbackCall };
}
