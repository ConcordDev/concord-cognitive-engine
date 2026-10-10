/**
 * Strip GRC / ethos envelopes the conscious model echoes into a user-visible
 * chat reply.
 *
 * chat.respond used to append getGRCSystemPrompt() (toneLock, anchor,
 * invariants, mode "governed-response") onto the conscious system prompt.
 * The server already builds that envelope after the reply and returns it on
 * a separate `grc` field. The model still often spent the completion on the
 * envelope. jsonOnlyReply replaces a reply that is ONLY that object.
 * "Paris. OK." followed by the object — fenced, bare, or truncated — was
 * shown. About one reply in eight.
 *
 * A block is removed only when it carries that internal signature. JSON or
 * code the user actually asked for stays. If they asked to see this schema,
 * the reply is left alone.
 */

const INVARIANT_NAMES = /NoNegativeValence|RealityGateBeforeEffects|NoSaaSMinimizeRegression/;

/**
 * True when `text` is (or contains, as a fragment) the internal governance
 * envelope rather than a prose mention of one of its words.
 */
export function isGovernanceLeakFragment(text) {
  const s = String(text || "");
  if (!s) return false;
  if (/"toneLock"\s*:/.test(s)) return true;
  if (/"governed-response"/.test(s)) return true;
  if (INVARIANT_NAMES.test(s) && /"invariants"\s*:/.test(s)) return true;
  if (/"anchor"\s*:/.test(s) && /"invariants"\s*:/.test(s) && /"mode"\s*:/.test(s)) return true;
  return false;
}

/** The user asked to be shown this schema. Do not strip their answer. */
export function userRequestedGovernanceSchema(userText) {
  const u = String(userText || "");
  if (!u) return false;
  if (!/toneLock|governed-response|NoNegativeValence|RealityGateBeforeEffects|NoSaaSMinimizeRegression|\bGRC\b/.test(u)) {
    return false;
  }
  return /\b(json|schema|format|example|sample|show|print|emit|dump|output|write|give)\b/i.test(u);
}

function scanObject(s, start) {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { end: i + 1, closed: true };
    }
  }
  return { end: s.length, closed: false };
}

function looksLikeJsonObjectStart(s, i) {
  let j = i + 1;
  while (j < s.length && /[ \t\r\n]/.test(s[j])) j++;
  if (j >= s.length) return true;
  const c = s[j];
  return c === '"' || c === "{" || c === "[";
}

function unwrapSingleFence(s) {
  const m = String(s || "").match(/^```(?:json|JSON|js|javascript)?[^\n]*\n?([\s\S]*?)\n?```$/);
  return m ? m[1].trim() : null;
}

function decodeJsonString(body) {
  try {
    return JSON.parse(`"${body}"`);
  } catch {
    return body.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

function extractPayload(fragment) {
  const s = String(fragment || "");
  try {
    const obj = JSON.parse(s);
    if (obj && typeof obj.payload === "string") {
      const p = obj.payload.trim();
      if (p && !isGovernanceLeakFragment(p)) return p;
    }
  } catch { /* truncated or broken envelope */ }
  const m = s.match(/"payload"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!m) return "";
  const p = decodeJsonString(m[1]).trim();
  if (!p || isGovernanceLeakFragment(p)) return "";
  return p;
}

function removeLeakFences(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf("```", i);
    if (start < 0) {
      out += s.slice(i);
      break;
    }
    out += s.slice(i, start);
    const close = s.indexOf("```", start + 3);
    if (close < 0) {
      const region = s.slice(start);
      if (isGovernanceLeakFragment(region)) break;
      out += region;
      break;
    }
    const region = s.slice(start, close + 3);
    if (!isGovernanceLeakFragment(region)) out += region;
    i = close + 3;
  }
  return out;
}

function removeBareLeakObjects(s) {
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "{") {
      out += s[i];
      i++;
      continue;
    }
    const prev = i === 0 ? "" : s[i - 1];
    const boundary = i === 0 || /[\s.([,:;]/.test(prev);
    if (!boundary || !looksLikeJsonObjectStart(s, i)) {
      out += s[i];
      i++;
      continue;
    }
    const { end, closed } = scanObject(s, i);
    const slice = s.slice(i, end);
    if (isGovernanceLeakFragment(slice)) {
      i = end;
      continue;
    }
    if (!closed) {
      out += s.slice(i);
      break;
    }
    out += slice;
    i = end;
  }
  return out;
}

function tidy(s) {
  return s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Remove governance envelopes from a completed reply.
 * Returns the input unchanged when it contains none.
 * A reply that is only the envelope becomes its `payload` prose, or "".
 */
export function stripGovernanceLeak(text, { userText } = {}) {
  const raw = String(text ?? "");
  if (!raw) return "";
  if (userRequestedGovernanceSchema(userText)) return raw;

  const trimmed = raw.trim();
  const fenced = unwrapSingleFence(trimmed);
  const body = fenced == null ? trimmed : fenced;
  // Only a reply that is the envelope and nothing else collapses to payload.
  // Prose before or after stays; the object is removed below.
  if (body.startsWith("{") && (fenced != null || trimmed.startsWith("{"))) {
    const { end } = scanObject(body, 0);
    if (end === body.length && isGovernanceLeakFragment(body)) {
      return extractPayload(body);
    }
  }

  let out = removeLeakFences(raw);
  out = removeBareLeakObjects(out);
  if (out === raw) return raw;
  return tidy(out);
}

const HONEST_EMPTY = "I couldn't put together an answer for that one — could you rephrase or ask again?";

/**
 * What gets stored and shown. A reply that was only the envelope, with no
 * payload prose, becomes the same honest line the V6 guard uses — never the
 * cold-start fallback, and never the envelope.
 */
export function visibleChatReply(text, userText) {
  const raw = String(text ?? "");
  const clean = stripGovernanceLeak(raw, { userText });
  if (!clean.trim() && raw.trim() && isGovernanceLeakFragment(raw)) return HONEST_EMPTY;
  return clean;
}

/**
 * Index at which an unclosed fence or JSON object still being generated
 * begins. Everything before it is safe to show.
 */
export function governanceHoldIndex(text) {
  const s = String(text || "");
  let i = 0;
  while (i < s.length) {
    if (s.startsWith("```", i)) {
      const close = s.indexOf("```", i + 3);
      if (close < 0) return i;
      i = close + 3;
      continue;
    }
    if (s[i] === "{") {
      const prev = i === 0 ? "" : s[i - 1];
      const boundary = i === 0 || /[\s.([,:;]/.test(prev);
      if (boundary && looksLikeJsonObjectStart(s, i)) {
        const { end, closed } = scanObject(s, i);
        if (!closed) return i;
        i = end;
        continue;
      }
    }
    i++;
  }
  const tail = s.match(/`{1,2}$/);
  if (tail) return s.length - tail[0].length;
  return s.length;
}

/**
 * Token filter for the socket stream. Holds an open fence or JSON object
 * until it closes, then drops it if it is a governance envelope. The final
 * message is `finish().content` (also what chat:complete should send).
 */
export function createGovernanceLeakFilter({ userText } = {}) {
  let raw = "";
  let sent = "";

  function emit(end) {
    const endIdx = end ? raw.length : governanceHoldIndex(raw);
    const clean = stripGovernanceLeak(raw.slice(0, endIdx), { userText });
    if (clean.startsWith(sent)) {
      const delta = clean.slice(sent.length);
      sent = clean;
      return delta;
    }
    if (sent.startsWith(clean)) return "";
    sent = clean;
    return "";
  }

  return {
    push(token) {
      raw += String(token ?? "");
      return emit(false);
    },
    finish() {
      const delta = emit(true);
      const content = visibleChatReply(raw, userText);
      return { delta, content };
    },
  };
}

const REPLY_TEXT_FIELDS = ["reply", "answer", "content", "text", "message", "response"];

/** Copy a chat macro result with user-visible text fields scrubbed. */
export function scrubChatFields(out, userText) {
  if (!out || typeof out !== "object") return out;
  const next = { ...out };
  for (const k of REPLY_TEXT_FIELDS) {
    if (typeof next[k] === "string") next[k] = stripGovernanceLeak(next[k], { userText });
  }
  return next;
}
