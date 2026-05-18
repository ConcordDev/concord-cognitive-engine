// server/domains/whiteboard-voice.js
//
// Whiteboard Sprint B Item #10 — voice-to-sticky / voice-to-shape.
//
// Frontend captures audio via VoiceDictateButton (reused from code
// lens Sprint C #12) and POSTs to /api/voice/transcribe-raw (Phase 13
// voice modality). The transcript is then passed here, which decides
// whether to add a sticky (default) or a shape (when the utterance
// begins with "draw a/an X" / "add a/an X").
//
// Real classifier — small regex/heuristic, not a brain call (cheap +
// instant). When a brain is wanted for nuance, the frontend can wire
// a separate macro; this one is the fast path.

import { randomUUID } from "node:crypto";
import { getBoard, appendDelta, hasRole } from "../lib/whiteboard/persistence.js";

const SHAPE_KEYWORDS = {
  rectangle: ["rectangle", "rect", "box", "card"],
  ellipse:   ["ellipse", "circle", "oval", "ball"],
  arrow:     ["arrow"],
  line:      ["line"],
  notecard:  ["sticky", "note", "notecard"],
  frame:     ["frame", "section", "group", "container"],
};

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }

function _classify(transcript) {
  const t = String(transcript || "").trim();
  if (!t) return { kind: "notecard", text: "" };
  const lower = t.toLowerCase();
  // "draw a/an <kind> <text>" / "add a/an <kind> <text>"
  const m = lower.match(/^(?:draw|add)\s+(?:a|an)\s+(\w+)\b\s*(?:that\s+says\s+|labelled\s+|labeled\s+|called\s+|saying\s+)?(.*)$/);
  if (m) {
    const word = m[1];
    const labelOriginalCase = t.replace(/^[^,]*(?:that\s+says\s+|labelled\s+|labeled\s+|called\s+|saying\s+)/i, "").trim() || m[2].trim();
    for (const [kind, words] of Object.entries(SHAPE_KEYWORDS)) {
      if (words.includes(word)) return { kind, text: labelOriginalCase || word };
    }
  }
  // Default: a sticky with the full transcript.
  return { kind: "notecard", text: t.slice(0, 500) };
}

export const __test = { _classify };

export default function registerWhiteboardVoiceMacros(register) {
  register("whiteboard", "voice_to_element", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const boardId = String(input.boardId || "");
    const transcript = String(input.transcript || "").trim();
    if (!boardId) return { ok: false, reason: "boardId_required" };
    if (!transcript) return { ok: false, reason: "transcript_required" };
    if (!hasRole(db, boardId, userId, "editor")) return { ok: false, reason: "forbidden" };
    const row = getBoard(db, boardId);
    if (!row) return { ok: false, reason: "board_not_found" };
    const { kind, text } = _classify(transcript);
    const x = Number(input.x) || Math.round(Math.random() * 600);
    const y = Number(input.y) || Math.round(Math.random() * 400);
    const el = {
      id: `voice_${randomUUID().slice(0, 8)}`,
      kind, type: kind,
      x, y,
      width: kind === "ellipse" ? 140 : 160,
      height: kind === "notecard" ? 80 : 60,
      text,
      stroke: kind === "notecard" ? "#fbbf24" : "#9ca3af",
      fill: "transparent",
      strokeWidth: 2,
      authoredBy: "voice",
    };
    const scene = row.scene || { elements: [] };
    const newScene = { ...scene, elements: [...(scene.elements || []), el] };
    const applied = appendDelta(db, { boardId, userId, deltaKind: "element_add", delta: el, newScene });
    if (!applied.ok) return applied;
    try {
      globalThis._concordREALTIME?.io?.to(`whiteboard:${boardId}`).emit("whiteboard:voice-element", {
        boardId, userId, element: el, ts: Date.now(),
      });
    } catch { /* best effort */ }
    return { ok: true, element: el, kind, transcriptUsed: text };
  }, { destructive: true, note: "Turn a voice transcript into a sticky (default) or shape (when 'draw a <kind>')" });
}
