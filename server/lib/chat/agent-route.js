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

import { resolveDueDate } from "./today.js";
import { collectRetrievedDtus, guardDtuCitations } from "./dtu-citation-guard.js";
import { compactVoiceBlock } from "../../prompts/voice.js";
import { parseExplicitDtuSave } from "./dtu-save-intent.js";
import { CHAT_HISTORY_TURNS, resolveAgentMaxTurns } from "../chat-reply-policy.js";
import { isRecallAsk, formulaContextBlock, memoryDtuRefs, parseRememberAsk, recallRemembered, rememberAckReply, recallRememberedReply } from "./session-memory.js";
import { stripToolCalls } from "../chat-agent.js";
import { budgetLeftMs } from "./gen-budget.js";
import { budgetExhaustedReply, sanitizeUserReply } from "./tool-turn-reply.js";
import { isLongTaskAsk, isLongTaskStatusAsk, startLongTask, kickLongTask, longTaskStartedReply, longTaskStatus, formatLongTaskStatus } from "../long-task.js";

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
  // "use websearch if you needa learn", "web-search it" (one word; audit 2026-10-19).
  /\bweb-?search(?:es|ing)?\b/i,
  /^\s*(?:(?:ok(?:ay)?|so|then|yes|yeah|yep|sure|please|pls|go|just)[,\s]+)*(?:do|run|start)\s+(?:some|the|a little|more|deep|real)?\s*research\b/i,
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

// "if i drive 260 miles at 31 mpg and gas is 3.49 a gallon how much is gas", "5k at 6%
// compounded yearly, how much after 10 years": two or more numbers and a quantity question.
// The model did these in its head (long-chat probe 2026-10-17).
const WORD_PROBLEM_ASK_RE = /\b(?:what (?:was|is|were|'?s) (?:the |its |their )?(?:mean|average|median)|(?:mean|average|median) (?:of|was|is)|how much|how many|how long|how far|how fast|what(?:'?s| is| will| would) (?:the )?(?:total|cost|price|amount|balance|speed|distance|force|energy)|total|cost|worth|compounded|interest|mpg|per (?:gallon|hour|month|year|day)|at \d+(?:\.\d+)?\s?%)\b/i;
const NOT_WORD_PROBLEM_RE = /\b(?:plan|trip|itinerary|recommend|best|news|price of|bitcoin|btc|eth|stock|score|weather)\b/i;
export function isWordProblem(prompt) {
  const p = String(prompt || "");
  const nums = p.match(/\$?\d[\d,]*(?:\.\d+)?\s?k?\b/g) || [];
  return nums.length >= 2 && WORD_PROBLEM_ASK_RE.test(p) && !NOT_WORD_PROBLEM_RE.test(p);
}

const MATH_CONTENT_RE = /\d|[\^=+*/]|\b(?:integral|derivative|equation|matrix|sqrt|log|sin|cos|tan|polynomial|eigen\w*|determinant)\b/i;

const DESIGN_RE = [
  /\bconkay\b/i,
  // 3D / CAD / STL / printable asks go to conkay_design or generate_3d, never
  // the flat image tool (audit 2026-10-19: "generate a 3d model" → FLUX photo).
  /\b(?:3[- ]?d|cad|solid|mesh|printable|stl)\s+(?:model|models|part|parts|file|mesh|object|version|design|print)\b/i,
  // "generate a 3d cad" has no noun after cad, so the pattern above misses it
  // and chat stays on the conversational tool list (which used to offer only
  // generate_image).
  /\b3[- ]?d\s+cad\b/i,
  /\b3[- ]?d[- ]print(?:ed|able|ing)?\b|\bstl\b|\bstep file\b/i,
  /\b(?:design|make|build|model|create|cad)\b[^.?!]{0,40}\b(?:phone stand|tablet stand|truss|gear\s*box|enclosure|project box)\b/i,
  /\b(?:design|size|sizing)\b[^.?!]{0,60}\b(?:cantilever|beam|bracket|shaft|gear|truss|bridge|footbridge|car|vehicle|column|spring|bolt|weld|plate|frame|part)\b/i,
  /\bsafety\s+factor\b/i,
];

// "save this as a DTU" is an explicit write; chat.respond handles it.
const DTU_SAVE_RE = /\b(?:save|store|remember|mint|create|make)\b[^.?!]{0,40}\b(?:as\s+(?:a\s+)?dtu|dtu)\b/i;

// ── Affirmations, follow-ups and status (cockpit audit 2026-10-19) ──────────
// "Yes run it" after a design brief hit the CSL not_formal_intent gate on the
// conversational path; "What happened?" after a failed tool web-searched the
// phrase "what happened".
const AFFIRM_HEAD = String.raw`(?:yes+|yeah|yea|yep|yup|ya|sure|ok(?:ay)?|k|alright|aight|bet|cool|perfect|great|absolutely|definitely|of course|please|pls|go ahead|go for it|do it|do that|run it|let'?s go|let'?s do it|sounds good|make it|send it|proceed|continue|keep going|try again|retry|again)`;
const AFFIRM_PREFIX_RE = new RegExp(String.raw`^\s*${AFFIRM_HEAD}(?:[\s,.!-]+${AFFIRM_HEAD})*[\s,.!-]+`, "i");
const BARE_AFFIRM_RE = new RegExp(String.raw`^\s*${AFFIRM_HEAD}(?:[\s,.!-]+(?:${AFFIRM_HEAD}|it|that|this|now|then|please|pls|bro|man|fam|again|the (?:research|search|design|model|analysis|fea|solver|plan)|(?:run|do|make|build|start|generate|try)\s+(?:it|that|this|the (?:research|search|design|model|analysis|fea|solver|plan)|again)))*[\s.!]*$`, "i");
/** "Yes generate a 3d model" → "generate a 3d model"; unchanged when no affirmation lead. */
export function stripAffirmation(p) {
  const t = String(p || "");
  const m = AFFIRM_PREFIX_RE.exec(t);
  return m ? t.slice(m[0].length).trim() : t;
}
/** "yes", "yes run it", "go ahead", "do it", "try again". */
export function isBareAffirmation(p) {
  const t = String(p || "").trim();
  return t.length <= 60 && BARE_AFFIRM_RE.test(t);
}
// The previous assistant turn offered or planned an action ("Want me to run FEA on it?",
// "Shall I search for…", "I can generate…", "Next I'll…").
const OFFER_RE = /\b(?:want me to|shall i|should i|do you want (?:me )?to|would you like (?:me )?to|i can (?:run|do|make|generate|search|build|design|create|try|export|start)|next,? i(?:'ll| will)|i(?:'ll| will) (?:run|search|generate|build|make|design|try)|ready to (?:run|generate|build)|say (?:yes|go)|let me know if)\b/i;
export function offeredAction(prevReply) {
  return OFFER_RE.test(String(prevReply || "").slice(-600));
}
const ACTION_AFFIRM_RE = /\b(?:run|do|go ahead|go for it|try again|retry|again|proceed|continue|keep going|make it|send it|let'?s go|start|generate|build)\b/i;
const WHAT_HAPPENED_RE = /^\s*(?:(?:so|ok(?:ay)?|hey|yo|wait|hmm|uh|and)[,\s]+)*(?:what\s+(?:just\s+)?happened|what\s+went\s+wrong|what\s+(?:was|is)\s+the\s+(?:error|problem|issue)|why\s+did\s+(?:it|that|the tool|this)\s+fail|what\s+failed|did\s+(?:it|that)\s+(?:work|fail)|why\s+(?:didn'?t|did not)\s+(?:it|that)\s+work|what'?s\s+wrong|huh)\b[\s?!.]*$/i;
const TOOL_FAILURE_TEXT_RE = /\b(?:couldn'?t|could not|can'?t|cannot|failed|failure|error|unsupported|not found|unavailable|didn'?t work|nothing was (?:created|saved)|not_formal_intent|offline)\b/i;

/** Status reply for "what happened?" after a failure, from the last assistant turn. */
export function toolStatusReply(prevReply) {
  const text = String(prevReply || "").replace(/\s+/g, " ").trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter((x) => TOOL_FAILURE_TEXT_RE.test(x)).slice(0, 3);
  if (!sentences.length) return null;
  const body = sentences.map((x) => `- ${x.slice(0, 300)}`).join("\n");
  return `Here's what happened on that last step:\n${body}\n\nNothing else ran after that. Say "try again" and I'll take another route (a different tool or input), or tell me what to change.`;
}

/** The user ask an affirmation confirms: the last user turn that was not itself an affirmation. */
export function confirmedAsk(history = []) {
  for (let i = (history || []).length - 1; i >= 0; i--) {
    const h = history[i];
    if (h?.role !== "user") continue;
    const c = String(h.content || "").trim();
    if (c && !isBareAffirmation(c)) return c.slice(0, 1200);
  }
  return "";
}

/** The agent-loop message for a "continue" turn: the confirmation plus what it confirms. */
export function continueAgentMessage(prompt, history = []) {
  const prevReply = [...(history || [])].reverse().find((h) => h?.role === "assistant")?.content || "";
  const ask = confirmedAsk(history);
  return [
    String(prompt || "").trim(),
    "",
    "(The user is confirming. Carry out the action you offered or planned in your previous reply now, with real tool calls; do not ask again and do not just describe it.",
    ask ? `Their earlier request: "${ask.slice(0, 600)}"` : "",
    prevReply ? `Your previous reply ended: "${String(prevReply).slice(-500)}")` : ")",
  ].filter(Boolean).join("\n");
}

/**
 * Turns answered without a model: remember/recall of a stated value and the
 * post-failure status report. Shared by Chat and the ConKay stream.
 * @returns {string|null}
 */
export function deterministicRouteReply(route, prompt, history = [], memoryBlock = "") {
  if (route === "remember") return rememberAckReply(parseRememberAsk(prompt));
  if (route === "recall") {
    const r = recallRemembered(prompt, history, memoryBlock);
    return r ? recallRememberedReply(r, prompt) : null;
  }
  if (route === "status") {
    const prevReply = [...(history || [])].reverse().find((h) => h?.role === "assistant")?.content || "";
    return toolStatusReply(prevReply);
  }
  return null;
}

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
  // Background jobs (lib/long-task.js): "how's my job going?" and asks too big
  // for one reply ("research X and write me a report").
  if (isLongTaskStatusAsk(p)) return "jobs";
  // "Yes generate a 3d model": the affirmation prefix is dropped and the rest routed.
  const affirmRest = stripAffirmation(p);
  if (affirmRest !== p && affirmRest && !isBareAffirmation(p)) return chatAgentRoute(affirmRest, opts);
  // "Yes" / "do it" / "run it" / "go ahead" / "try again" after an offer or a planned tool.
  // A bare "ok"/"cool"/"thanks" after an answer is an acknowledgement, not a go-ahead:
  // it needs an offer in the last reply, or an action word plus a prior tool turn.
  if (isBareAffirmation(p) && (offeredAction(opts?.prevReply) || (ACTION_AFFIRM_RE.test(p) && opts?.prevRoute && opts.prevRoute !== "remember" && opts.prevRoute !== "status"))) return "continue";
  // "What happened?" right after a failed tool: a status report, not a web search.
  if (WHAT_HAPPENED_RE.test(p) && TOOL_FAILURE_TEXT_RE.test(String(opts?.prevReply || ""))) return "status";
  if (isLongTaskAsk(p)) return "long";
  if (DESIGN_RE.some((r) => r.test(p))) return "design";
  if (DTU_SAVE_RE.test(p) || NOTE_SAVE_RE.test(p)) return "save";
  // "Remember codeword PLUM-77": stored in this chat's memory, acknowledged verbatim.
  if (parseRememberAsk(p)) return "remember";
  if (MUSIC_RE.some((r) => r.test(p))) return "music";
  if (URL_RE.test(p) && BROWSE_ASK_RE.test(p)) return "browse";
  if (isCodeAsk(p)) return "code";
  if (ACTION_RE.some((r) => r.test(p))) return "action";
  // "what did i save earlier", "whats my dog's name again": the chat memory and the
  // user's own DTUs, not the web and not "you didn't mention it".
  if (isRecallAsk(p)) return "recall";
  if (WEB_RE.some((r) => r.test(p)) || casualNews(p)) return "web";
  if (opts?.prevRoute === "web" && WEB_FOLLOWUP_RE.test(p)) return "web";
  if (opts?.prevReply && ASKED_SEARCH_TOPIC_RE.test(String(opts.prevReply).slice(-400))
    && p.split(/\s+/).length <= 8 && !NOT_A_TOPIC_RE.test(p)) return "web";
  if (CONVERT_RE.test(p)) return "compute";
  if (DTU_RE.some((r) => r.test(p))) return "dtu";
  // "solve conflicts with my coworker" is not a computation: needs math content too.
  if (COMPUTE_RE.some((r) => r.test(p)) && MATH_CONTENT_RE.test(p)) return "compute";
  if (isWordProblem(p)) return "compute";
  if (opts?.prevRoute === "lookup" && WEB_FOLLOWUP_RE.test(p)) return "lookup";
  // A bare topic right after a search turn ("Trump") is the next search.
  if ((opts?.prevRoute === "web" || opts?.prevRoute === "lookup") && p.split(/\s+/).length <= 3
    && !SMALLTALK_RE.test(p) && !ABOUT_ASSISTANT_RE.test(p) && contentWords(p).length >= 1) return opts.prevRoute;
  if (needsToolByDefault(p)) return "lookup";
  return null;
}

// Coding asks: Concord's code lens (code.build / test-generate / multi-file /
// propose-verified-patch), not a prose answer. Lens writes (tasks, events,
// notes, songs) stay on the action/music routes.
const CODE_NOUN = "(?:script|program|function|class|module|cli|command[- ]line tool|api|endpoint|server|component|react component|web ?app|app|bot|scraper|parser|regex|algorithm|library|sdk|unit tests?|test suite)";
const CODE_RES = [
  new RegExp(`\\b(?:write|build|make|create|generate|code|implement|scaffold)\\s+(?:me\\s+)?(?:a|an|the|some|my)?\\s*(?:[\\w.+#-]+\\s+){0,3}${CODE_NOUN}\\b`, "i"),
  /\b(?:write|generate|add|create)\s+(?:some\s+)?(?:unit\s+|integration\s+|e2e\s+)?tests?\s+(?:for|to|covering)\b/i,
  /\b(?:refactor|patch|debug)\s+(?:this|my|the)\s+(?:code|function|module|class|script|repo|file)s?\b/i,
  /\bfix\s+(?:the|this|my)\s+(?:bug|failing test|code|function|script|stack ?trace)\b/i,
  /\bmulti[- ]file\s+(?:change|edit|refactor|plan|patch)\b/i,
  /\b(?:implement|code up|write)\s+[\w\s'-]{2,40}?\s+in\s+(?:python|javascript|typescript|node(?:\.js)?|rust|go|golang|java|c\+\+|c#|ruby|php|swift|kotlin|bash)\b/i,
  /\b(?:in|using|with)\s+(?:python|javascript|typescript|node(?:\.js)?|rust|go|golang|java|c\+\+|c#|ruby|php|swift|kotlin|bash)\b[^.?!]{0,60}\b(?:write|build|make|implement|code)\b/i,
];
const NOT_CODE_RE = /\b(?:task|todo|to-do|event|meeting|reminder|note|playlist|song|beat|track|recipe|budget|shopping list|calendar|appointment)s?\b/i;
export const CODE_TEST_RE = /\btests?\b/i;

/** True for a coding ask that should use the code lens. */
export function isCodeAsk(text) {
  const p = String(text || "");
  if (!p || p.length > 4000) return false;
  if (NOT_CODE_RE.test(p) && !/\b(?:script|function|program|code|api|class|component|app|module)\b/i.test(p)) return false;
  return CODE_RES.some((r) => r.test(p));
}

const ROUTE_HINT = {
  long: "This is a big multi-step job. Call start_long_task with the user's goal in their own words (mode research, plan, code or general). Then tell the user the job id, that it keeps working in the background, and that the result will be posted here. Don't try to do the whole job in this reply.",
  jobs: "The user is asking about their background jobs. Call check_long_task (with the job id if they gave one) and report only what it returned: status, tool steps, latest notes, and the result if it finished.",
  lookup: "If a CONCORD KNOWLEDGE note above answers it (or the user asks about a Concord DTU), answer from that note and name the DTU; no web_search needed. Otherwise answer this with a tool, not from memory. Facts, current events, prices, scores, products, how-to steps, recipes, places: call web_search first with a short query in the user's own words (no year unless they gave one; add news or latest for anything recent), then answer from its results with each item's link (you may explain the results in your own words). For news, lead with the newest dated items and name each outlet and date. For the game last night with no team named, report the ESPN finals the search returns across the major US leagues instead of asking which game. Textbook, science and engineering facts (material constants, physical laws, definitions, derivations), or any ask for a textbook or OpenStax source: call textbook_lookup first and answer from its passages with the book, section and link. The user's own Concord data, or making/doing something in Concord (tasks, calendar, notes, recipes, budgets, plans, music, designs): call find_lens_actions with the intent, then run_lens_action with the best match, as this user. If the tools return nothing useful, say so plainly before giving any general answer. When the question has several parts or the first results are thin, run two or three searches from different angles in the same turn, and browse_url the best source when its snippet does not answer the question.",
  web: "This request needs live web information: call web_search first and answer only from its results, with each item's link. For what a person or group is doing lately, put news in the query. Lead with the newest dated items and name each outlet and date; scores and prices come from the live feed rows (ESPN, Coinbase) when present. For a follow-up about a story already listed in this conversation, answer from that list (title, outlet, URL) and search again only if it is not there. When the question has several parts or the first results are thin, run two or three searches from different angles in the same turn, and browse_url the best source when its snippet does not answer the question.",
  recall: "If the user asked you to remember a value earlier in this chat (a codeword, name, number), give that exact value. The user is asking about something they said, saved or made earlier. Answer from the chat memory note and the earlier messages above, and from the user's own DTUs listed in the system notes (cite their ids). If the notes do not cover it, call run_lens_action dtu.search with the key words before answering. Only if none of these has it, say plainly that you don't see it; never say they did not mention something that appears above.",
  dtu: "This request is about the user's DTUs: look them up with run_lens_action dtu.search (or expert_mode) and cite only DTUs the tool returned. If none match, say so.",
  compute: "This request is a computation: use run_compute (or the compute engines) rather than doing the math in your head. For a word problem (money, interest, trips, fuel, force, rates), write the formula as ONE arithmetic expression with the numbers filled in and call run_compute with key symbolic.evaluate and input {\"expression\": \"5000*(1+0.06)^10\"} (^ for powers). Never invent a compute function name. Then state the result with units and the formula you used.",
  save: "The user wants this saved: call create_dtu with a short title and the user's own words as the summary, then give the stored DTU id. If create_dtu fails, say it was not saved and why.",
  music: "This is a music request. For a NEW song, call run_lens_action studio.compose (choose genre, key, bpm, bars and a title from the request; if the user only asks whether you can make music, make a short sample now with your own picks instead of asking). For REAL music by an artist or a named song, call run_lens_action music.ingest-itunes with the artist or song as term. When a tool returns a song or preview, say it is ready to play below (never that it is playing). Never invent Spotify, YouTube or other links. If the tool fails, say so.",
  browse: "The user gave a URL: call browse_url on it first and answer only from the page it returns. If the fetch fails or is blocked, say you could not read the full page; if the tool result includes the search listing for that link, answer from it (title, outlet, date, snippet) and say that is all you have. Do not summarize from memory.",
  action: "The user wants something created or changed in a Concord lens. Use run_lens_action with the right action (tasks: productivity.task-add; calendar events: calendar.events-create; otherwise call list_lens_actions for the domain first). Use the user's own words for the item text, unchanged. Report only what the tool returned. If no action fits or the tool failed, say plainly that nothing was created and why. Never say it was added unless a tool call succeeded.",
  code: "This is a coding request: use Concord's code tools through run_lens_action, not a prose answer. New program or script: code.build with {\"request\": the user's words, \"language\": \"python\"|\"javascript\"|...}; it generates, runs where execution is enabled, type-checks and repairs, and its status is honest (say done only if it returned done; if it says unrun, say the code was not executed). Tests for given code: code.test-generate with {\"code\": ..., \"framework\": ...}. A change across several files: code.multi-file-plan with {\"prompt\", \"files\"}, then code.multi-file-apply with the returned edits. A verified fix to a project or repo: code.propose-verified-patch with {\"projectId\" or \"repo\", \"taskQuery\"}. If run_python is in your tool list you can check pure Python yourself with it. Show the code the tool returned. A big multi-step build: start_long_task with mode code.",
  design: "This request is a ConKay design or a 3D/CAD model. Engineered or functional objects the user named (beams, brackets, stands, trusses, gearboxes, enclosures, furniture, robots, cars, parts, mechanisms): call the conkay_design tool with the user's own words; it returns the solver's numbers or a concept 3D assembly the interface shows below your reply. Say that assembly is a layout approximation. Free-form objects (a creature, character, statue, plant, figurine, prop, sculpture): call generate_3d. If generate_3d fails, tell the user 3D generation is busy or unavailable and to try again in a minute. Do not call conkay_design for those, and do not substitute a different object. Never use generate_image for a 3D or CAD ask. Report only what the tool returned. For a full design from a brief, use run_lens_action conkay_design.from-brief.",
  continue: "The user just said yes to what you offered or planned in your last reply. Do it now with real tool calls (the same tool and inputs you proposed; conkay_design or conkay_design.from-brief for a design, web_search for research, studio.compose for a song). Do not ask for confirmation again and do not just describe the step. If it fails, try one other way, then report plainly what happened.",
  remember: "The user asked you to remember something. Confirm in one short sentence what you will remember, using their exact words and values.",
  status: "The user is asking what happened with the last step. Explain from the conversation above which tool failed and why, in plain words, and offer to retry another way. Do not call web_search.",
};

// "Use web search", "google it", "look it up": no topic of its own. The model then searched
// the tool-schema example ("concord cognitive engine") instead of the question just asked.
const BARE_SEARCH_RE = /^\s*(?:(?:ok(?:ay)?|so|then|just|please|pls|can you|could you)[,\s]+)*(?:(?:use|do|run|try)\s+(?:a\s+|the\s+)?)?(?:(?:web|internet|online|google)\s+search|web-?search|search\s+(?:the\s+)?(?:web|internet|online)|google|search|look|(?:some\s+|more\s+|the\s+)?research)(?:\s+(?:it|that|this))?(?:\s+up)?(?:\s+(?:for\s+)?(?:it|that|this|me))?(?:\s+(?:please|pls|then|now))?\s*[.!?]*\s*$/i;

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
/**
 * Background jobs, answered without a model call: start one, or report on them.
 * @returns {object|null} the answerViaAgent result shape, or null for other routes
 */
export function answerLongTaskRoute({ runMacro, ctx, prompt, route, lensActions = null, sessionId = null, surface = "chat" }) {
  if (route !== "long" && route !== "jobs") return null;
  const userId = ctx?.actor?.userId;
  if (!ctx?.db || !userId) return null;
  const base = { toolCalls: [], artifacts: [], sources: [], provider: null, model: null, linksRemoved: [], dtuRefsRemoved: [] };
  if (route === "jobs") {
    const jobId = /\bmar_[a-z0-9-]+\b/i.exec(prompt)?.[0] || null;
    const st = longTaskStatus(ctx.db, userId, jobId);
    return { ...base, reply: formatLongTaskStatus(st), toolCalls: [{ tool: "check_long_task", ok: !!st.ok, jobs: (st.jobs || []).map((j) => ({ jobId: j.jobId, status: j.status, steps: j.steps, turns: j.turns })) }] };
  }
  const r = startLongTask(ctx.db, { userId, goal: prompt, origin: { surface, sessionId } });
  if (r.ok) kickLongTask({ db: ctx.db, jobId: r.jobId, runMacro, lensActions });
  return { ...base, reply: longTaskStartedReply(r, prompt), toolCalls: [{ tool: "start_long_task", ok: !!r.ok, jobId: r.jobId || null, mode: r.mode || null, ...(r.ok ? {} : { error: r.reason }) }] };
}

export async function answerViaAgent({ runMacro, ctx, history = [], prompt, route, lensActions = null, memoryBlock = "", formulaDtus = [], recallDtus = [], knowledgeDtus = [], sessionId = null, selfContinue = undefined, deadlineMs = 0, chatTransport = null }) {
  if (typeof runMacro !== "function" || !ctx?.db || !ctx?.actor?.userId || !route) return null;
  // Non-streaming chat: one deadline for every agent call below (gen-budget.js).
  // Design turns on the stream path pass a deadline too, plus the real transport,
  // so the generate_3d reserve is not limited to turns flagged "json".
  const _deadline = Number(deadlineMs) > 0 ? Number(deadlineMs) : 0;
  const _transport = chatTransport === "json" || chatTransport === "sse" || chatTransport === "socket" ? chatTransport : "";
  const _budget = {
    ...(_deadline ? { deadlineMs: _deadline } : {}),
    ...(_transport ? { chatTransport: _transport } : {}),
  };
  const _roomFor = (ms) => !_deadline || budgetLeftMs(_deadline) >= ms;
  const longOut = answerLongTaskRoute({ runMacro, ctx, prompt, route, lensActions, sessionId, surface: "chat" });
  if (longOut) return longOut;
  const recap = recapReply(prompt, history, memoryBlock);
  if (recap) return { reply: recap, toolCalls: [], artifacts: [], sources: [], provider: null, model: null, linksRemoved: [], dtuRefsRemoved: [] };
  const status = writeStatusReply(prompt, history);
  if (status) return { reply: status, toolCalls: [], artifacts: [], sources: [], provider: null, model: null, linksRemoved: [], dtuRefsRemoved: [] };
  const fixed = deterministicRouteReply(route, prompt, history, memoryBlock);
  if (fixed) return { reply: fixed, toolCalls: [], artifacts: [], sources: [], provider: null, model: null, linksRemoved: [], dtuRefsRemoved: [] };
  const agentHistory = agentHistoryWithNotes(history, { memoryBlock, formulaDtus, recallDtus, knowledgeDtus });
  let r = null;
  try {
    r = await runMacro("chat_agent", "do", {
      message: route === "web" ? webAgentMessage(prompt, history) : route === "continue" ? continueAgentMessage(prompt, history) : prompt,
      history: agentHistory,
      maxTurns: resolveAgentMaxTurns(),
      routeHint: routeHint(route),
      // Concord's voice for the reply (CONCORD_VOICE); the route hint stays last.
      voiceBlock: compactVoiceBlock(),
      surface: "chat",
      ...(sessionId ? { sessionId } : {}),
      ...(typeof selfContinue === "boolean" ? { selfContinue } : {}),
      ..._budget,
    }, ctx);
  } catch (e) {
    r = { ok: false, error: String(e?.message || e) };
  }
  // Out of time: reply from what came back. Never fall through to the
  // conversational path (another full brain call) or start a retry.
  if (_deadline && (r?.budgetStopped || ((!r?.ok || !String(r?.answer || "").trim()) && !_roomFor(20_000)))) {
    let answer = String(r?.answer || "").trim();
    if (!answer || !r?.ok) answer = budgetExhaustedReply(r?.toolCalls || [], { prompt });
    const toolCalls = Array.isArray(r?.toolCalls) ? r.toolCalls : [];
    return {
      reply: sanitizeUserReply(answer, { prompt }),
      toolCalls: toolCalls.map(clientToolCall),
      artifacts: Array.isArray(r?.artifacts) ? r.artifacts : [],
      sources: sourcesFromToolCalls(toolCalls),
      provider: r?.provider || null,
      model: r?.model || null,
      linksRemoved: r?.linksRemoved || [],
      dtuRefsRemoved: [],
      budgetStopped: true,
    };
  }
  // A price/score/news answer with no tool at all is from memory ("Ethereum is at $3,241.18 on
  // Coinbase as of 10:05 PM" with zero tool calls; invented ESPN finals). Run web_search
  // ourselves and have the loop answer from those results; if that fails, refuse to guess.
  if ((route === "lookup" || route === "web") && r?.ok && !(r.toolCalls || []).some((t) => t && t.ok !== false)
    && needsFreshData(prompt, history) && _roomFor(30_000)) {
    const failed = { ...r, answer: "I couldn't get live data for that just now, so I won't guess a number. Try again in a moment." };
    try {
      const { executeToolCall } = await import("../chat-agent.js");
      const query = freshSearchQuery(prompt, history);
      const tc = await executeToolCall(ctx, runMacro, lensActions, { tool: "web_search", params: { query } });
      if (tc?.ok) {
        let listing = "";
        try { listing = (typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)).slice(0, 6000); } catch { listing = ""; }
        const retry = await runMacro("chat_agent", "do", {
          message: prompt,
          history: [...agentHistory, { role: "system", content: `web_search results for "${query}" (already run for you; answer only from these rows, name the source and time, include links; do not call web_search again):\n${listing}` }],
          maxTurns: 2,
          routeHint: routeHint("web"),
          voiceBlock: compactVoiceBlock(),
          ..._budget,
        }, ctx);
        r = retry?.ok && String(retry.answer || "").trim() ? { ...retry, toolCalls: [tc, ...(retry.toolCalls || [])] } : { ...failed, toolCalls: [tc] };
      } else r = failed;
    } catch { r = failed; }
  }
  // Action route: the model answered without trying any write. One more try.
  if (route === "action" && r?.ok !== undefined && !(r?.toolCalls || []).some((t) => t?.tool === "run_lens_action") && _roomFor(30_000)) {
    try {
      const retry = await runMacro("chat_agent", "do", {
        message: prompt, history: agentHistory, maxTurns: resolveAgentMaxTurns(), routeHint: routeHint("action"), voiceBlock: compactVoiceBlock(), ..._budget,
      }, ctx);
      if (retry?.ok && (retry.toolCalls || []).some((t) => t?.tool === "run_lens_action")) r = retry;
    } catch { /* keep the honest failure below */ }
  }
  if (route === "action" && !(r?.toolCalls || []).some((t) => t?.tool === "run_lens_action" && t.ok !== false) && isTaskAddAsk(prompt)) {
    const fields = parseTaskAsk(prompt);
    if (fields) {
      try {
        const { executeToolCall } = await import("../chat-agent.js");
        const tc = await executeToolCall(ctx, runMacro, lensActions, { tool: "run_lens_action", params: { domain: "productivity", action: "task-add", params: fields } });
        const prior = (r?.toolCalls || []).filter(Boolean);
        r = tc?.ok !== false
          ? { ...(r || {}), ok: true, answer: "done", toolCalls: [...prior, { ...tc, domain: tc.domain || "productivity", action: tc.action || "task-add" }] }
          : { ...(r || {}), ok: true, answer: `I couldn't add that task, so nothing was created. The tasks tool said: ${String(tc?.error || "unknown error").slice(0, 200)}.`, toolCalls: [...prior, tc] };
      } catch { /* fall through to the honest failure */ }
    }
  }
  // The model invented a solver name ("finance.compound_interest", "physics.fuelCost"):
  // retry once on the general evaluator with an explicit expression.
  if (route === "compute" && r?.ok !== undefined) {
    const calls = Array.isArray(r?.toolCalls) ? r.toolCalls : [];
    const solved = calls.some((t) => t && t.ok !== false && /^(?:run_compute|compute_router|run_python)$/.test(t.tool));
    if (!solved && _roomFor(30_000) && calls.some((t) => t?.tool === "run_compute" && /unknown compute function|requires "module\.function"/.test(String(t.error || "")))) {
      try {
        const retry = await runMacro("chat_agent", "do", {
          message: `${prompt}\n\n(Write the formula as one arithmetic expression with the numbers filled in and call run_compute with key "symbolic.evaluate" and input {"expression": "..."}; ^ for powers.)`,
          history: agentHistory, maxTurns: 4, routeHint: routeHint("compute"), voiceBlock: compactVoiceBlock(), ..._budget,
        }, ctx);
        if (retry?.ok && (retry.toolCalls || []).some((t) => t && t.ok !== false && /^(?:run_compute|compute_router|run_python)$/.test(t.tool))) r = retry;
      } catch { /* keep the honest failure below */ }
    }
  }
  const toolCalls = Array.isArray(r?.toolCalls) ? r.toolCalls : [];
  let artifacts = Array.isArray(r?.artifacts) ? r.artifacts : [];
  let answer = String(r?.answer || "").trim();
  // A malformed [TOOL_CALL: …] the loop could not run must never be the visible reply.
  if (answer.includes("[TOOL_CALL")) answer = stripToolCalls(answer).replace(/\[TOOL_CALL:[\s\S]*$/, "").trim();

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
    else if (WRITE_CLAIM_RE.test(answer) && !NOTHING_SAVED_RE.test(answer)) answer = "I couldn't complete that, so nothing was created or saved. No write tool ran. Try again and I'll add it.";
  }
  // DTUs the reply may cite: the ones the loop put in its prompt plus any a
  // tool returned. Anything else is invented.
  // DTUs named in the chat memory note or the recall list are real and may be cited.
  answer = stripInventedToolErrors(answer, toolCalls);
  answer = songRecallFix(answer, history, memoryBlock);
  const g = guardDtuCitations(answer, collectRetrievedDtus(r?.contextDtus || [], toolCalls, recallDtus || [], knowledgeDtus || [], memoryDtuRefs(memoryBlock), formulaDtus || [], historyItemTitles(history)), { prompt });
  const sources = sourcesFromToolCalls(toolCalls);
  let replyText = g.text;
  // Math/physics: cite the formula DTU when a solver actually produced the numbers.
  const solved = toolCalls.some((t) => t && t.ok !== false && (t.tool === "run_compute" || t.tool === "compute_router" || t.tool === "run_python"));
  if (route === "compute" && solved && formulaDtus?.length) {
    const cited = formulaDtus.filter((f) => !replyText.includes(f.id));
    if (cited.length) replyText = `${replyText.trim()}\n\nFormula reference: ${cited.map((f) => `${f.title} (DTU ${f.id})`).join("; ")}.`;
    for (const f of formulaDtus) sources.push({ type: "dtu", title: f.title, id: f.id, url: `/dtus/${f.id}` });
  }
  return {
    reply: sanitizeUserReply(withSourceLinks(replyText, sources.filter((x) => x.type !== "dtu")), { prompt }),
    toolCalls: toolCalls.map(clientToolCall),
    artifacts,
    sources,
    provider: r?.provider || null,
    model: r?.model || null,
    linksRemoved: r?.linksRemoved || [],
    dtuRefsRemoved: g.removed,
    ...(r?.selfContinuation ? { selfContinuation: r.selfContinuation } : {}),
  };
}

// Current-data asks a no-tool answer must not cover: prices, scores, news, weather, "today".
const FRESH_RE = /\b(?:price|prices|trading|worth|rate|score|scores|won|win|game|games|last night|tonight|tomorrow|today|news|happened|latest|weather|forecast|rn|right now|currently|eth|btc|bitcoin|ethereum|stock|stocks)\b/i;
/** True when the ask (or a short follow-up to one, "and eth?") needs live data. */
export function needsFreshData(prompt, history = []) {
  const p = String(prompt || "");
  // "how much was bitcoin when i asked earlier" is about this chat, not a new quote.
  if (/\b(?:when i asked|i asked (?:you )?(?:earlier|before)|earlier|before)\b/i.test(p)) return false;
  if (FRESH_RE.test(p)) return true;
  if (p.trim().split(/\s+/).length > 4) return false;
  const prevUser = [...(history || [])].reverse().find((h) => h?.role === "user");
  return Boolean(prevUser && FRESH_RE.test(String(prevUser.content || "")));
}

const COIN_RE = /\b(?:bitcoin|btc|ethereum|eth|solana|sol|dogecoin|doge|xrp)\b/i;
/** Search words for a fresh-data retry: "and eth?" after "bitcoin price rn" → "eth price rn". */
export function freshSearchQuery(prompt, history = []) {
  const p = String(prompt || "").replace(/^\s*(?:and|what about|how about|ok|so)\s+/i, "").replace(/[?!.]+\s*$/, "").trim();
  if (p.split(/\s+/).length > 4) return p.slice(0, 200);
  const prevUser = [...(history || [])].reverse().find((h) => h?.role === "user");
  if (!prevUser) return p;
  const have = new Set(p.toLowerCase().split(/\s+/));
  const extra = String(prevUser.content || "").toLowerCase().split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9']/g, ""))
    .filter((w) => w && FRESH_RE.test(w) && !COIN_RE.test(w) && !have.has(w));
  return [p, ...extra].join(" ").slice(0, 200);
}

const NOTHING_SAVED_RE = /\bnothing was (?:created|saved|added)\b|\bcouldn'?t (?:add|save|create|complete)\b/i;
const TASK_ADD_RE = /\b(?:add|create|make|put|set)\b[^.?!]{0,30}\b(?:task|todo|to-do|reminder)s?\b/i;
/** "add a task to my tasks: call mom sunday" — a plain task-creation ask. */
export function isTaskAddAsk(prompt) {
  const p = String(prompt || "");
  return TASK_ADD_RE.test(p) && !/\b(?:did|was|has|list|show|delete|remove|complete|done with)\b/i.test(p.split(/[:]/)[0]);
}
/** {content, dueDate?} from a task ask; the user's own words for the content. */
export function parseTaskAsk(prompt, now = new Date(), timeZone = "America/New_York") {
  const p = String(prompt || "").trim();
  let content = "";
  const colon = p.match(/\b(?:task|todo|to-do|reminder)s?\b[^:]{0,40}:\s*(.+)$/i);
  if (colon) content = colon[1];
  else {
    const m = p.match(/\b(?:task|todo|to-do|reminder)s?\s+(?:(?:to|for)\s+(?:me\s+)?(?:to\s+)?)?(.+)$/i);
    if (m) content = m[1];
  }
  content = content.replace(/\s+(?:to|on|in)\s+my\s+(?:tasks?|list|to-?do(?:\s+list)?)\s*$/i, "").replace(/[.!]+$/, "").trim();
  if (!content) return null;
  const dueDate = resolveDueDate(content, now, timeZone);
  return { content: content.slice(0, 500), ...(dueDate ? { dueDate } : {}) };
}

const WRITE_STATUS_RE = /\b(?:did|was|has|have)\b[^?.!]{0,60}\b(?:get|got|been|actually|go)?\s*(?:added|saved|created|stored|go(?:ne)? through|made it)\b/i;
/**
 * "did the mom task get added?" answered from this chat's own receipts, not the model:
 * the long-chat probe got an invented 'missing required field "dueDate"' for a write
 * that never ran.
 */
export function writeStatusReply(prompt, history = []) {
  if (!WRITE_STATUS_RE.test(String(prompt || ""))) return null;
  const wantsTask = /\b(?:task|todo|to-do|reminder)\b/i.test(prompt);
  if (!wantsTask) return null;
  // "did the MOM task get added" names the item: match the receipt (or failed ask) that shares its words.
  const STOPW = new Set("did does was has have the a an my that this task todo to-do reminder actually get got added saved created it go through made".split(" "));
  const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOPW.has(w));
  const want = words(prompt);
  const turns = [...(history || [])];
  let fallback = null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const h = turns[i];
    if (h?.role !== "assistant") continue;
    const c = String(h.content || "");
    const saved = c.match(/Saved in ([\w-]+): "([^"\n]{1,160})" \(id ([\w-]+)([^)]*)\)/);
    const ask = [...turns.slice(0, i)].reverse().find((t) => t?.role === "user");
    const about = `${saved ? saved[2] : ""} ${ask?.content || ""}`.toLowerCase();
    const hit = want.length && want.some((w) => about.includes(w));
    let reply = null;
    if (saved && saved[1] === "productivity") reply = `Yes. "${saved[2]}" was saved in ${saved[1]} (id ${saved[3]}${saved[4] || ""}).`;
    else if (NOTHING_SAVED_RE.test(c)) reply = "No. Nothing was saved for that request: no write succeeded, so there's no task or error to report. Want me to add it now?";
    if (!reply) continue;
    if (hit || !want.length) return reply;
    fallback = fallback || reply;
  }
  return want.length ? null : fallback;
}

// "The system returned an error: missing required field" with no failed tool this turn is invented.
const TOOL_ERROR_CLAIM_RE = /[^.!?\n]*(?:\b(?:returned|threw|gave|got|hit|failed with)\s+(?:an?\s+)?error\b|missing required (?:field|param\w*)|\bvalidation error\b)[^.!?\n]*[.!?]?/gi;
export function stripInventedToolErrors(answer, toolCalls = []) {
  if ((toolCalls || []).some((t) => t && t.ok === false)) return answer;
  const out = String(answer || "").replace(TOOL_ERROR_CLAIM_RE, "").replace(/[ \t]{2,}/g, " ").trim();
  return out === String(answer || "").trim() ? answer : (out || "No tool ran for that, so there's no error to report.");
}

/**
 * "what song did you make me" has no audio in THIS turn, so the playback guard appended
 * "Note: no audio was produced in this chat" and cut the song's name (live verify of #1336).
 * When this chat did make a song, say which one and where its player is.
 */
export function songRecallFix(answer, history = [], memoryBlock = "") {
  const a = String(answer || "");
  if (!/no audio was produced in this chat/i.test(a)) return a;
  const titles = historyItemTitles(history).filter((x) => !x.id).map((x) => x.title);
  for (const m of String(memoryBlock || "").matchAll(/\bsong "([^"\n]{1,120})"/g)) titles.push(m[1]);
  if (!titles.length) return a;
  const title = titles[titles.length - 1];
  let body = a.replace(/\s*Note: no audio was produced in this chat, so nothing is playing\.?/i, "")
    .replace(/\s*(?:it'?s|it\u2019s)\s+ready to play below\.?/gi, "").replace(/\s*ready to play below\.?/gi, "").trim();
  if (!body.toLowerCase().includes(title.toLowerCase())) body = `The song I made you is "${title}".${body ? ` ${body}` : ""}`;
  return `${body} Its player is on the earlier message where I made it.`;
}

const RECAP_RE = /\b(?:what (?:did|have) we (?:do|done|talk(?:ed)? about|cover(?:ed)?)|what have we been doing|sum (?:it |this |everything |that )?up|recap|summari[sz]e (?:this|our|the) (?:chat|conversation))\b/i;
const RECAP_SMALLTALK_RE = /^(?:yo|hi|hey|hello|sup|lol|ok(?:ay)?|thanks?|ty|cool|nice)\b[\s!.?]*\S{0,12}$/i;
/** "what did we do so far" → this chat's receipts (tasks, songs, notes), the date check and other asks,
 *  from the replayed turns plus the chat-memory note, not just the last turn. */
export function recapReply(prompt, history = [], memoryBlock = "") {
  if (!RECAP_RE.test(String(prompt || ""))) return null;
  const turns = (history || []).filter((h) => h && (h.role === "user" || h.role === "assistant"));
  const tasks = new Map(); const songs = new Set(); const other = []; let dateLine = "";
  // Memory note (older turns that fell out of the replayed window).
  const mem = String(memoryBlock || "");
  for (const m of mem.matchAll(/^- task "([^"\n]{1,160})"[^\n]*/gm)) tasks.set(m[1].toLowerCase(), `"${m[1]}"`);
  for (const m of mem.matchAll(/\bsong "([^"\n]{1,120})"/g)) songs.add(m[1]);
  const notes = [...mem.matchAll(/^- note \(DTU\) "([^"\n]{1,160})"/gm)].map((m) => m[1]);
  const memAsks = (mem.split(/\n\n/).find((p) => p.startsWith("Other things the user asked for")) || "").split("\n").slice(1)
    .map((l) => l.replace(/^- turn \d+:\s*/, "").trim()).filter(Boolean);
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "user") continue;
    const u = String(t.content || "").trim();
    const a = String(turns[i + 1]?.role === "assistant" ? turns[i + 1].content : "");
    if (RECAP_RE.test(u)) continue;
    const saved = a.match(/Saved in ([\w-]+): "([^"\n]{1,160})" \(id [\w-]+(?:, ([^)]*))?\)/);
    const song = a.match(/["“]([^"”\n]{2,120})["”] (?:is|are) ready to play below/);
    const date = a.match(/^It's (\w+day, \w+ \d{1,2}, \d{4})/);
    if (saved && saved[1] === "productivity") tasks.set(saved[2].toLowerCase(), `"${saved[2]}"${saved[3] ? ` (${saved[3]})` : ""}`);
    else if (song) songs.add(song[1]);
    else if (date) dateLine = date[1];
    else if (/nothing was (?:created|saved)/i.test(a)) other.push(`${u.slice(0, 80)} (nothing was saved)`);
    else if (!RECAP_SMALLTALK_RE.test(u) && !/^did\b/i.test(u)) other.push(u.slice(0, 80));
  }
  const asks = [...new Set([...memAsks.filter((x) => !/\b(?:task|song)\b/i.test(x)), ...other])].slice(-6);
  const lines = [];
  if (tasks.size) lines.push(`- Saved ${tasks.size} task${tasks.size === 1 ? "" : "s"}: ${[...tasks.values()].join(", ")}`);
  if (songs.size) lines.push(`- Made ${songs.size === 1 ? "a song" : `${songs.size} songs`}: ${[...songs].map((x) => `"${x}"`).join(", ")} (the player is on the message where I made it)`);
  if (notes.length) lines.push(`- Saved note${notes.length === 1 ? "" : "s"}: ${notes.map((x) => `"${x}"`).join(", ")}`);
  if (dateLine) lines.push(`- Checked the date: ${dateLine}`);
  for (const x of asks) lines.push(`- You asked: ${x}`);
  if (!lines.length) return null;
  return `Here's what we've done in this chat so far:\n${lines.join("\n")}`;
}

/** Titles of songs/items this chat already made, from earlier receipts in the history. */
export function historyItemTitles(history = []) {
  const out = [];
  for (const h of history || []) {
    if (h?.role !== "assistant") continue;
    const c = String(h.content || "");
    for (const m of c.matchAll(/["“]([^"”\n]{2,120})["”] (?:is|are) ready to play below/g)) out.push({ title: m[1] });
    for (const m of c.matchAll(/Saved in [\w-]+: "([^"\n]{1,160})" \(id ([\w-]+)/g)) out.push({ title: m[1], id: m[2] });
  }
  return out;
}

/** Chat memory first, then replayed turns, then this turn's DTU notes (formula / recall). */
export function agentHistoryWithNotes(history, { memoryBlock = "", formulaDtus = [], recallDtus = [], knowledgeDtus = [] } = {}) {
  const out = [];
  if (memoryBlock) out.push({ role: "system", content: String(memoryBlock) });
  out.push(...(history || []).slice(-CHAT_HISTORY_TURNS));
  const notes = [];
  const fb = formulaContextBlock(formulaDtus);
  if (fb) notes.push(fb);
  if (recallDtus?.length) {
    notes.push(`The user's own DTUs that may answer this (from their account; cite ids):\n${recallDtus.slice(0, 8)
      .map((d) => `- ${d.id} — ${String(d.title || "").slice(0, 120)}${d.summary ? `: ${String(d.summary).slice(0, 200)}` : ""}${d.createdAt ? ` (saved ${String(d.createdAt).slice(0, 10)})` : ""}`).join("\n")}`);
  }
  const kb = knowledgeNote(knowledgeDtus);
  if (kb) notes.push(kb);
  if (notes.length) out.push({ role: "system", content: notes.join("\n\n") });
  return out;
}

/**
 * Concord's own DTUs retrieved for this ask (hot + archived, megas/hypers
 * first). Chat's tool route used to get none, so DTU questions went to
 * web_search. Items: { id, title, tier, archived, body }.
 */
export function knowledgeNote(dtus = []) {
  const list = (Array.isArray(dtus) ? dtus : []).filter((d) => d && d.id).slice(0, 8);
  if (!list.length) return "";
  const lines = list.map((d) => `- [${String(d.tier || "regular").toUpperCase()}${d.archived ? ", archived" : ""}] ${d.id} — ${String(d.title || "").slice(0, 120)}${d.body ? `: ${String(d.body).slice(0, 1200)}` : ""}`);
  return "CONCORD KNOWLEDGE (retrieved DTUs; MEGA and HYPER entries are consolidated syntheses of many DTUs and are listed first). "
    + "When the question is about Concord's DTUs or one of these answers it, answer from it without web_search and name the DTU title you used. Do not invent DTUs.\n"
    + lines.join("\n");
}
