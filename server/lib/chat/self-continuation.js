/**
 * Self-continuation loop (Part 4).
 * Pure helpers — no server boot. The only server-side import is the reply-policy
 * module, which is itself pure and testable without boot.
 */

import { existsSync } from "node:fs";
import {
  joinContinuation,
} from "../chat-reply-policy.js";

export const CHECKPOINT_OPEN = "<<<CONCORD_CHECKPOINT";
export const CHECKPOINT_CLOSE = "CONCORD_CHECKPOINT>>>";

export const CONTINUE_SYSTEM =
  "You are continuing your own earlier answer that was split into parts. Write ONLY the next part, starting exactly where the previous part ended. Do not repeat, recap or summarize earlier parts, do not greet, do not restate the question. Keep the same format, headings style and numbering. If this part still cannot finish the answer, end it with the checkpoint block again; if it finishes the answer, leave the block out.";

/** Positive finite env number clamped to [lo, hi]; unset/invalid -> fallback. */
function envInt(raw, fallback, lo, hi) {
  const v = Number(raw);
  if (raw == null || String(raw).trim() === "" || !Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function selfContinueConfig(env = process.env) {
  const e = env || {};
  // "1" = on for every chat turn; "optin" = only for a request that sends selfContinue: true
  // (lets the operator prove it live on one account before flipping it on); anything else = off.
  const flag = String(e.CONCORD_CHAT_SELF_CONTINUE ?? "0").trim().toLowerCase();
  const enabled = flag === "1";
  const optin = flag === "optin";
  const killFile = e.CONCORD_SELF_CONTINUE_KILL_FILE || "/tmp/concord-self-continue.off";
  let killed = String(e.CONCORD_SELF_CONTINUE_KILL ?? "0") === "1";
  if (!killed) {
    try {
      killed = existsSync(killFile);
    } catch {
      killed = false;
    }
  }
  const maxRounds = envInt(e.CONCORD_SELF_CONTINUE_MAX_ROUNDS, 4, 1, 8);
  const roundTokens = envInt(e.CONCORD_SELF_CONTINUE_ROUND_TOKENS, 3072, 256, 8192);
  const maxChars = envInt(e.CONCORD_SELF_CONTINUE_MAX_CHARS, 60000, 2000, 400000);
  const deadlineMs = envInt(e.CONCORD_SELF_CONTINUE_DEADLINE_MS, 600000, 10000, 1800000);
  // "prefill" (default): the continuation request ends with the tail of the answer as an assistant
  // message, so an Ollama brain continues it token-for-token (verified on the pod, Ollama 0.40.5).
  // "note": the tail is shown as context and the model is asked to write the next part.
  const mode = String(e.CONCORD_SELF_CONTINUE_MODE || "prefill").toLowerCase() === "note" ? "note" : "prefill";
  return { enabled, optin, killed, maxRounds, roundTokens, maxChars, deadlineMs, killFile, mode };
}

export function selfContinueActive(env = process.env, input = {}) {
  const cfg = selfContinueConfig(env);
  if (cfg.killed || input?.selfContinue === false) return false;
  return cfg.enabled || (cfg.optin && input?.selfContinue === true);
}

export function checkpointProtocolBlock(roundTokens) {
  const words = Math.round(roundTokens * 0.7);
  return (
    `LONG ANSWERS: You can write about ${words} words per response. If the complete answer will not fit, write as much complete content as fits, finish your last sentence, then end the response with this block and nothing after it:\n` +
    `${CHECKPOINT_OPEN}\n` +
    `{"done":["parts you finished"],"remaining":["parts still to write"],"next":"what to write first next time"}\n` +
    `${CHECKPOINT_CLOSE}\n` +
    "You will then be asked to continue. Never put the block in the middle of a response, never mention it, and leave it out entirely when the answer is complete."
  );
}

function normalizeCheckpoint(raw, itemCap, nextCap) {
  const obj = { done: [], remaining: [], next: "" };
  if (raw && typeof raw === "object") {
    for (const key of ["done", "remaining"]) {
      const v = raw[key];
      if (v == null) {
        // leave empty
      } else if (typeof v === "string") {
        const s = v.trim();
        if (s) obj[key].push(s);
      } else if (Array.isArray(v)) {
        for (const item of v) {
          const s = String(item ?? "").trim();
          if (s) obj[key].push(s.slice(0, itemCap));
        }
      }
    }
    const nextVal = raw.next;
    obj.next = nextVal == null ? "" : String(nextVal).trim().slice(0, nextCap);
  }
  obj.done = obj.done.slice(0, 20);
  // Real-model run 2026-10-18: a finished answer still wrote "remaining":["none"].
  const EMPTY_ITEM = /^(?:none|nothing|n\/?a|null|-+|done|complete|completed|finished|\(none\))\.?$/i;
  obj.remaining = obj.remaining.filter((x) => !EMPTY_ITEM.test(x.trim())).slice(0, 20);
  return obj;
}

function tolerantParseCheckpoint(body) {
  // Try to extract the first {...} substring.
  const braceMatch = body.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      const parsed = JSON.parse(braceMatch[0]);
      return { checkpoint: normalizeCheckpoint(parsed, 300, 400), malformed: true };
    } catch {
      // fall through to line-based parse
    }
  }
  const obj = { done: [], remaining: [], next: "" };
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*(done|remaining|next)\s*[:=]\s*(.*)$/i);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const rest = m[2].trim();
    if (key === "next") {
      obj.next = rest.slice(0, 400);
    } else {
      const parts = rest.split(/;|,/).map((s) => s.trim()).filter(Boolean);
      for (const p of parts.slice(0, 20)) obj[key].push(p.slice(0, 300));
    }
  }
  return { checkpoint: obj, malformed: true };
}

export function parseCheckpoint(text) {
  const source = String(text ?? "");
  const openIdx = source.lastIndexOf(CHECKPOINT_OPEN);
  if (openIdx < 0) {
    return { visible: stripControl(source), checkpoint: null, malformed: false };
  }
  const afterOpen = source.slice(openIdx + CHECKPOINT_OPEN.length);
  const closeIdx = afterOpen.indexOf(CHECKPOINT_CLOSE);
  if (closeIdx < 0) {
    return {
      visible: stripControl(source),
      checkpoint: { done: [], remaining: ["finish the answer"], next: "" },
      malformed: true,
    };
  }
  const body = afterOpen.slice(0, closeIdx);
  let checkpoint = null;
  let malformed = false;
  try {
    const parsed = JSON.parse(body.trim());
    checkpoint = normalizeCheckpoint(parsed, 300, 400);
  } catch {
    const t = tolerantParseCheckpoint(body);
    checkpoint = t.checkpoint;
    malformed = t.malformed;
  }
  if (!checkpoint || (!checkpoint.done.length && !checkpoint.remaining.length && !checkpoint.next)) {
    malformed = true;
    checkpoint = { done: [], remaining: ["finish the answer"], next: "" };
  }
  return { visible: stripControl(source), checkpoint, malformed };
}

export function stripControl(text) {
  if (text == null) return "";
  let s = String(text);
  // Remove every complete OPEN...CLOSE block (non-greedy, multiline).
  const blockRe = new RegExp(
    `${escapeRegex(CHECKPOINT_OPEN)}[\\s\\S]*?${escapeRegex(CHECKPOINT_CLOSE)}`,
    "g"
  );
  s = s.replace(blockRe, "");
  // Remove from any remaining OPEN to end of string.
  const openIdx = s.indexOf(CHECKPOINT_OPEN);
  if (openIdx >= 0) s = s.slice(0, openIdx);
  // Remove any stray lines that contain "CONCORD_CHECKPOINT".
  s = s
    .split(/\r?\n/)
    .filter((line) => !line.includes("CONCORD_CHECKPOINT"))
    .join("\n");
  // Collapse 3+ newlines to 2 and trimEnd.
  s = s.replace(/\n{3,}/g, "\n\n").trimEnd();
  return s;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function needsContinuation({ checkpoint, doneReason }) {
  if (checkpoint && checkpoint.remaining.length > 0) return true;
  return String(doneReason || "").toLowerCase() === "length";
}

export function outlineOf(text, maxChars = 1500) {
  const t = String(text || "").trim();
  if (!t) return "";
  const lines = t.split(/\r?\n/);
  const headings = [];
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line) || /^\*\*[^*\n]+\*\*\s*$/.test(line)) {
      headings.push(line.trim());
    }
  }
  if (headings.length) {
    return headings.join("\n").slice(0, maxChars).trim();
  }
  const paras = t.split(/\n{2,}/).filter((p) => p.trim());
  const out = paras.map((p) => p.trim().slice(0, 80));
  return out.join("\n").slice(0, maxChars).trim();
}

export function buildContinuationMessages({
  systemPrompt = "",
  originalPrompt = "",
  stitched = "",
  checkpoint = null,
  round = 1,
  budgetChars = 60000,
} = {}) {
  const sys = String(systemPrompt).slice(0, 8000) + "\n\n" + CONTINUE_SYSTEM;
  const user0 = String(originalPrompt).slice(0, 6000);

  const stitchedText = String(stitched || "");
  let tail = stitchedText;
  let outline = "";
  if (stitchedText.length > 3500) {
    const startAt = stitchedText.length - 3500;
    // Start tail at next whitespace so words are not cut.
    let cut = startAt;
    while (cut < stitchedText.length && !/\s/.test(stitchedText[cut])) cut++;
    tail = stitchedText.slice(cut).trimStart();
    outline = outlineOf(stitchedText.slice(0, stitchedText.length - tail.length));
  }

  const assistantBody = (outline ? "[Earlier parts — outline]\n" + outline + "\n\n[Most recent text, verbatim]\n" : "") + tail;

  const done = Array.isArray(checkpoint?.done) ? checkpoint.done : [];
  const remaining = Array.isArray(checkpoint?.remaining) ? checkpoint.remaining : [];
  const next = checkpoint?.next ? String(checkpoint.next) : "";
  const selfNote =
    `Self-note from part ${round}: done: ${done.join("; ") || "(see above)"}. ` +
    `Remaining: ${remaining.join("; ") || "finish the answer"}.${next ? " Next: " + next + "." : ""} Continue exactly where the previous part ended.`;

  let messages = [
    { role: "system", content: sys },
    { role: "user", content: user0 },
    { role: "assistant", content: assistantBody },
    { role: "user", content: selfNote },
  ];

  // Budget: if total chars of all contents > budgetChars, first drop the outline,
  // then shrink the tail (keep the last N chars) until it fits (min tail 800 chars).
  const totalChars = () => messages.reduce((s, m) => s + String(m.content || "").length, 0);
  if (totalChars() > budgetChars) {
    const bareTail = stitchedText.length > 3500 ? stitchedText.slice(-3500) : stitchedText;
    messages[2].content = bareTail;
  }
  while (totalChars() > budgetChars && String(messages[2].content).length > 800) {
    const current = String(messages[2].content);
    messages[2].content = current.slice(-Math.floor(current.length * 0.9));
  }

  return messages;
}

// Only markdown "#" headings delimit sections. Bold-only lines ("**Habitat:**") are field labels that
// legitimately repeat in every section (real-model run 2026-10-18 lost 7 sections when they counted).
const HEADING_LINE_RE = /^#{1,6}\s+\S.*$/;
const isHeadingLine = (l) => HEADING_LINE_RE.test(String(l).trim());
const isTableRow = (l) => /^\s*\|/.test(String(l));

/** "## 9. Tufted Titmouse (Baeolophus bicolor)" and "## 9. Tufted Titmouse" share one key. */
export function headingKey(line) {
  return String(line || "").trim().replace(/^#{1,6}\s+/, "").replace(/^\*\*|\*\*:?$/g, "")
    .replace(/\([^)]*\)/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Table rows compare by their first two cells, so padding/wording drift in a re-emitted row still matches. */
export function tableRowKey(line) {
  const cells = String(line).trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  if (cells.every((c) => !c)) return "sep";
  if (String(line).replace(/[|:\-\s]/g, "") === "") return "sep";
  return cells.slice(0, 2).join("|");
}

function splitSections(text) {
  const out = [{ heading: null, lines: [] }];
  for (const line of String(text).split(/\r?\n/)) {
    if (isHeadingLine(line)) out.push({ heading: line, lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

/** Drop a partial (cut-off) final table row so the next part restarts that row cleanly. */
export function dropPartialTableRow(text) {
  const lines = String(text || "").replace(/\s+$/, "").split(/\r?\n/);
  const last = lines[lines.length - 1] || "";
  if (!isTableRow(last)) return lines.join("\n");
  const cellCount = (l) => String(l).trim().replace(/^\||\|$/g, "").split("|").length;
  let header = null;
  for (let i = lines.length - 2; i >= 0 && isTableRow(lines[i]); i--) header = lines[i];
  if (!/\|\s*$/.test(last) || (header && header !== last && cellCount(last) < cellCount(header))) lines.pop();
  return lines.join("\n");
}

/**
 * A length stop usually lands mid-sentence ("hops on la"). Joining the next part there guesses at
 * word boundaries, so cut the final prose line back to its last finished sentence first; the next
 * part then starts a fresh sentence. Lines with no finished sentence, bullets, code and tables are
 * left alone (the join handles them).
 */
export function dropPartialSentence(text) {
  const s = String(text || "").replace(/\s+$/, "");
  const nl = s.lastIndexOf("\n");
  const last = s.slice(nl + 1);
  if (!last.trim() || isTableRow(last) || isHeadingLine(last) || /^\s*(?:[-*•]\s|\d+[.)]\s|```)/.test(last)) return s;
  if (/[.!?…:]["'”’)\]*]*$/.test(last)) return s;
  const m = last.match(/^[\s\S]*[.!?…]["'”’)\]*]*(?=\s)/);
  if (!m || m[0].length < 20) return s;
  return s.slice(0, nl + 1) + m[0];
}

/**
 * Real-model runs (2026-10-18) show the model re-emitting work instead of continuing: it restarts the
 * section it was cut off in ("## 10. Red-winged Blackbird" twice), restarts a cut-off table from its
 * header ("## Summary" x3), or rewrites earlier sections. Reconcile the next part against the text so far:
 *  - section heading already used EARLIER  -> drop that whole section from the new part;
 *  - heading equal to the LAST section's   -> table in progress: merge (keep only rows not already
 *    present); prose: the rewritten section replaces the partial one;
 *  - lines before the first heading (a straight continuation) drop table rows already present.
 * Returns { a, b } — the (possibly cut back) text so far and the de-duplicated new part.
 */
export function reconcileParts(a, b) {
  const aSecs = splitSections(a);
  const aLast = aSecs[aSecs.length - 1];
  const aKeys = new Set(aSecs.filter((x) => x.heading).map((x) => headingKey(x.heading)));
  const lastKey = aLast.heading ? headingKey(aLast.heading) : null;
  const lastHasTable = aLast.lines.some(isTableRow);
  const lastRows = new Set(aLast.lines.filter(isTableRow).map(tableRowKey));
  const keepNewRows = (lines) => lines.filter((l) => !isTableRow(l) || !lastRows.has(tableRowKey(l)));
  let aOut = a;
  const outLines = [];
  for (const [i, sec] of splitSections(b).entries()) {
    if (i === 0 && !sec.heading) { outLines.push(...(lastHasTable ? keepNewRows(sec.lines) : sec.lines)); continue; }
    const k = headingKey(sec.heading);
    if (k && k === lastKey) {
      if (lastHasTable) { outLines.push(...keepNewRows(sec.lines)); continue; }
      const cut = a.lastIndexOf(aLast.heading);
      if (cut >= 0) aOut = a.slice(0, cut).replace(/\s+$/, "");
      outLines.push(sec.heading, ...sec.lines);
      continue;
    }
    if (k && aKeys.has(k)) continue; // an earlier section, re-emitted
    outLines.push(sec.heading, ...sec.lines);
  }
  return { a: aOut, b: outLines.join("\n").replace(/^\s*\n/, "").trim() };
}

/**
 * Cut only an unfinished final line (and a heading left dangling above it). Unlike
 * trimToLastCompleteUnit this keeps bullet lines and table rows that end without a period.
 */
export function trimPartialTail(text) {
  let lines = String(text || "").replace(/\s+$/, "").split(/\r?\n/);
  const clean = (l) => {
    const t = l.trim();
    return !t || /[.!?…:;)\]"'”’*`]$/.test(t) || /\|$/.test(t) || /^```/.test(t) || /^-{3,}$/.test(t);
  };
  if (lines.length && !clean(lines[lines.length - 1])) lines.pop();
  while (lines.length && (/^#{1,6}\s/.test(lines[lines.length - 1].trim()) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join("\n").replace(/\s+$/, "");
}

export function stitch(prev, next) {
  let a = String(prev || "").replace(/\s+$/, "");
  let b = String(next || "").trim();
  if (!b) return a;
  if (!a) return b;
  const rec = reconcileParts(a, b);
  if (!rec.b) return rec.a;
  if (rec.a !== a) return rec.a ? rec.a + "\n\n" + rec.b : rec.b;
  b = rec.b;
  // A continuing table: the next rows go straight under the previous row.
  if (isTableRow(a.split(/\r?\n/).pop()) && isTableRow(b)) return a + "\n" + b;
  const structuralStart = /^#{1,6}\s|^[-*•]\s|^\d+[.)]\s|^\|/;
  const sentenceEnd = /[.!?…]["'"\")\]]*$/;
  const aEndsSentence = sentenceEnd.test(a.trim()) || a.trim().endsWith("```") || a.trim().endsWith("`");
  const bStartsUpper = /^[A-Z]/.test(b);
  const joined = joinContinuation(a, b);
  const noOverlapRemoved = joined === a + " " + b || joined === a + b;
  if ((structuralStart.test(b) || b.startsWith("```") || (aEndsSentence && bStartsUpper)) && noOverlapRemoved) {
    return a + "\n\n" + b;
  }
  return joined;
}

export const PREFILL_SYSTEM =
  "Your previous response was cut off by the length limit. The final assistant message is the end of what you have written so far. Continue it exactly from its last character: do not restart, repeat, recap or summarize, and do not re-add a heading, table header or row that is already written. When the answer is complete, stop.";

/** Tail of the answer for a prefill continuation: at most maxChars, starting on a line boundary when possible. */
function prefillTail(text, maxChars) {
  const t = String(text || "").replace(/\s+$/, "");
  if (t.length <= maxChars) return t;
  const start = t.length - maxChars;
  const nl = t.indexOf("\n", start);
  if (nl >= 0 && nl < t.length - 200) return t.slice(nl + 1);
  let cut = start;
  while (cut < t.length && !/\s/.test(t[cut])) cut++;
  return t.slice(cut).trimStart();
}

export function buildPrefillMessages({
  systemPrompt = "",
  originalPrompt = "",
  stitched = "",
  checkpoint = null,
  budgetChars = 60000,
} = {}) {
  const full = String(stitched || "").replace(/\s+$/, "");
  let tail = prefillTail(full, 3500);
  const outline = tail.length < full.length ? outlineOf(full.slice(0, full.length - tail.length)) : "";
  const real = checkpoint && !(checkpoint.done || []).some((d) => /cut at the token limit/.test(d));
  const note = real
    ? `\nYour own note from the previous part: done: ${(checkpoint.done || []).join("; ") || "-"}; remaining: ${(checkpoint.remaining || []).join("; ") || "-"}${checkpoint.next ? "; next: " + checkpoint.next : ""}.`
    : (checkpoint?.next ? `\n${checkpoint.next}` : "");
  const sysFor = (withOutline) =>
    String(systemPrompt).slice(0, 8000) + "\n\n" + PREFILL_SYSTEM + note +
    (withOutline && outline ? `\nOutline of what you wrote before the text shown:\n${outline}` : "");
  const user0 = String(originalPrompt).slice(0, 6000);
  const total = (sys) => sys.length + user0.length + tail.length;
  let sys = sysFor(true);
  if (total(sys) > budgetChars) sys = sysFor(false);
  while (total(sys) > budgetChars && tail.length > 800) tail = prefillTail(tail, Math.floor(tail.length * 0.9));
  return [
    { role: "system", content: sys },
    { role: "user", content: user0 },
    { role: "assistant", content: tail },
  ];
}

/** Join an exact (prefill) continuation onto the text so far. */
export function joinExact(prev, next) {
  const a = String(prev || "").replace(/\s+$/, "");
  const b = String(next || "").replace(/\s+$/, "");
  if (!b.trim()) return a;
  if (!a) return b.trimStart();
  if (/^\s/.test(b)) return a + b;
  const lastLine = a.slice(a.lastIndexOf("\n") + 1);
  if (/^\|/.test(b) && isTableRow(lastLine) && /\|\s*$/.test(lastLine)) return a + "\n" + b;
  if (/^(?:#{1,6}\s|```|[-*•]\s|\d+[.)]\s)/.test(b)) return a + "\n\n" + b;
  if (/[.!?:;)\]"”’*]$/.test(a) && /^[A-Z"“(*\[]/.test(b)) return a + " " + b;
  return a + b;
}

/**
 * Stitch a prefill continuation. A true continuation is a plain join; if the model still re-emitted
 * sections that already exist (it repeated a heading), the reconcile pass drops or merges them.
 */
export function stitchExact(prev, next) {
  const a = String(prev || "").replace(/\s+$/, "");
  const b = String(next || "");
  const aKeys = new Set(splitSections(a).filter((x) => x.heading).map((x) => headingKey(x.heading)));
  const repeats = String(b).split(/\r?\n/).some((l) => isHeadingLine(l) && aKeys.has(headingKey(l)));
  if (!repeats) return joinExact(a, b);
  const rec = reconcileParts(a, b.trim());
  if (!rec.b) return rec.a;
  return rec.a !== a ? (rec.a ? rec.a + "\n\n" + rec.b : rec.b) : joinExact(a, "\n\n" + rec.b);
}

export async function runSelfContinuation({
  generate,
  firstText,
  firstDoneReason = null,
  systemPrompt = "",
  originalPrompt = "",
  env = process.env,
  now = Date.now,
  budgetChars = 60000,
  onRound = null,
} = {}) {
  if (typeof generate !== "function") {
    throw new TypeError("runSelfContinuation requires a generate function");
  }
  const cfg = selfContinueConfig(env);
  const start = now();
  let p = parseCheckpoint(firstText);
  let text = p.visible;
  let cp = needsContinuation({ checkpoint: p.checkpoint, doneReason: firstDoneReason })
    ? (p.checkpoint || {
        done: ["(cut at the token limit)"],
        remaining: ["finish the answer from where it stopped"],
        next: "",
      })
    : null;
  const checkpoints = cp ? [cp] : [];
  let rounds = 0;
  let stallRetried = false;
  let lastDoneReason = firstDoneReason;
  let stoppedBy = cp ? null : "complete";

  while (cp) {
    if (selfContinueConfig(env).killed) {
      stoppedBy = "kill_switch";
      break;
    }
    if (rounds >= cfg.maxRounds) {
      stoppedBy = "max_rounds";
      break;
    }
    if (text.length >= cfg.maxChars) {
      stoppedBy = "max_chars";
      break;
    }
    if (now() - start >= cfg.deadlineMs) {
      stoppedBy = "deadline";
      break;
    }
    rounds++;
    const prefill = cfg.mode === "prefill";
    if (!prefill) text = dropPartialSentence(dropPartialTableRow(text));
    const messages = prefill
      ? buildPrefillMessages({ systemPrompt, originalPrompt, stitched: text, checkpoint: cp, budgetChars })
      : buildContinuationMessages({ systemPrompt, originalPrompt, stitched: text, checkpoint: cp, round: rounds, budgetChars });
    let r;
    try {
      r = await generate(messages, { maxTokens: cfg.roundTokens, round: rounds });
    } catch (e) {
      r = { ok: false, error: String(e?.message || e) };
    }
    if (!r || r.ok === false) {
      stoppedBy = "round_failed";
      break;
    }
    if (!String(r.text || "").trim()) {
      // A successful but empty continuation: the model has nothing left to add (real-model run
      // 2026-10-18 — a stale "remaining":["Summary"] after the summary was already written).
      if (String(lastDoneReason || "").toLowerCase() === "length") {
        const t = trimPartialTail(text);
        if (t) text = t;
      }
      cp = null;
      stoppedBy = "complete";
      break;
    }
    lastDoneReason = r.doneReason || null;
    const q = parseCheckpoint(r.text);
    const before = text.length;
    text = prefill ? stitchExact(text, q.visible) : stitch(text, q.visible);
    if (onRound) {
      try {
        onRound({ round: rounds, added: text.length - before, checkpoint: q.checkpoint });
      } catch {}
    }
    const stillNeeds = needsContinuation({ checkpoint: q.checkpoint, doneReason: r.doneReason });
    if (stillNeeds && text.length - before < 20) {
      // One retry: the model re-emitted what already exists (typically a table restarted from its header).
      if (!stallRetried) {
        stallRetried = true;
        cp = { ...(cp || {}), next: "Your last attempt only repeated content that is already written. Write ONLY what comes after the last line shown; do not repeat any heading, table header or row." };
        continue;
      }
      stoppedBy = "stalled";
      break;
    }
    cp = stillNeeds
      ? (q.checkpoint || {
          done: ["(cut at the token limit)"],
          remaining: ["finish the answer from where it stopped"],
          next: "",
        })
      : null;
    if (cp) checkpoints.push(cp);
    else stoppedBy = "complete";
  }

  const incomplete = !!cp && stoppedBy !== "complete";
  if (incomplete) {
    const t = trimPartialTail(text);
    if (t) text = t;
    text =
      text +
      `\n\n*(I stopped after ${rounds + 1} part${rounds ? "s" : ""}. Say "continue" and I'll pick up from here.)*`;
  }

  return { text: stripControl(text), rounds, stoppedBy, incomplete, checkpoints };
}
