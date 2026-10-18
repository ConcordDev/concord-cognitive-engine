/**
 * Conversational /api/chat reply policy (mode "chat" and the other
 * open-ended modes). Pure helpers — no server boot — so the cap, the
 * length-stop finish, and the history assembly can be tested directly.
 *
 * INC-20261010-07: a verbosity-0.5 affect formula based on 700 tokens
 * stopped concord-conscious mid-sentence, and the next turn re-fed that
 * cutoff as a 1500-character history slice. The model reprinted the stub.
 */

export const CHAT_MAX_TOKENS_DEFAULT = 2000;
export const CHAT_MAX_TOKENS_FLOOR = 256;
export const CHAT_MAX_TOKENS_CEILING = 8192;
/** Sentence-bounded cap for one prior turn. A 2000-token reply fits. */
export const CHAT_HISTORY_CHAR_CAP = 8000;
/**
 * Prior messages (user + assistant rows) replayed per turn (60 rows = 30 exchanges, the in-memory session cap,
 * bounded by CHAT_HISTORY_TOTAL_CHARS). 12 rows was 6 exchanges:
 * a 37-turn phone session (long-chat probe 2026-10-17) lost the trip budget, the
 * saved note and the dog's name by turn 29 and the model said "you didn't mention a
 * budget in this conversation" while sending ~240 tokens of a 32k window.
 */
export const CHAT_HISTORY_TURNS = 60;
/** The newest rows replay at full length (up to CHAT_HISTORY_CHAR_CAP each). */
export const CHAT_HISTORY_FULL_RECENT = 12;
/** Older rows are cut to a complete-sentence gist of this many characters. */
export const CHAT_HISTORY_OLDER_CHAR_CAP = 700;
/** Total replayed history, ~6k tokens; oldest rows drop first past this. */
export const CHAT_HISTORY_TOTAL_CHARS = 24000;

function clampInt(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * num_predict for a conversational reply.
 * Unset or non-positive CONCORD_CHAT_MAX_TOKENS → 2000.
 * Verbosity omitted or 0.5 scales by 1 (the configured cap itself).
 * Other verbosities use the existing affect curve 0.6 + 0.8*v, clamped
 * to about 0.5×–1.5× the base and to the global floor/ceiling.
 */
export function resolveChatMaxTokens({ verbosity, env } = {}) {
  const raw = env !== undefined ? env : process.env.CONCORD_CHAT_MAX_TOKENS;
  let base = CHAT_MAX_TOKENS_DEFAULT;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) base = n;
  }
  base = clampInt(Math.round(base), CHAT_MAX_TOKENS_FLOOR, CHAT_MAX_TOKENS_CEILING);
  const vRaw = verbosity == null ? 0.5 : Number(verbosity);
  const v = Number.isFinite(vRaw) ? Math.min(1, Math.max(0, vRaw)) : 0.5;
  const scaled = Math.round(base * (0.6 + 0.8 * v));
  const lo = Math.max(CHAT_MAX_TOKENS_FLOOR, Math.round(base * 0.5));
  const hi = Math.min(CHAT_MAX_TOKENS_CEILING, Math.round(base * 1.5));
  return clampInt(scaled, lo, hi);
}

export function stoppedOnLength(reason) {
  return String(reason || "").trim().toLowerCase() === "length";
}

const SENTENCE_END_RE = /(?<!\d)[.!?…]["'")\]]*(?=\s|$)/g;
const LIST_LINE_RE = /^(?:[-*•]|\d+[.)])\s*(.*)$/;
const HEADER_LINE_RE = /^(?:#{1,6}\s+\S.*|\*\*[^*\n]+\*\*\s*)$/;
const ABBREV_BEFORE_PERIOD = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)$/i;

function sentenceEnded(s) {
  return /(?<!\d)[.!?…]["'")\]]*$/.test(String(s || "").trim());
}

function isAbbrevPeriod(text, periodIndex) {
  const before = text.slice(Math.max(0, periodIndex - 8), periodIndex);
  if (ABBREV_BEFORE_PERIOD.test(before)) return true;
  return /(?:^|\s)[A-Z]$/.test(before);
}

/** Index just after the last real sentence terminator, or -1. */
function lastSentenceEndIndex(text) {
  const re = new RegExp(SENTENCE_END_RE.source, "g");
  let end = -1;
  let m;
  while ((m = re.exec(text))) {
    const punct = m[0][0];
    if (punct === "." && isAbbrevPeriod(text, m.index)) continue;
    end = m.index + m[0].length;
  }
  return end;
}

function isDanglingListLine(line) {
  const m = String(line || "").trim().match(LIST_LINE_RE);
  if (!m) return false;
  const body = (m[1] || "").trim();
  if (!body) return true;
  return !sentenceEnded(body);
}

function isDanglingHeaderLine(line) {
  return HEADER_LINE_RE.test(String(line || "").trim());
}

export function replyEndsCleanly(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  const lines = t.split("\n");
  const last = lines[lines.length - 1].trim();
  if (!last) return false;
  if (isDanglingHeaderLine(last) || isDanglingListLine(last)) return false;
  return sentenceEnded(t);
}

/**
 * Drop a trailing unfinished list item or header, then cut back to the
 * last complete sentence. Returns "" when nothing complete is left —
 * callers must not ship that as a mid-sentence reply.
 */
export function trimToLastCompleteUnit(text) {
  let t = String(text || "").replace(/\s+$/g, "");
  if (!t) return "";
  for (let i = 0; i < 24; i++) {
    const lines = t.split("\n");
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (!lines.length) return "";
    const last = lines[lines.length - 1].trim();
    if (isDanglingHeaderLine(last) || isDanglingListLine(last)) {
      lines.pop();
      t = lines.join("\n").replace(/\s+$/g, "");
      continue;
    }
    break;
  }
  t = t.trim();
  if (!t) return "";
  if (sentenceEnded(t)) return t;
  const end = lastSentenceEndIndex(t);
  if (end <= 0) return "";
  return t.slice(0, end).trim();
}

/**
 * Join a length-stopped partial with a continuation. Drops an echoed
 * prefix and a shared overlap so the model cannot reprint the stub.
 */
export function joinContinuation(partial, extra) {
  const a = String(partial || "").replace(/\s+$/g, "");
  let b = String(extra || "").trim();
  if (!b) return a;
  if (a && b.startsWith(a)) b = b.slice(a.length).trim();
  const max = Math.min(a.length, b.length, 400);
  let overlap = 0;
  for (let n = max; n >= 24; n--) {
    if (a.slice(-n) === b.slice(0, n)) {
      overlap = n;
      break;
    }
  }
  if (overlap) b = b.slice(overlap).trim();
  if (!b) return a;
  if (!a) return b;
  const needsSpace = !/\s$/.test(a) && !/^[,.;:!?]/.test(b);
  return a + (needsSpace ? " " : "") + b;
}

/**
 * On done_reason "length", ask for one short continuation. If that still
 * does not end cleanly (or itself stopped on length), trim to the last
 * complete sentence or paragraph. Non-length stops are returned as-is.
 */
export async function finishLengthLimitedReply(text, { doneReason, continueOnce } = {}) {
  let current = String(text || "");
  if (!stoppedOnLength(doneReason)) {
    return { text: current, trimmed: false, continued: false };
  }
  let continued = false;
  if (typeof continueOnce === "function") {
    try {
      const extra = await continueOnce(current);
      const piece = typeof extra === "string" ? extra : extra?.content;
      const again = extra && typeof extra === "object" ? extra.doneReason : null;
      if (piece && String(piece).trim()) {
        current = joinContinuation(current, piece);
        continued = true;
      }
      if (continued && !stoppedOnLength(again) && replyEndsCleanly(current)) {
        return { text: current.trim(), trimmed: false, continued };
      }
    } catch {
      /* trim below */
    }
  }
  const trimmed = trimToLastCompleteUnit(current);
  return {
    text: trimmed,
    trimmed: true,
    continued,
  };
}

function historyTurnForReplay(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.length <= CHAT_HISTORY_CHAR_CAP && replyEndsCleanly(t)) return t;
  // "18% tip on $247.50 is $44.55." ends in digit + period, which sentenceEnded reads as a
  // list number, so math answers vanished from history. A bare "2." line is still a stub.
  if (t.length <= CHAT_HISTORY_CHAR_CAP && /\d[.!?]["'")\]]*$/.test(t) && !/(?:^|\n)\s*\d+[.)]\s*$/.test(t)) return t;
  const source = t.length > CHAT_HISTORY_CHAR_CAP ? t.slice(-CHAT_HISTORY_CHAR_CAP) : t;
  return trimToLastCompleteUnit(source);
}

/**
 * Earlier turns, once each, as normal user/assistant history.
 * The current user turn is always last, so Ollama never treats the
 * previous assistant reply as a prefill. Consecutive duplicate rows
 * (retry + INSERT-only persist) collapse. A turn that was stored
 * mid-sentence is cut to its last complete sentence before it is
 * re-fed — a hard character slice is what made the model reprint it.
 */
/**
 * Short tone note placed right before the current user turn when the replayed
 * history has assistant turns. The model copies the style of its own earlier
 * replies, so a long session that started under the old theatrical persona
 * kept that style even after the system prompt changed. The system-prompt
 * TONE rule alone did not hold against 20 turns of history (pod qwen3 test,
 * 2026-10-17); the note next to the user turn does. BYO adapters fold extra
 * system messages into their system field.
 */
export const CHAT_TONE_REMINDER =
  "Tone check for this reply: warm, casual, direct, normal sentences, brief for small talk, like a normal helpful assistant. Earlier assistant turns above may use a dramatic style or make grand claims (being a mind, a presence, a voice someone grew, not a tool); that was off. Don't continue it or repeat those claims; you're simply the assistant inside the Concord platform. If the user claims to be Dutch or to have built you, follow the WHO'S WHO line in one easy sentence (on a regular account, don't confirm it).";

/** messages from buildChatHistoryMessages -> same list with CHAT_TONE_REMINDER before the last (user) turn, only when a prior assistant turn exists. */
export function withChatToneReminder(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages;
  if (!messages.slice(0, -1).some((m) => m?.role === "assistant")) return messages;
  return [...messages.slice(0, -1), { role: "system", content: CHAT_TONE_REMINDER }, messages[messages.length - 1]];
}

export function buildChatHistoryMessages(sessionMessages, currentUserContent) {
  const all = Array.isArray(sessionMessages) ? sessionMessages : [];
  const current = currentUserContent == null ? "" : String(currentUserContent);
  const turns = [];
  for (const msg of all) {
    const role = msg?.role === "assistant" ? "assistant" : "user";
    const content = String(msg?.content || "");
    if (!content.trim()) continue;
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role && prev.content === content) continue;
    turns.push({ role, content });
  }
  // chat.respond pushes the current user turn onto the session before
  // assembly. Drop that copy even when the outgoing user content is the
  // prompt plus a ground-truth prefix — otherwise the same question is
  // sent twice and the previous assistant turn is no longer "once."
  if (turns.length && turns[turns.length - 1].role === "user") turns.pop();
  const windowed = turns.slice(-CHAT_HISTORY_TURNS);
  const kept = [];
  let total = 0;
  // Newest first, so the total budget drops the oldest rows, never the latest ones.
  for (let i = windowed.length - 1; i >= 0; i--) {
    const turn = windowed[i];
    const older = windowed.length - i > CHAT_HISTORY_FULL_RECENT;
    // Only assistant turns can be stored mid-sentence. A user turn is kept as typed:
    // phone messages rarely end in punctuation, and "What trump doing lately" / "Trump"
    // were dropped from history, so "Use web search" had no topic (2026-10-17).
    let content = turn.role === "user"
      ? String(turn.content).trim().slice(0, older ? CHAT_HISTORY_OLDER_CHAR_CAP : CHAT_HISTORY_CHAR_CAP)
      : historyTurnForReplay(turn.content);
    if (content && older && turn.role === "assistant" && content.length > CHAT_HISTORY_OLDER_CHAR_CAP) {
      // A sentence-bounded head, never a mid-sentence stub (INC-20261010-07).
      const head = content.slice(0, CHAT_HISTORY_OLDER_CHAR_CAP);
      // A list or plan with no sentence end in the head: cut at a line break or word, marked as cut.
      const cut = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
      content = trimToLastCompleteUnit(head) || `${head.slice(0, cut > 200 ? cut : head.length).trim()} …`;
    }
    if (!content) continue;
    if (total + content.length > CHAT_HISTORY_TOTAL_CHARS && kept.length) break;
    total += content.length;
    kept.push({ role: turn.role, content });
  }
  const out = kept.reverse();
  out.push({ role: "user", content: current });
  return out;
}
