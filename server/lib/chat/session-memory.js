// server/lib/chat/session-memory.js
//
// Long-chat memory from DTUs and the persisted transcript.
//
// Long-chat probe (2026-10-17, 37 turns, one session): the dog's name (turn 3), the trip
// budget (turn 10), the Brooklyn correction (turn 12) and the saved film note (turn 18)
// were gone by turn 29. In-memory sess.messages is capped at 60 rows to keep the box
// memory-safe, so memory comes from chat_messages (the DB copy of every turn) and is
// kept as one private per-session "chat memory" DTU.
//
// Pure helpers plus small DB reads. Nothing here calls a model.

/** Rows read from chat_messages per turn (newest N, chronological). Bounded on purpose. */
export const MEMORY_ROW_LIMIT = 400;
/** Below this many user turns the replayed history already covers everything. */
export const MEMORY_MIN_USER_TURNS = 8;
/** Write or refresh the memory DTU every N user turns. */
export const MEMORY_DTU_EVERY = 10;
const FACTS_CHARS = 2200;
const REQUESTS_CHARS = 1800;
const SAVED_CHARS = 900;
const LINE_CAP = 220;

// Statements about the user, their plans and their corrections.
const FACT_RE = /\b(?:my|mine|i'?m|im|i am|i'?ll|i wanna|i want|i need|i like|i love|i hate|i live|i'?ve|we'?re|our|staying|stay in|name(?:'?s| is)|called|budget|meant|actually|instead|remember|don'?t forget|btw|allergic|birthday|prefer|favou?rite|fav)\b|\$\s?\d|\b\d+\s?(?:k|dollars|bucks|usd)\b/i;
const TRIVIAL_RE = /^(?:(?:yo+|hi+|hey+|hello|sup|wass?up|lol|lmao|haha\w*|ok(?:ay)?|k|cool|nice|thanks?|thank you|thx|ty|bet|word|yes|no|yeah|yep|nope|nah|sure|bye|gm|gn)[\s,!.?]*)+$/i;
// Questions that only ask the assistant to recall: not new facts.
const RECALL_Q_RE = /\b(?:what did i (?:say|save|tell|ask|note)|what'?s my|whats my|remind me|do you remember|sum up|summari[sz]e (?:everything|what we)|how many messages)\b/i;

const clip = (s, n = LINE_CAP) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};

function parseMeta(m) {
  if (m?.meta && typeof m.meta === "object") return m.meta;
  if (typeof m?.meta_json === "string") { try { return JSON.parse(m.meta_json) || {}; } catch { return {}; } }
  return {};
}

const SAVED_DTU_TEXT_RE = /\bSaved a private DTU titled "([^"]{1,160})" \((?:id:?\s*)?([\w-]{4,80})/i;
// The action-route receipt: 'Saved in productivity: "call mom sunday" (id tsk_…, due …)'. A task, not a DTU.
const SAVED_LENS_TEXT_RE = /\bSaved in ([\w-]+): "([^"]{1,160})" \((?:id:?\s*)?([\w-]{4,80})/i;

/** Items this chat actually stored or made, from tool results and receipts. */
export function savedItemsFromRows(rows) {
  const out = [];
  const seen = new Set();
  const add = (label) => { const k = label.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(label); } };
  for (const m of rows || []) {
    if (m?.role !== "assistant") continue;
    const meta = parseMeta(m);
    for (const tc of Array.isArray(meta.toolCalls) ? meta.toolCalls : []) {
      if (!tc || tc.ok === false) continue;
      const res = tc.result && typeof tc.result === "object" ? tc.result : {};
      if (tc.tool === "create_dtu") {
        const title = tc.title || res.title || tc.params?.title;
        const id = tc.dtuId || res.dtuId || res.dtu?.id;
        if (title || id) add(`note (DTU) "${clip(title || "untitled", 120)}"${id ? ` id ${id}` : ""}`);
      } else if (tc.tool === "run_lens_action") {
        const action = String(tc.params?.action || tc.action || "");
        const domain = String(tc.params?.domain || tc.domain || "");
        if (!/(?:add|create|new|save|book|schedule|log|set|compose)/i.test(action) || /list|search|get|view/i.test(action)) continue;
        const p = tc.params?.params || tc.params?.input || {};
        const name = p.title || p.content || p.name || res.title || res.task?.content || "";
        add(`${domain}.${action}${name ? ` "${clip(name, 120)}"` : ""}`);
      } else if (tc.tool === "generate_image" && tc.ok) {
        add(`image "${clip(tc.prompt || tc.params?.prompt || "image", 100)}"`);
      }
    }
    for (const a of Array.isArray(meta.artifacts) ? meta.artifacts : []) {
      if (a && (a.type === "song" || a.kind === "song") && a.title) add(`song "${clip(a.title, 100)}"`);
    }
    const hit = String(m.content || "").match(SAVED_DTU_TEXT_RE);
    if (hit) add(`note (DTU) "${clip(hit[1], 120)}" id ${hit[2]}`);
    const lens = String(m.content || "").match(SAVED_LENS_TEXT_RE);
    if (lens) add(`${lens[1] === "productivity" ? "task" : `${lens[1]} item`} "${clip(lens[2], 120)}" id ${lens[3]}`);
  }
  return out;
}

function takeNewestWithin(lines, budget) {
  const kept = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (used + lines[i].length + 1 > budget) break;
    used += lines[i].length + 1;
    kept.push(lines[i]);
  }
  return kept.reverse();
}

/**
 * The memory block for one session, from its persisted rows (oldest first).
 * @param {Array<{role, content, meta?, meta_json?}>} rows
 * @returns {{ text: string, userTurns: number, facts: string[], saved: string[] }}
 */
export function buildSessionMemory(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const facts = [];
  const requests = [];
  let userTurns = 0;
  for (const m of list) {
    if (m?.role !== "user") continue;
    userTurns++;
    const t = String(m.content || "").trim();
    if (!t || TRIVIAL_RE.test(t)) continue;
    const line = `- turn ${userTurns}: ${clip(t)}`;
    if (FACT_RE.test(t) && !RECALL_Q_RE.test(t)) facts.push(line);
    else if (!RECALL_Q_RE.test(t)) requests.push(`- turn ${userTurns}: ${clip(t, 90)}`);
  }
  const saved = savedItemsFromRows(list);
  if (userTurns < MEMORY_MIN_USER_TURNS) return { text: "", userTurns, facts, saved };
  // Things the user explicitly asked you to remember never age out of the note.
  const pinned = [];
  {
    let n = 0;
    for (const m of list) {
      if (m?.role !== "user") continue;
      n++;
      if (parseRememberAsk(m.content)) pinned.push(`- turn ${n}: ${clip(m.content)}`);
    }
  }
  const parts = [
    `Memory of this chat (${userTurns} user turns so far; from the saved transcript, oldest first). Use it to answer questions about earlier turns. Later lines override earlier ones (corrections). If something is not here or in the replayed messages, say you don't see it rather than guessing.`,
  ];
  const pin = takeNewestWithin(pinned, 700);
  if (pin.length) parts.push(`The user asked you to remember (their words, newest last):\n${pin.join("\n")}`);
  const f = takeNewestWithin(facts, FACTS_CHARS);
  if (f.length) parts.push(`What the user told you (their words):\n${f.join("\n")}`);
  const s = takeNewestWithin(saved.map((x) => `- ${x}`), SAVED_CHARS);
  if (s.length) parts.push(`Saved or made in this chat (confirmed by tools):\n${s.join("\n")}`);
  const r = takeNewestWithin(requests, REQUESTS_CHARS);
  if (r.length) parts.push(`Other things the user asked for:\n${r.join("\n")}`);
  return { text: parts.join("\n\n"), userTurns, facts, saved };
}

/** Newest MEMORY_ROW_LIMIT persisted rows of a session, oldest first. Never throws. */
export function loadSessionRows(db, sessionId, limit = MEMORY_ROW_LIMIT) {
  if (!db || !sessionId) return [];
  try {
    return db.prepare(
      `SELECT role, content, meta_json FROM chat_messages WHERE session_id = ? ORDER BY ts DESC, id DESC LIMIT ?`,
    ).all(String(sessionId), Math.max(1, Math.min(2000, Number(limit) || MEMORY_ROW_LIMIT))).reverse();
  } catch {
    return [];
  }
}

/** Title of the per-session memory DTU (also how it is found again after a restart). */
export function memoryDtuTitle(sessionId) {
  return `Chat memory · ${String(sessionId).slice(0, 80)}`;
}

/** dtu.create input for the private per-session memory DTU. */
export function memoryDtuCreateInput(sessionId, text) {
  const body = String(text || "");
  return {
    title: memoryDtuTitle(sessionId),
    human: { summary: body, bullets: [] },
    content: body,
    creti: body,
    tags: ["chat", "chat-memory"],
    tier: "regular",
    source: "chat_memory",
    visibility: "private",
    domain: "chat",
    lens: "chat",
    consent: { allowCitations: false, shareToFeed: false, publishToMarketplace: false, allowAiTraining: false },
    sessionId,
    core: { claims: [], definitions: [], invariants: [], examples: [], nextActions: [] },
  };
}

/** True when the memory DTU should be written or refreshed this turn. */
export function memoryDtuDue(userTurns, { evicted = false } = {}) {
  if (userTurns < MEMORY_MIN_USER_TURNS) return false;
  return evicted || userTurns % MEMORY_DTU_EVERY === 0;
}

// ── "what did I save / what did I say" ────────────────────────────────────
const SAVED_RECALL_RE = /\bwhat(?:'?s| is| was)?\s+(?:the\s+|my\s+|that\s+)?(?:code ?word|password|passphrase|pass ?code|secret(?:\s+word)?|magic word|safe ?word)\b|\b(?:which|what)\s+(?:code ?word|word|phrase|number|name)\s+(?:did|have)\s+i\b|\bwhat did i (?:give|gave|tell|ask) you(?: to remember)?\b|\bwhat (?:did )?i (?:asked|told) you to remember\b|\bremember what i (?:said|told you|gave you)\b|\b(?:what|which|show|list|find)\b[^.?!]{0,30}\b(?:did i|have i|i)\s+(?:save|saved|note|noted|store|stored|jot|write down|add|added|make|made)\b|\bmy\s+(?:saved\s+)?(?:notes|dtus)\b|\bwhat did i (?:say|tell you|mention)\b|\bwhat(?:'?s| is| was)\s+my\b|\bwhats my\b|\bdo you remember\b|\bremind me (?:what|of|the)\b|\bwhen i asked\b|\bwhat (?:does|did) my\b[^.?!]{0,30}\b(?:note|notes|dtu)\b|\bmy\b[^.?!]{0,20}\bnote (?:says|said)\b/i;
// "what's my X" is recall only with a recall cue or a fact noun; "what's my brother been up to" is chat.
const MY_FORM_RE = /\bwhat(?:'?s| is| was)\s+my\b|\bwhats my\b/i;
const RECALL_CUE_RE = /\b(?:again|earlier|before|said|told|gave|give|mentioned|remember|saved|code ?word|password|passphrase|secret)\b|\b(?:name|budget|address|birthday|plan|note|notes|order|hotel|flight|password hint|dog|cat|pet)\b/i;
const NOT_RECALL_RE = /\b(?:been up to|up to|doing|feeling|horoscope|ip address|location)\b/i;
/** A question about what the user said or saved earlier. */
export function isRecallAsk(prompt) {
  const p = String(prompt || "");
  if (!SAVED_RECALL_RE.test(p) || NOT_RECALL_RE.test(p)) return false;
  const nonMy = SAVED_RECALL_RE.test(p.replace(MY_FORM_RE, " "));
  return nonMy || RECALL_CUE_RE.test(p);
}

// ── "Remember codeword PLUM-77" / "what codeword did I give you" (PLUM-77) ─
// Cockpit audit 2026-10-19: the remember turn had no route and the recall
// question ran a web search for the phrase. Both are answered here from the
// chat's own turns, with no model call, so the value comes back verbatim.
const REMEMBER_RE = /^\s*(?:(?:hey|yo|ok(?:ay)?|so|also|and|please|pls|concord|conkay)[,\s]+)*(?:please\s+)?(?:remember|memori[sz]e|keep in mind|don'?t forget|do not forget)\s*[:,-]?\s+(?!(?:when|what|how|why|if|whether|the time)\b)(?:that\s+)?(.{2,300}?)\s*[.!]*$/i;
const LABEL_WORDS = "code ?word|password|passphrase|pass ?code|pin|secret(?:\\s+word)?|magic word|safe ?word|word|phrase|number|key|name";
const LABEL_RE = new RegExp(String.raw`\b(${LABEL_WORDS})\b(?:\s*(?:is|=|:|was|will be)\s*|\s+)["“'‘]?([A-Za-z0-9][\w-]*(?:[ ][A-Za-z0-9][\w-]*){0,3}?)["”'’]?\s*(?:[.,!?]|$)`, "i");
const normLabel = (l) => String(l || "").toLowerCase().replace(/\s+/g, " ").replace(/^code ?word$/, "codeword").replace(/^pass ?code$/, "passcode").replace(/^safe ?word$/, "safeword").replace(/^secret\s+word$/, "secret");

/** "Remember codeword PLUM-77" → { fact, label: "codeword", value: "PLUM-77" }; null when not a remember ask. */
export function parseRememberAsk(prompt) {
  const p = String(prompt || "").trim();
  if (!p || p.length > 400 || /\?\s*$/.test(p)) return null;
  const m = REMEMBER_RE.exec(p);
  if (!m) return null;
  const fact = m[1].trim();
  // "remember this as a note / dtu" is a DTU save (the save route).
  if (/\b(?:as\s+(?:a\s+)?(?:note|dtu)|dtu)\b/i.test(fact)) return null;
  const lab = LABEL_RE.exec(fact);
  return lab ? { fact, label: normLabel(lab[1]), value: lab[2].trim() } : { fact, label: null, value: null };
}

const ASKED_LABEL_RE = new RegExp(String.raw`\b(${LABEL_WORDS})\b`, "i");
/** True for "what codeword did I give you" style questions about a remembered value. */
export function isRememberedValueAsk(prompt) {
  const p = String(prompt || "");
  return /\b(?:what|which|tell me|remind me|say)\b/i.test(p) && (ASKED_LABEL_RE.test(p) || /\bremember\b/i.test(p))
    && (/\b(?:i|me|my)\b/i.test(p) || /\b(?:code ?word|password|passphrase|pass ?code|secret|safe ?word|magic word)\b/i.test(p)) && !parseRememberAsk(p);
}

/**
 * The value the user asked you to remember, from their own earlier turns
 * (newest first) and the chat memory note. null when none matches.
 * @returns {{ label: string|null, value: string|null, fact: string } | null}
 */
export function recallRemembered(prompt, history = [], memoryBlock = "") {
  if (!isRememberedValueAsk(prompt)) return null;
  const want = normLabel(ASKED_LABEL_RE.exec(String(prompt || ""))?.[1] || "");
  const candidates = [];
  for (const h of history || []) if (h?.role === "user") candidates.push(String(h.content || ""));
  for (const line of String(memoryBlock || "").split("\n")) {
    const m = /^- turn \d+:\s*(.+)$/.exec(line.trim());
    if (m) candidates.push(m[1]);
  }
  let loose = null;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const r = parseRememberAsk(candidates[i]);
    if (!r) continue;
    if (want && r.label && (r.label === want || (want === "word" && /word/.test(r.label)) || (r.label === "word" && /word/.test(want)))) return r;
    if (!want && r) return r;
    if (!loose && r.value) loose = r;
  }
  return want ? (loose && /word|code|pass|secret/.test(want) && /word|code|pass|secret/.test(loose.label || "") ? loose : null) : loose;
}

/** Reply for a remember turn. */
export function rememberAckReply(r) {
  if (!r) return null;
  if (r.label && r.value) return `Got it. I'll remember the ${r.label}: ${r.value}.`;
  return `Got it. I'll remember that: ${r.fact.replace(/[.!]+$/, "")}.`;
}

/** Reply for a recall of a remembered value. */
export function recallRememberedReply(r, prompt = "") {
  if (!r) return null;
  if (r.label && r.value) return `The ${r.label} you gave me is ${r.value}.`;
  return `You asked me to remember: ${r.fact.replace(/[.!]+$/, "")}.`;
}

// ── Math / physics: formula DTUs for the solver ───────────────────────────
const FORMULA_STOP = new Set(["the", "and", "for", "with", "what", "whats", "how", "much", "many", "after", "years", "year", "per", "law", "laws", "theory", "value", "time", "rule", "if", "at", "is", "in", "of", "a", "an", "to", "my", "i", "it", "be", "will", "get", "put", "do", "does", "would", "have", "need", "about", "from", "by", "on", "&", "vs", "money"]);
const FORMULA_SYNONYMS = {
  compounded: "compound", compounding: "compound", apr: "interest", apy: "interest", doubling: "compound",
  force: "newton", acceleration: "newton", momentum: "newton", mass: "newton",
  heat: "thermodynamics", entropy: "thermodynamics", efficiency: "thermodynamics",
  discount: "npv", npv: "npv", irr: "irr", depreciate: "depreciation", depreciation: "depreciation",
  bayes: "bayes", probability: "bayes", oscillator: "harmonic", pendulum: "harmonic", spring: "harmonic",
  relativity: "relativity", dilation: "relativity", voltage: "maxwell", magnetic: "maxwell", electric: "maxwell",
  flow: "fluid", pressure: "fluid", viscosity: "fluid",
};
const stem = (w) => w.replace(/(?:ing|ed|es|s)$/i, "");
function formulaTokens(s) {
  const out = new Set();
  for (const raw of String(s || "").toLowerCase().replace(/[^a-z0-9\s'-]/g, " ").split(/\s+/)) {
    const w = raw.replace(/'s$/, "");
    if (w.length < 3 || FORMULA_STOP.has(w) || /^\d/.test(w)) continue;
    out.add(stem(w));
    if (FORMULA_SYNONYMS[w]) out.add(stem(FORMULA_SYNONYMS[w]));
  }
  return out;
}

let _formulaCache = null;
/** Public grounding DTUs (math, physics, finance, chemistry, economics). Read once via the PK range. */
export function loadFormulaDtus(db) {
  if (_formulaCache) return _formulaCache;
  if (!db) return [];
  try {
    const rows = db.prepare(
      "SELECT id, title, content FROM dtus WHERE id >= 'grounding_' AND id < 'grounding`' AND visibility = 'public' LIMIT 400",
    ).all();
    _formulaCache = rows
      .filter((r) => /^grounding_(?:math|phys|fin|chem|econ|eng)/.test(r.id))
      .map((r) => {
        let body = {};
        try { body = JSON.parse(r.content || "{}") || {}; } catch { body = {}; }
        const tags = Array.isArray(body.tags) ? body.tags : [];
        return { id: r.id, title: String(r.title || ""), summary: String(body.human_summary || "").slice(0, 400), tags,
          tokens: formulaTokens(`${r.title} ${tags.join(" ")} ${r.id.replace(/^grounding_[a-z]+_/, "").replace(/_/g, " ")}`) };
      });
    return _formulaCache;
  } catch {
    return [];
  }
}
/** test seam */
export function _setFormulaCache(rows) { _formulaCache = rows ? rows.map((r) => ({ ...r, tokens: formulaTokens(`${r.title} ${(r.tags || []).join(" ")}`) })) : null; }

// Everyday words that name no formula: "If 3 pencils cost $1.20" matched "Opportunity cost" and
// "CAPM & cost of capital" on "cost" alone (INC-134). They never count toward a match.
const FORMULA_GENERIC = new Set(["cost", "price", "total", "rate", "average", "mean", "amount", "number", "speed", "distance",
  "car", "train", "hour", "minute", "second", "mile", "day", "week", "month", "buy", "pay", "spend", "sell", "each", "unit",
  "capital", "return", "risk", "state", "general", "work", "power", "energy", "change", "first", "free", "market", "system"].map(stem));
/** Up to two formula DTUs that share a specific (non-generic) term with the prompt. */
export function findFormulaDtus(db, prompt, { limit = 2 } = {}) {
  const q = new Set([...formulaTokens(prompt)].filter((t) => !FORMULA_GENERIC.has(t)));
  if (!q.size) return [];
  const scored = [];
  for (const d of loadFormulaDtus(db)) {
    let score = 0;
    for (const t of q) if (d.tokens.has(t)) score++;
    if (score > 0) scored.push({ d, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ d }) => ({ id: d.id, title: d.title, summary: d.summary }));
}

/** System note for the agent loop: the formula to use, then compute with the solver. */
export function formulaContextBlock(formulas) {
  if (!formulas?.length) return "";
  return `Formula reference from Concord DTUs for this question (use it for the formula and units; compute the numbers with run_compute, never in your head; cite the DTU id):\n${
    formulas.map((f) => `- ${f.id} — ${f.title}: ${f.summary}`).join("\n")}`;
}

/**
 * The user's own DTUs ranked for a recall question: term overlap first, then newest.
 * @param {Array<{id,title,tags?,human?,cretiHuman?,createdAt?}>} dtus already filtered to the user
 */
export function rankRecallDtus(dtus, prompt, { limit = 8 } = {}) {
  const q = new Set(String(prompt || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !FORMULA_STOP.has(w)));
  const scored = (dtus || []).map((d) => {
    const hay = `${d.title || ""} ${(d.tags || []).join(" ")} ${d.human?.summary || d.cretiHuman || ""}`.toLowerCase();
    let score = 0;
    for (const w of q) if (hay.includes(w)) score++;
    return { d, score, t: String(d.createdAt || "") };
  });
  scored.sort((a, b) => b.score - a.score || b.t.localeCompare(a.t));
  return scored.slice(0, limit).map((x) => x.d);
}

/** DTUs the memory note names ("note (DTU) "title" id dtu_…"), so a reply may cite them. */
export function memoryDtuRefs(text) {
  const out = [];
  const t = String(text || "");
  for (const m of t.matchAll(/"([^"\n]{1,160})" id (dtu_[\w-]{4,80})/g)) out.push({ id: m[2], title: m[1] });
  // Every item in the "Saved or made" list is real (songs, tasks): its title may be named.
  const sec = t.split(/\n\n/).find((p) => p.startsWith("Saved or made in this chat")) || "";
  for (const m of sec.matchAll(/^- (?!note \(DTU\))[^"\n]*"([^"\n]{1,160})"/gm)) out.push({ title: m[1] });
  return out;
}
