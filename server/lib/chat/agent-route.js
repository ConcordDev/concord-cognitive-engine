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
];

// A follow-up to a web answer ("tell me more about the first story — source link?")
// stays on the web route so it is answered from search, not from retrieved notes.
const WEB_FOLLOWUP_RE = /\b(?:sources?|links?|urls?|story|stories|article|headline|more about|tell me more|first one|second one|that one|who reported|where did you)\b/i;

const MUSIC_RE = [
  /\b(?:make|compose|write|create|generate|produce|give)\s+(?:me\s+|us\s+)?(?:a|an|some|another|new)\b[^.?!]{0,30}\b(?:song|tune|beat|melody|jingle|instrumental|track|music)\b/i,
  /\b(?:play|listen to|put on|queue|find)\b[^.?!]{0,40}\b(?:song|songs|track|tracks|music|album|playlist|by\s+[A-Z0-9])/i,
  /\bplay\s+(?:me\s+)?(?:some(?:thing)?\s+)?(?:a\s+)?(?:real\s+)?["'A-Z]/,
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
 * @param {{prevRoute?: string}} [opts]  agentRoute of the previous assistant turn
 * @returns {null | "web" | "dtu" | "compute" | "design" | "save" | "music" | "browse" | "action"}
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
  if (WEB_RE.some((r) => r.test(p))) return "web";
  if (opts?.prevRoute === "web" && WEB_FOLLOWUP_RE.test(p)) return "web";
  if (CONVERT_RE.test(p)) return "compute";
  if (DTU_RE.some((r) => r.test(p))) return "dtu";
  // "solve conflicts with my coworker" is not a computation: needs math content too.
  if (COMPUTE_RE.some((r) => r.test(p)) && MATH_CONTENT_RE.test(p)) return "compute";
  return null;
}

const ROUTE_HINT = {
  web: "This request needs live web information: call web_search first and answer only from its results, with each item's link. For a follow-up about a story already listed in this conversation, answer from that list (title, outlet, URL) and search again only if it is not there.",
  dtu: "This request is about the user's DTUs: look them up with run_lens_action dtu.search (or expert_mode) and cite only DTUs the tool returned. If none match, say so.",
  compute: "This request is a computation: use run_compute (or the compute engines) rather than doing the math in your head.",
  save: "The user wants this saved: call create_dtu with a short title and the user's own words as the summary, then give the stored DTU id. If create_dtu fails, say it was not saved and why.",
  music: "This is a music request. For a NEW song, call run_lens_action studio.compose (choose genre, key, bpm, bars and a title from the request). For REAL music by an artist or a named song, call run_lens_action music.ingest-itunes with the artist or song as term. When a tool returns a song or preview, say it is ready to play below (never that it is playing). Never invent Spotify, YouTube or other links. If the tool fails, say so.",
  browse: "The user gave a URL: call browse_url on it first and answer only from the page it returns. If the fetch fails or is blocked, say you could not read the page; do not summarize from memory.",
  action: "The user wants something created or changed in a Concord lens. Use run_lens_action with the right action (tasks: productivity.task-add; calendar events: calendar.events-create; otherwise call list_lens_actions for the domain first). Report only what the tool returned. If no action fits or the tool failed, say plainly that nothing was created and why. Never say it was added unless a tool call succeeded.",
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
      message: prompt,
      history: (history || []).slice(-12),
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
