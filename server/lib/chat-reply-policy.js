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
export const CHAT_HISTORY_TURNS = 12;

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
  const out = [];
  for (const turn of windowed) {
    const content = historyTurnForReplay(turn.content);
    if (!content) continue;
    out.push({ role: turn.role, content });
  }
  out.push({ role: "user", content: current });
  return out;
}

/**
 * GRC scaffold leak (INC-20261010-10).
 *
 * Conversational completions sometimes append the Grounded Recursive
 * Closure object (toneLock / anchor / invariants / reality) after the
 * real sentence. jsonOnlyReply only matches when the entire reply is
 * one JSON value, so a prose prefix — or an object cut off before its
 * closing brace — was stored and shown as-is. Fenced code and any
 * other JSON stay. A reply that is only the scaffold keeps its payload.
 */

const GOVERNANCE_SIGNATURE = ["toneLock", "anchor", "invariants", "reality"];

function fenceRanges(text) {
  const ranges = [];
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf("```", i);
    if (start < 0) break;
    const close = text.indexOf("```", start + 3);
    if (close < 0) {
      ranges.push([start, text.length]);
      break;
    }
    ranges.push([start, close + 3]);
    i = close + 3;
  }
  return ranges;
}

function inFence(ranges, index) {
  for (const [start, end] of ranges) {
    if (index >= start && index < end) return true;
  }
  return false;
}

function nextFenceStart(ranges, index) {
  for (const [start] of ranges) {
    if (start > index) return start;
  }
  return null;
}

function scanObjectEnd(text, open) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (c === "\\") {
        esc = true;
        continue;
      }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function readFirstKey(text, open, limit) {
  let j = open + 1;
  while (j < limit && /\s/.test(text[j])) j++;
  if (j >= limit) return { status: "hold" };
  if (text[j] !== '"') return { status: "prose" };
  let k = j + 1;
  let key = "";
  while (k < limit) {
    const c = text[k];
    if (c === "\\") {
      if (k + 1 >= limit) return { status: "hold" };
      key += text[k + 1];
      k += 2;
      continue;
    }
    if (c === '"') return { status: "key", key };
    key += c;
    k++;
  }
  return { status: "hold" };
}

function jsonKeyPresent(slice, key) {
  return new RegExp(`"${key}"\\s*:`).test(slice);
}

function isGovernanceObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  if (typeof obj.toneLock !== "string") return false;
  const anchor = obj.anchor && typeof obj.anchor === "object" && !Array.isArray(obj.anchor);
  const invariants = Array.isArray(obj.invariants);
  const reality = obj.reality && typeof obj.reality === "object" && !Array.isArray(obj.reality);
  return Boolean(anchor || invariants || reality);
}

function truncatedGovernance(slice) {
  const first = readFirstKey(slice, 0, slice.length);
  if (first.status !== "key" || first.key !== "toneLock") return false;
  // An unclosed object that opens with toneLock is the scaffold cut off
  // mid-generation. A finished object is classified by isGovernanceObject,
  // so a user JSON value that merely contains that word is left alone.
  if (scanObjectEnd(slice, 0) < 0) return true;
  const hits = GOVERNANCE_SIGNATURE.filter((key) => jsonKeyPresent(slice, key));
  return hits.length >= 2;
}

function salvagePayload(slice) {
  const match = String(slice || "").match(/"payload"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!match) return "";
  try {
    const value = JSON.parse(`"${match[1]}"`);
    return typeof value === "string" ? value.trim() : "";
  } catch {
    return "";
  }
}

function tidyGap(text) {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function trimGovGap(text) {
  return text.replace(/(?:\n[ \t]*)+$/g, "");
}

export function stripGovernanceScaffold(text, depth = 0) {
  const src = String(text ?? "");
  if (!src) return src;
  const ranges = fenceRanges(src);
  const cuts = [];
  let payload = "";
  let i = 0;
  while (i < src.length) {
    if (inFence(ranges, i)) {
      i++;
      continue;
    }
    if (src[i] !== "{") {
      i++;
      continue;
    }
    const limit = nextFenceStart(ranges, i) ?? src.length;
    const end = scanObjectEnd(src, i);
    if (end > 0 && end <= limit) {
      const slice = src.slice(i, end);
      let obj = null;
      try {
        obj = JSON.parse(slice);
      } catch {
        obj = null;
      }
      if (isGovernanceObject(obj) || (!obj && truncatedGovernance(slice))) {
        if (!payload && obj && typeof obj.payload === "string") payload = obj.payload.trim();
        if (!payload) payload = salvagePayload(slice);
        cuts.push([i, end]);
        i = end;
        continue;
      }
      i = end;
      continue;
    }
    const slice = src.slice(i, limit);
    if (truncatedGovernance(slice)) {
      if (!payload) payload = salvagePayload(slice);
      cuts.push([i, limit]);
      i = limit;
      continue;
    }
    i++;
  }
  if (!cuts.length) return src;
  let out = src;
  for (let c = cuts.length - 1; c >= 0; c--) {
    out = out.slice(0, cuts[c][0]) + out.slice(cuts[c][1]);
  }
  out = tidyGap(out);
  if (!out && payload && depth < 2) return stripGovernanceScaffold(payload, depth + 1) || payload;
  return out;
}

/**
 * Prefix of a streaming completion that is safe to show. A `{` that
 * might open the governance object is held back until it is either
 * the scaffold (dropped) or some other JSON (released).
 */
export function governanceVisiblePrefix(text) {
  const src = String(text ?? "");
  const ranges = fenceRanges(src);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const fence = ranges.find(([start, end]) => i >= start && i < end);
    if (fence) {
      out += src.slice(i, fence[1]);
      i = fence[1];
      continue;
    }
    if (src[i] !== "{") {
      out += src[i];
      i++;
      continue;
    }
    const limit = nextFenceStart(ranges, i) ?? src.length;
    const end = scanObjectEnd(src, i);
    if (end > 0 && end <= limit) {
      const slice = src.slice(i, end);
      let obj = null;
      try {
        obj = JSON.parse(slice);
      } catch {
        obj = null;
      }
      if (isGovernanceObject(obj) || (!obj && truncatedGovernance(slice))) {
        out = trimGovGap(out);
        i = end;
        continue;
      }
      out += slice;
      i = end;
      continue;
    }
    const first = readFirstKey(src, i, limit);
    if (first.status === "key" && first.key === "toneLock") {
      out = trimGovGap(out);
      break;
    }
    if (first.status === "hold") break;
    out += src.slice(i, limit);
    i = limit;
  }
  return out;
}

export function createGovernanceStreamFilter() {
  let raw = "";
  let emitted = "";
  return {
    push(token) {
      raw += String(token ?? "");
      const visible = governanceVisiblePrefix(raw);
      if (!visible.startsWith(emitted)) return "";
      const delta = visible.slice(emitted.length);
      emitted = visible;
      return delta;
    },
    finish() {
      const text = stripGovernanceScaffold(raw);
      let delta = "";
      if (text.startsWith(emitted)) {
        delta = text.slice(emitted.length);
        emitted = text;
      }
      return { delta, text };
    },
  };
}
