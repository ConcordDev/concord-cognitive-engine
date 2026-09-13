// Concord 2B — Convai conversation provider + Unity /unity-ws dialogue:request.
//
// Concord owns the decision. Convai is presentation. This module is the
// chokepoint: try the local 2B (qwen3.5:2b on this box), then the existing
// deterministic NPC fallback. Never invent cities, lovers, or lore.

import {
  composeDeterministicDialogue,
  composeDeterministicResponse,
} from "./npc-dialogue-fallback.js";
import { explainNpc } from "./world-inspect.js";
import { authoredNpcPublic } from "./world-lore-present.js";

export const CONCORD_2B_PROVIDER_ID = "concord-2b";
export const CONCORD_2B_MODEL = process.env.CONCORD_2B_MODEL || "qwen3.5:2b";

const BANNED = /aurelia|admits he loves her|i love her/i;

function clip(s, n = 240) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length <= n ? t : t.slice(0, n).trim();
}

function honestName(name, npcId) {
  const n = clip(name, 64);
  if (!n || BANNED.test(n)) return clip(npcId, 64) || "Someone";
  return n;
}

function sanitizeReply(text) {
  const t = clip(text, 280);
  if (!t || BANNED.test(t)) return "";
  return t;
}

/**
 * Ask Concord's 2B (or an injected chat) for one in-character line.
 * @param {object} input
 * @param {{ chat?: Function }} [deps]
 */
export async function composeTwoBDialogue(input = {}, deps = {}) {
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  const worldId = clip(input.worldId, 80);
  const npcId = clip(input.npcId, 80);
  const npcName = honestName(input.npcName, npcId);
  const authored = authoredNpcPublic(npcId, worldId);
  const known = clip(input.line || authored?.line, 200);
  const playerText = clip(input.text, 280);
  const userId = clip(input.userId, 80);

  const base = {
    ok: true,
    provider: CONCORD_2B_PROVIDER_ID,
    requestId,
    worldId,
    npcId,
    npcName,
  };

  if (process.env.CONCORD_2B === "0") {
    return { ...base, ...deterministicReply({ npcId, npcName, playerText, db: input.db, userId, worldId }), reason: "disabled" };
  }

  const chat = typeof deps.chat === "function" ? deps.chat : defaultTwoBChat;
  try {
    const raw = await chat({
      worldId,
      npcId,
      npcName,
      line: known,
      text: playerText,
      userId,
    });
    const text = sanitizeReply(typeof raw === "string" ? raw : raw?.text);
    if (text) {
      return {
        ...base,
        text,
        model: typeof raw === "object" && raw?.model ? raw.model : CONCORD_2B_MODEL,
        fallback: false,
      };
    }
    return {
      ...base,
      ...deterministicReply({ npcId, npcName, playerText, db: input.db, userId, worldId }),
      reason: "empty_or_banned",
    };
  } catch (e) {
    return {
      ...base,
      ...deterministicReply({ npcId, npcName, playerText, db: input.db, userId, worldId }),
      reason: String(e?.message || e || "brain_unavailable").slice(0, 120),
    };
  }
}

function deterministicReply({ npcId, npcName, playerText, db, userId, worldId }) {
  let grounded = null;
  if (db && npcId) {
    try { grounded = explainNpc(db, npcId, { viewerId: userId, worldId }); } catch { /* */ }
  }
  const authored = authoredNpcPublic(npcId, worldId || grounded?.worldId);
  const mood = grounded?.axes?.hatred > 0.4 ? "hostile"
    : grounded?.axes?.fear > 0.4 ? "fearful"
    : grounded?.axes?.gratitude > 0.4 ? "friendly"
    : "neutral";
  if (playerText) {
    const r = composeDeterministicResponse({ npcId, npcName, choice: "ask_world" });
    const why = grounded?.ok ? grounded.why : "";
    const spoken = authored?.line || r.greeting || r.text || r;
    return {
      text: why ? `${spoken} (${why})` : spoken,
      model: "deterministic",
      fallback: true,
      inspect: grounded?.ok ? grounded : undefined,
    };
  }
  const d = composeDeterministicDialogue({
    npcId,
    npcName,
    mood,
    currentActivity: grounded?.activity,
    faction: grounded?.faction,
  });
  const extra = grounded?.ok ? grounded.why : "";
  return {
    text: [authored?.line || d.greeting, d.subtext, extra].filter(Boolean).join(" "),
    model: "deterministic",
    fallback: true,
    inspect: grounded?.ok ? grounded : undefined,
  };
}

function twoBEndpoint() {
  // Concurrency Refactor Phase 4 — route through concord-ollama-proxy when set
  // (fail-fast connect + shared circuit breaker). This path deliberately avoids
  // BRAIN_CONFIG, so it needs its own OLLAMA_PROXY_URL check.
  const raw = process.env.OLLAMA_PROXY_URL || process.env.CONCORD_2B_URL || "http://127.0.0.1:11434";
  return String(raw).replace(/\/$/, "");
}

async function defaultTwoBChat({ worldId, npcName, line, text }) {
  const system = [
    "You are Concord's 2B decision voice for one authored NPC.",
    "Speak only as this person. Do not invent cities, lovers, kingdoms, or lore.",
    "Do not say anyone loves anyone. Do not name Aurelia.",
    "One or two short spoken sentences. No lists. No stage directions.",
  ].join(" ");
  const user = [
    `NPC: ${npcName}`,
    line ? `Known line: ${line}` : "",
    worldId ? `World: ${worldId}` : "",
    text ? `Player said: ${text}` : "Player approached and waited.",
  ].filter(Boolean).join("\n");

  // Call-time URL — do not go through BRAIN_CONFIG. That object freezes the
  // docker hostname `ollama-conscious` at import, before dotenv, which is
  // why a working local qwen3.5:2b was reporting fetch failed.
  const endpoint = twoBEndpoint();
  const res = await fetch(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CONCORD_2B_MODEL,
      stream: false,
      think: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      options: { temperature: 0.4, num_predict: 80 },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const out = j?.message?.content || j?.response || "";
  if (!out) throw new Error("brain_unavailable");
  return { text: out, model: CONCORD_2B_MODEL };
}

export default { composeTwoBDialogue, CONCORD_2B_PROVIDER_ID, CONCORD_2B_MODEL };
