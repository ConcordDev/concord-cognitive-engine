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
import { parseExplicitDtuSave } from "./dtu-save-intent.js";
import { CHAT_HISTORY_TURNS } from "../chat-reply-policy.js";

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
  // "today's top tech news", "any big AI news this week", "headlines" (chat-par probe 2026-10-17:
  // these fell to the conversational path, which answered "No TOOL RESULT yet").
  /\b(?:top|latest|breaking|today'?s|this week'?s|recent|current|big|biggest)\b[^.?!]{0,30}\bnews\b/i,
  /\bnews\b[^.?!]{0,30}\b(?:today|tonight|this week|right now|lately)\b/i,
  /\b(?:headlines?|news stories)\b/i,
  /\bwhat'?s\s+(?:happening|going on|new)\b[^.?!]{0,40}\b(?:today|now|this week|in the world|in tech|in ai)\b/i,
  // Casual asks from a phone (Ramaj, 2026-10-17 20:10 ET): "Use web search", "What trump doing
  // lately", "what's Elon been up to", "any updates on the strike". These fell to the
  // conversational path, which answered from stale memory and said "I'll run a web search".
  /\b(?:web|internet|online|google)\s+search\b/i,
  /\bgoogle\s+(?:it|this|that|for)\b/i,
  /\bsearch\s+(?:it|this|that)\s+up\b/i,
  /\bwhat'?s\s+the\s+latest\b/i,
];

// "What trump doing lately", "what's Elon been up to", "any updates on the strike": current
// events about someone or something, not about the user or the assistant.
const CASUAL_NEWS_RE = [
  /\bwhat(?:'?s|\s+is|\s+are|\s+has|\s+have)?\s+([^.?!]{1,40}?)\s+(?:been\s+)?(?:doing|up to)\b[^.?!]{0,20}\b(?:lately|recently|these days|nowadays|this week|today|right now)\b/i,
  /\bwhat(?:'?s|\s+has|\s+have)\s+([\w.'-]+(?:\s+[\w.'-]+){0,3})\s+been\s+up\s+to\b/i,
  /\b(?:what'?s|whats|any)\s+(?:the\s+)?(?:latest|new|news|updates?)\s+(?:on|with|about|from)\s+([^.?!]{1,40})/i,
];
const SELF_RE = /\b(?:you|u|ya|y'?all|yourself|i|me|we|us|my|our|your)\b/i;
function casualNews(p) {
  return CASUAL_NEWS_RE.some((r) => { const m = p.match(r); return m && !SELF_RE.test(m[1]); });
}

// Tools by default (Ramaj 2026-10-17: Chat "falls back to the model's limited knowledge").
// Any factual, current, how-to, lookup or make/do ask goes to the agent loop ("lookup");
// only small talk, questions about the assistant, creative writing and personal/emotional
// chat stay conversational.
const SMALLTALK_RE = /^(?:(?:yo+|hi+|hey+|hello|hiya|sup|wass?up|what'?s\s+(?:up|good|good\s+bro)|gm|gn|good\s+(?:morning|night|evening|afternoon)|thanks?|thank\s+you|thx|ty|ok(?:ay)?|k|cool|nice|great|awesome|lol|lmao|haha\w*|bye|yes|no|yeah|yep|nope|nah|sure|bet|word|facts|bro|dude|man|fam)[\s,!.?]*)+$/i;
const ABOUT_ASSISTANT_RE = /\b(?:who|what)\s+(?:are|r)\s+(?:you|u)\b|\bhow\s+(?:are|r)\s+(?:you|u)\b|\bhow'?s\s+it\s+going\b|\bwhat\s+(?:else\s+)?can\s+(?:you|u)\s+do\b|\bwhat\s+do\s+(?:you|u)\s+(?:do|think|feel|like|want|know about yourself)\b|\b(?:who|what)\s+(?:made|built|created|trained|owns)\s+(?:you|u)\b|\byour\s+(?:name|opinion|favou?rite|feelings?|thoughts|purpose)\b|\babout\s+yourself\b|\b(?:do|can|are|did|will|would)\s+(?:you|u)\s+(?:like|love|feel|remember|think|dream|real|alive|sentient|conscious|ok|okay|there|human|a bot)\b|\b(?:you|u)\s+(?:been\s+)?(?:doing|up to)\b|\bnew\s+with\s+(?:you|u)\b/i;
const CREATIVE_RE = /\b(?:write|draft|rewrite|rephrase|reword|proofread|paraphrase)\b|\b(?:poem|story|joke|haiku|lyrics|essay|sentence|paragraph|limerick|riddle|roast|pickup line|rap|caption|bio)\b|\b(?:play a game|let'?s play|role-?play|pretend|imagine)\b/i;
const PERSONAL_RE = /\b(?:my|our)\s+(?:brother|sister|mom|mother|dad|father|wife|husband|girlfriend|boyfriend|gf|bf|friends?|kids?|son|daughter|family|boss|coworkers?|day|life|feelings?|mood|relationship|ex)\b|\bi(?:'m|\s+am)\s+(?:so\s+)?(?:sad|tired|bored|lonely|stressed|depressed|anxious|happy|excited|angry|upset|hungry)\b|\bi\s+feel\b|\bshould\s+i\s+(?:break up|text|call|forgive)\b/i;
const QUESTION_START_RE = /^(?:(?:hey|yo|ok(?:ay)?|so|and|but|also|um+|please|pls|quick question)[,\s]+)*(?:what|what'?s|whats|wat|who|who'?s|whom|whose|when|when'?s|where|where'?s|which|why|how|how'?s|is|are|was|were|does|do|did|can|could|should|will|would|has|have|any|tell me|explain|describe|define|compare)\b/i;
const LOOKUP_VERB_RE = /\b(?:find|search|look\s*up|lookup|get me|show me|give me|recommend|suggest|list|tell me about|tell me how|teach me|how to|help me (?:find|fix|choose|pick|understand|plan|learn))\b/i;
const TOPIC_RE = /\b(?:recipes?|prices?|costs?|reviews?|near me|best|vs\.?|versus|scores?|weather|forecast|schedule|hours|address|definition|meaning of|who won|release date|stocks?|population|directions|tutorial|guide|specs?)\b/i;
const GENERIC_WORDS = new Set(["help","something","stuff","thing","things","anything","everything","know","talk","chat","question","questions","this","that","there","here","now","just","really","please","can","could","you","your","the","and","for","with","what","how","why","who","when","where","which","are","is","was","does","did","have","has","will","would","should","tell","give","show","get","about","need","want","like","some","any","yes","okay","going","doing","make","much","many"]);
function contentWords(p) {
  return String(p).toLowerCase().replace(/[^a-z0-9'\s-]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));
}
/** A factual / current / how-to / lookup / do request that should get a tool, not model memory. */
export function needsToolByDefault(prompt) {
  const p = String(prompt || "").trim();
  if (!p || SMALLTALK_RE.test(p) || ABOUT_ASSISTANT_RE.test(p) || CREATIVE_RE.test(p) || PERSONAL_RE.test(p)) return false;
  if (contentWords(p).length < 1) return false;
  return QUESTION_START_RE.test(p) || LOOKUP_VERB_RE.test(p) || TOPIC_RE.test(p) || /\?\s*$/.test(p);
}

// The assistant's previous turn asked what to search for ("What would you like me to look up?");
// a short reply ("Trump") is the search topic.
const ASKED_SEARCH_TOPIC_RE = /\b(?:what|which)\b[^?]{0,80}\b(?:look up|search(?:\s+for)?|find|google)\b[^?]*\?/i;
const NOT_A_TOPIC_RE = /^(?:no|nah|nope|never ?mind|nvm|thanks?|thank you|ty|ok(?:ay)?|cool|k|stop|cancel)\b/i;

// A follow-up to a web answer ("tell me more about the first story — source link?")
// stays on the web route so it is answered from search, not from retrieved notes.
const WEB_FOLLOWUP_RE = /\b(?:sources?|links?|urls?|story|stories|article|headline|more about|tell me more|first one|second one|that one|who reported|where did you)\b/i;

const MUSIC_RE = [
  /\b(?:make|compose|write|create|generate|produce|give)\s+(?:me\s+|us\s+)?(?:a|an|some|another|new)\b[^.?!]{0,30}\b(?:song|tune|beat|melody|jingle|instrumental|track|music)\b/i,
  /\b(?:play|listen to|put on|queue|find)\b[^.?!]{0,40}\b(?:song|songs|track|tracks|music|album|playlist|by\s+[A-Z0-9])/i,
  /\bplay\s+(?:me\s+)?(?:some(?:thing)?\s+)?(?:a\s+)?(?:real\s+)?["'A-Z]/,
  // "Can you make music", "make me some beats" (no article).
  /\b(?:make|compose|create|generate|produce)\s+(?:me\s+|us\s+)?(?:some\s+)?(?:music|beats?|songs?|tunes?)\b/i,
];

// A URL plus a read/summarize ask: fetch the page instead of answering from memory.
const URL_RE = /https?:\/\/[^\s<>"]+/i;
const BROWSE_ASK_RE = /\b(?:summari[sz]e|summary|tl;?dr|read|open|fetch|what(?:'s| is| does)|explain|tell me about|key points|main points|about this)\b/i;

// Create or change something in a lens (task, recipe, event…). The conversational path
// had no tool here and replied "Task added" with nothing stored.
const ACTION_RE = [
  /\b(?:add|create|make|save|schedule|log|set\s+up|put|book|new)\b[^.?!]{0,60}\b(?:tasks?|todos?|to-dos?|reminders?|recipes?|events?|appointments?|meetings?|habits?|expenses?|contacts?|projects?|workouts?|invoices?|shopping list|grocery list)\b/i,
  /\b(?:remind me to|add to my (?:list|calendar|tasks))\b/i,
];

// "save this as a DTU / note" without the titled-with-content form chat.respond handles.
const NOTE_SAVE_RE = /\b(?:save|store|jot|write down|keep|remember)\b[^.?!]{0,40}\b(?:as\s+(?:a\s+)?(?:dtu|note)|dtu|note)\b/i;

const CONVERT_RE = /\b(?:convert|how many)\b[^.?!]*\d|\d[^.?!]{0,30}\b(?:to|in|into)\s+(?:km|kilometers?|miles?|mph|kph|km\/h|m\/s|knots|celsius|fahrenheit|kelvin|kg|kilograms?|lbs?|pounds?|ounces?|oz|grams?|liters?|litres?|gallons?|feet|ft|meters?|metres?|inches?|cm|mm|cups?)\b/i;

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
  /\b(?:design|size|sizing)\b[^.?!]{0,60}\b(?:cantilever|beam|bracket|shaft|gear|truss|bridge|footbridge|car|vehicle|column|spring|bolt|weld|plate|frame|part)\b/i,
  /\bsafety\s+factor\b/i,
];

// "save this as a DTU" is an explicit write; chat.respond handles it.
const DTU_SAVE_RE = /\b(?:save|store|remember|mint|create|make)\b[^.?!]{0,40}\b(?:as\s+(?:a\s+)?dtu|dtu)\b/i;

/**
 * Why this prompt should go through the agent tool loop, or null.
 * @param {{prevRoute?: string, prevReply?: string}} [opts]  agentRoute and text of the previous assistant turn
 * @returns {null | "web" | "dtu" | "compute" | "design" | "save" | "music" | "browse" | "action" | "lookup"}
 */
export function chatAgentRoute(prompt, opts = {}) {
  const p = String(prompt || "").trim();
  if (!p || p.length > 4000) return null;
  if (String(process.env.CONCORD_CHAT_AGENT_ROUTE || "1") === "0") return null;
  // "save a DTU titled X with content Y" is minted deterministically in chat.respond.
  if (parseExplicitDtuSave(p)) return null;
  if (DESIGN_RE.some((r) => r.test(p))) return "design";
  if (DTU_SAVE_RE.test(p) || NOTE_SAVE_RE.test(p)) return "save";
  if (MUSIC_RE.some((r) => r.test(p))) return "music";
  if (URL_RE.test(p) && BROWSE_ASK_RE.test(p)) return "browse";
  if (ACTION_RE.some((r) => r.test(p))) return "action";
  if (WEB_RE.some((r) => r.test(p)) || casualNews(p)) return "web";
  if (opts?.prevRoute === "web" && WEB_FOLLOWUP_RE.test(p)) return "web";
  if (opts?.prevReply && ASKED_SEARCH_TOPIC_RE.test(String(opts.prevReply).slice(-400))
    && p.split(/\s+/).length <= 8 && !NOT_A_TOPIC_RE.test(p)) return "web";
  if (CONVERT_RE.test(p)) return "compute";
  if (DTU_RE.some((r) => r.test(p))) return "dtu";
  // "solve conflicts with my coworker" is not a computation: needs math content too.
  if (COMPUTE_RE.some((r) => r.test(p)) && MATH_CONTENT_RE.test(p)) return "compute";
  if (opts?.prevRoute === "lookup" && WEB_FOLLOWUP_RE.test(p)) return "lookup";
  // A bare topic right after a search turn ("Trump") is the next search.
  if ((opts?.prevRoute === "web" || opts?.prevRoute === "lookup") && p.split(/\s+/).length <= 3
    && !SMALLTALK_RE.test(p) && !ABOUT_ASSISTANT_RE.test(p) && contentWords(p).length >= 1) return opts.prevRoute;
  if (needsToolByDefault(p)) return "lookup";
  return null;
}

const ROUTE_HINT = {
  lookup: "Answer this with a tool, not from memory. Facts, current events, prices, scores, products, how-to steps, recipes, places: call web_search first with a short query in the user's own words (no year unless they gave one; add news or latest for anything recent), then answer from its results with each item's link (you may explain the results in your own words). For news, lead with the newest dated items and name each outlet and date. For the game last night with no team named, report the ESPN finals the search returns across the major US leagues instead of asking which game. Textbook, science and engineering facts (material constants, physical laws, definitions, derivations), or any ask for a textbook or OpenStax source: call textbook_lookup first and answer from its passages with the book, section and link. The user's own Concord data, or making/doing something in Concord (tasks, calendar, notes, recipes, budgets, plans, music, designs): call find_lens_actions with the intent, then run_lens_action with the best match, as this user. If the tools return nothing useful, say so plainly before giving any general answer.",
  web: "This request needs live web information: call web_search first and answer only from its results, with each item's link. For what a person or group is doing lately, put news in the query. Lead with the newest dated items and name each outlet and date; scores and prices come from the live feed rows (ESPN, Coinbase) when present. For a follow-up about a story already listed in this conversation, answer from that list (title, outlet, URL) and search again only if it is not there.",
  dtu: "This request is about the user's DTUs: look them up with run_lens_action dtu.search (or expert_mode) and cite only DTUs the tool returned. If none match, say so.",
  compute: "This request is a computation: use run_compute (or the compute engines) rather than doing the math in your head.",
  save: "The user wants this saved: call create_dtu with a short title and the user's own words as the summary, then give the stored DTU id. If create_dtu fails, say it was not saved and why.",
  music: "This is a music request. For a NEW song, call run_lens_action studio.compose (choose genre, key, bpm, bars and a title from the request; if the user only asks whether you can make music, make a short sample now with your own picks instead of asking). For REAL music by an artist or a named song, call run_lens_action music.ingest-itunes with the artist or song as term. When a tool returns a song or preview, say it is ready to play below (never that it is playing). Never invent Spotify, YouTube or other links. If the tool fails, say so.",
  browse: "The user gave a URL: call browse_url on it first and answer only from the page it returns. If the fetch fails or is blocked, say you could not read the full page; if the tool result includes the search listing for that link, answer from it (title, outlet, date, snippet) and say that is all you have. Do not summarize from memory.",
  action: "The user wants something created or changed in a Concord lens. Use run_lens_action with the right action (tasks: productivity.task-add; calendar events: calendar.events-create; otherwise call list_lens_actions for the domain first). Use the user's own words for the item text, unchanged. Report only what the tool returned. If no action fits or the tool failed, say plainly that nothing was created and why. Never say it was added unless a tool call succeeded.",
  design: "This request is a ConKay design: call the conkay_design tool with the spec in words (span, load, material, supports, safety factor) and report the solver's real numbers. For a full design from a brief, use run_lens_action conkay_design.from-brief.",
};

// "Use web search", "google it", "look it up": no topic of its own. The model then searched
// the tool-schema example ("concord cognitive engine") instead of the question just asked.
const BARE_SEARCH_RE = /^\s*(?:(?:ok(?:ay)?|so|then|just|please|pls|can you|could you)[,\s]+)*(?:(?:use|do|run|try)\s+(?:a\s+|the\s+)?)?(?:(?:web|internet|online|google)\s+search|search\s+(?:the\s+)?(?:web|internet|online)|google|search|look)(?:\s+(?:it|that|this))?(?:\s+up)?(?:\s+(?:for\s+)?(?:it|that|this|me))?(?:\s+(?:please|pls|then|now))?\s*[.!?]*\s*$/i;

/**
 * The message the agent loop gets for a web turn: a bare "use web search" carries the
 * user's previous question as its topic.
 */
export function webAgentMessage(prompt, history = []) {
  const p = String(prompt || "").trim();
  if (!BARE_SEARCH_RE.test(p)) return p;
  const prev = [...(history || [])].reverse().find((h) => h?.role === "user" && String(h.content || "").trim()
    && !BARE_SEARCH_RE.test(String(h.content)));
  return prev ? `${p} — search the web for: ${String(prev.content).trim().slice(0, 300)}` : p;
}

/** One-line system hint for the agent loop, by route. */
export function routeHint(route) {
  return ROUTE_HINT[route] || "";
}

/** Pull web sources out of agent tool calls for the chat envelope. */
// Textbook asks: OpenStax by name, "a textbook source", or a named law/constant.
const TEXTBOOK_RE = /\b(?:openstax|textbooks?|text book)\b|\b(?:young['’]?s modulus|bulk modulus|shear modulus|specific heat|latent heat|thermal conductivity|coefficient of (?:friction|thermal expansion|restitution)|bernoulli['’]?s|archimedes['’]? principle|le ch[aâ]telier|ideal gas law|ohm['’]?s law|hooke['’]?s law|kirchhoff['’]?s|newton['’]?s (?:first|second|third) law|faraday['’]?s law|snell['’]?s law|stefan[- ]boltzmann)\b/i;
/** True for an ask textbook_lookup (OpenStax) should answer. */
export function isTextbookAsk(text) {
  return TEXTBOOK_RE.test(String(text || ""));
}

export function sourcesFromToolCalls(toolCalls) {
  const out = [];
  const seen = new Set();
  for (const tc of Array.isArray(toolCalls) ? toolCalls : []) {
    if (tc?.tool === "textbook_lookup" && tc.ok) {
      for (const r of tc.results || []) {
        if (!r?.url || seen.has(r.url)) continue;
        seen.add(r.url);
        out.push({ type: "web", title: `${r.book} — ${r.section}`, url: r.url, snippet: String(r.passage || "").slice(0, 300) });
      }
      continue;
    }
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
 * A tool call shaped for Chat's ToolCallCard: it reads params.domain/action/query,
 * which the agent loop keeps at the top level. A song or page result can be
 * hundreds of KB; the playable copy rides on artifacts, so the card gets a capped preview.
 */
export function clientToolCall(tc) {
  if (!tc || typeof tc !== "object") return tc;
  const params = tc.params && typeof tc.params === "object" ? tc.params : Object.fromEntries(
    [["domain", tc.domain], ["action", tc.action], ["query", tc.query], ["url", tc.url], ["title", tc.title], ["key", tc.key]]
      .filter(([, v]) => v != null && v !== ""),
  );
  let result = tc.result;
  try {
    const json = typeof result === "string" ? result : JSON.stringify(result ?? null);
    if (json && json.length > 6000) result = `${json.slice(0, 3000)}…`;
  } catch { result = undefined; }
  const { artifacts: _drop, ...rest } = tc;
  return { ...rest, params, result };
}

/** The stored record inside a lens-action result ({task}, {result:{recipe}}, …). */
function storedRecord(result, depth = 0) {
  if (!result || typeof result !== "object" || depth > 3) return null;
  if (typeof result.id === "string" && (result.content || result.title || result.name)) return result;
  for (const v of Object.values(result)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const hit = storedRecord(v, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

/**
 * What a successful write actually stored, in one line, from the tool result.
 * The model's own summary invented a due date and priority for a task that had
 * neither, and rewrote the task text (chat-par probe 2026-10-17).
 */
export function writeReceipt(toolCalls) {
  const done = [...(toolCalls || [])].reverse().find((t) => t?.tool === "run_lens_action" && t.ok !== false && t.domain && t.action
    && /(?:add|create|new|save|book|schedule|log|set)/i.test(t.action) && !/list|search|get|view/i.test(t.action));
  if (!done) return "";
  const rec = storedRecord(done.result);
  if (!rec) return `Done: ${done.domain}.${done.action} succeeded.`;
  const name = String(rec.content || rec.title || rec.name).slice(0, 160);
  const extra = [];
  if ("dueDate" in rec) extra.push(rec.dueDate ? `due ${rec.dueDate}` : "no due date");
  if (rec.start || rec.startTime) extra.push(`starts ${rec.start || rec.startTime}`);
  return `Saved in ${done.domain}: "${name}" (id ${rec.id}${extra.length ? `, ${extra.join(", ")}` : ""}).`;
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
// Routes that create something for the user. If the loop fails on one of these,
// the conversational fallback used to answer "Task added" with nothing stored.
const WRITE_ROUTES = new Set(["action", "save", "music"]);
/** A reply that says a lens write happened. */
export const WRITE_CLAIM_RE = /\b(?:added|created|saved|scheduled|booked|logged|set up|is on your (?:list|calendar)|(?:task|event|recipe|reminder) (?:is )?(?:done|ready))\b|\bID:\s*\w+_/i;

const PLAYABLE_CLAIM_RE = /\b(?:ready to play|play(?:able)? (?:it )?below|tap play|press play|is playing|now playing|here(?:'s| is) (?:your|the) (?:song|track|preview))\b/i;
const REAL_MUSIC_RE = /\b(?:play|listen to|put on|queue|find)\b/i;
const NEW_MUSIC_RE = /\b(?:make|compose|write|create|generate|produce)\b/i;

/** "Play a real song by Daft Punk" → "Daft Punk"; "play Bohemian Rhapsody" → "Bohemian Rhapsody". */
export function realMusicTerm(prompt) {
  let t = String(prompt || "").replace(/[“”"]/g, "").trim();
  const by = t.match(/\bby\s+(.+?)\s*[.?!]*$/i);
  if (by) return by[1].trim().slice(0, 80);
  t = t.replace(/^\s*(?:(?:please|can you|could you|would you)\s+)*(?:play|listen to|put on|queue|find)\s+(?:me\s+)?(?:some(?:thing)?\s+|a\s+|an\s+|the\s+)?(?:real\s+|actual\s+|existing\s+)?(?:song|track|music|tune)?\s*(?:called\s+|named\s+)?/i, "");
  return t.replace(/[.?!]+$/g, "").trim().slice(0, 80);
}

function hasPlayable(artifacts) {
  return (artifacts || []).some((a) => a && (a.kind === "song" || a.kind === "audio" || a.type === "song" || a.type === "audio"));
}

/** Web sources appended as markdown links when the reply cites none of them. */
export function withSourceLinks(reply, sources) {
  const list = (sources || []).filter((x) => x?.url).slice(0, 5);
  if (!list.length || list.some((x) => String(reply).includes(x.url))) return reply;
  const lines = list.map((x, n) => `${n + 1}. [${String(x.title || x.url).replace(/[[\]]/g, "").slice(0, 120)}](${x.url})`);
  return `${String(reply).trim()}\n\nSources:\n${lines.join("\n")}`;
}

/**
 * Answer one chat turn through chat_agent.do.
 * @param {object} deps
 * @param {Function} deps.runMacro      server runMacro(domain, name, input, ctx)
 * @param {object}   deps.ctx           chat ctx (needs db + actor.userId)
 * @param {Array}    deps.history       prior turns as {role, content}, current turn excluded
 * @param {string}   deps.prompt
 * @param {string}   deps.route         from chatAgentRoute
 * @param {Map}      [deps.lensActions] LENS_ACTIONS, for the iTunes preview fallback
 * @returns {Promise<null | {reply, toolCalls, artifacts, sources, provider, model, linksRemoved, dtuRefsRemoved}>}
 */
export async function answerViaAgent({ runMacro, ctx, history = [], prompt, route, lensActions = null }) {
  if (typeof runMacro !== "function" || !ctx?.db || !ctx?.actor?.userId || !route) return null;
  let r = null;
  try {
    r = await runMacro("chat_agent", "do", {
      message: route === "web" ? webAgentMessage(prompt, history) : prompt,
      history: (history || []).slice(-CHAT_HISTORY_TURNS),
      maxTurns: 5,
      routeHint: routeHint(route),
      // Concord's voice for the reply (CONCORD_VOICE); the route hint stays last.
      voiceBlock: compactVoiceBlock(),
    }, ctx);
  } catch (e) {
    r = { ok: false, error: String(e?.message || e) };
  }
  const toolCalls = Array.isArray(r?.toolCalls) ? r.toolCalls : [];
  let artifacts = Array.isArray(r?.artifacts) ? r.artifacts : [];
  let answer = String(r?.answer || "").trim();

  // Real music the loop did not fetch: look the artist/song up on iTunes directly,
  // so "play a real song by X" never gets "ready to play below" with nothing below.
  if (route === "music" && !hasPlayable(artifacts) && REAL_MUSIC_RE.test(prompt) && !NEW_MUSIC_RE.test(prompt) && lensActions) {
    const term = realMusicTerm(prompt);
    if (term) {
      try {
        const { executeToolCall } = await import("../chat-agent.js");
        const tc = await executeToolCall(ctx, runMacro, lensActions, { tool: "run_lens_action", params: { domain: "music", action: "ingest-itunes", params: { term, limit: 3 } } });
        toolCalls.push(tc);
        const found = (tc?.artifacts || (tc?.artifact ? [tc.artifact] : [])).filter((a) => a?.kind === "audio" && a.url);
        if (tc?.ok && found.length) {
          artifacts = [...artifacts, ...found];
          const names = found.map((a) => `"${a.title || "Untitled"}"${a.artist ? ` by ${a.artist}` : ""}`).join(", ");
          answer = `Found ${found.length === 1 ? "a real track" : `${found.length} real tracks`} for "${term}" on iTunes: ${names}. The 30-second ${found.length === 1 ? "preview is" : "previews are"} ready to play below.`;
        } else {
          answer = `I couldn't find a playable preview for "${term}"${tc?.error ? ` (${tc.error})` : ""}.`;
        }
      } catch (e) {
        answer = `I couldn't look up "${term}" right now (${String(e?.message || e)}).`;
      }
    }
  }
  if (route === "music" && !hasPlayable(artifacts) && PLAYABLE_CLAIM_RE.test(answer)) {
    answer = "I couldn't make anything playable this time: no song or preview came back from the music tools. Nothing is ready to play.";
  }

  if (!r?.ok || !answer) {
    if (!WRITE_ROUTES.has(route) || answer) {
      if (!answer) return null;
    } else {
      const failed = toolCalls.filter((t) => t && t.ok === false).map((t) => t.error).filter(Boolean);
      answer = `I couldn't complete that, so nothing was created or saved.${failed.length ? ` The tool said: ${String(failed[0]).slice(0, 200)}.` : (r?.error ? ` (${String(r.error).slice(0, 200)})` : "")}`;
    }
  }
  // A lens write reports what was stored, from the tool result, not the model's paraphrase.
  if (route === "action" && answer) {
    const receipt = writeReceipt(toolCalls);
    if (receipt) answer = receipt;
    // No write ran, yet the reply says it did: "Task added (ID: tsk_…)" with an
    // invented id and nothing stored (long-chat probe 2026-10-17).
    else if (WRITE_CLAIM_RE.test(answer)) answer = "I couldn't complete that, so nothing was created or saved. No write tool ran. Try again and I'll add it.";
  }
  // DTUs the reply may cite: the ones the loop put in its prompt plus any a
  // tool returned. Anything else is invented.
  const g = guardDtuCitations(answer, collectRetrievedDtus(r?.contextDtus || [], toolCalls), { prompt });
  const sources = sourcesFromToolCalls(toolCalls);
  return {
    reply: withSourceLinks(g.text, sources),
    toolCalls: toolCalls.map(clientToolCall),
    artifacts,
    sources,
    provider: r?.provider || null,
    model: r?.model || null,
    linksRemoved: r?.linksRemoved || [],
    dtuRefsRemoved: g.removed,
  };
}
