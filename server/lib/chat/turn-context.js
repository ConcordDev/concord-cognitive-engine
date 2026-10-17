// server/lib/chat/turn-context.js
//
// Keep each chat turn about the CURRENT message.
//
// Live-test finding (2026-10-17, session a40-pub-tools-072626): turn 3 asked
// "What does my Concord substrate (DTUs) know about heat pumps?" and the
// reply re-answered turn 2's integral ("The integral of x² from 0 to 3 is …
// No need for a tool call"). One brain call, current message last in the
// request; replaying the same stored history to the same model with a plain
// system prompt answers the heat-pump question. The difference is the
// context block. chat.respond merges the unified context engine's session
// working set into the prompt, and that working set deliberately keeps the
// previous query's DTUs warm ("Previous query's activated DTUs stay warm;
// new query activates on top", server.js). With no heat-pump DTU retrieved,
// the only "knowledge" in the prompt was the previous topic, and a question
// about "what my DTUs know" was answered from it.
//
// Fix: carried-over DTUs enter the prompt only when they share a content
// word with the current message (short pronoun follow-ups keep them), and
// the system prompt ends with an explicit pointer to the current message.

const STOP = new Set(`a an the of in on for and or to from with by at as into over is are was were be been
  what who where when why how which do does did can could would should will this that these those it its
  their his her please tell me you your my our about than then also not just some any all more most
  know say said says use used using cite give show find`.split(/\s+/).filter(Boolean));

function contentWords(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ")
    .map((w) => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/** "what about the second one?" / "and that?" — refers back, keep the carry-over. */
export function isBackReference(prompt) {
  const p = String(prompt || "").trim();
  const n = contentWords(p).length;
  return n <= 2 || /\b(?:it|that|this|those|them|the (?:first|second|third|last|previous) one|above|earlier|same)\b/i.test(p) && n <= 5;
}

function dtuText(d) {
  return [d?.title, d?.human?.summary, d?.summary, Array.isArray(d?.tags) ? d.tags.join(" ") : ""].filter(Boolean).join(" ");
}

/**
 * Drop carried-over working-set DTUs that have nothing to do with this message.
 * @param {object[]} carried  DTUs that came from the session working set (not this turn's retrieval)
 * @param {string} prompt
 */
export function filterCarryOverDtus(carried, prompt) {
  const list = Array.isArray(carried) ? carried : [];
  if (!list.length || isBackReference(prompt)) return list;
  const q = new Set(contentWords(prompt));
  if (!q.size) return list;
  return list.filter((d) => contentWords(dtuText(d)).some((w) => q.has(w)));
}

/** Closing system-prompt line that names the message to answer. */
export function currentTurnAnchor(prompt) {
  const p = String(prompt || "").replace(/\s+/g, " ").trim();
  if (!p) return "";
  const shown = p.length > 400 ? `${p.slice(0, 400)}…` : p;
  return `\n\nCURRENT MESSAGE (answer this one; earlier turns are context only, never re-answer them): "${shown}"\nContext DTUs were retrieved by keyword and may be unrelated to it. Cite a DTU only if it appears in the context above; if none is about the current message, say so.`;
}
