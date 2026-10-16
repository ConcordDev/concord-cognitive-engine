// server/lib/lens-contract-guards.js
//
// Route-level input guards for the fix/lens-contract-5-bugs sweep. Each
// helper turns a malformed request body into a clean { ok:false, error }
// the route can answer with HTTP 400/409/503 — instead of letting the bad
// shape reach an engine that throws (sqlite bind/CHECK errors, a
// ~30s dream-cycle hang, "Buffer.from(object)" crashes, or a fabricated
// "lens_failed" from the lens runner).
//
// Kept dependency-free (node builtins only) and unit-tested in
// server/tests/lens-contract-5-bugs.test.js — the routes in server.js are
// one-line consumers of these guards.

import { gunzipSync } from "node:zlib";

// ── Bug 1: POST /api/courtship/interact ─────────────────────────────────────
// player_courtship only accepts partner_kind IN ('player','npc') (migration
// 206 CHECK constraint) and better-sqlite3 throws on non-string binds —
// both surfaced as 500s. Validate BEFORE touching the engine.

export const COURTSHIP_PARTNER_KINDS = ["player", "npc"];

export function validateCourtshipInteraction(body = {}) {
  const partnerKind = body?.partnerKind;
  // NPC ids can arrive as numbers (NPCActionMenu sends menu.npcId); accept
  // a finite number and normalise it to a string like before.
  const partnerId = typeof body?.partnerId === "number" && Number.isFinite(body.partnerId)
    ? String(body.partnerId) : body?.partnerId;
  const rawSentiment = body?.sentiment;
  if (typeof partnerKind !== "string" || !COURTSHIP_PARTNER_KINDS.includes(partnerKind)) {
    return { ok: false, error: "partnerKind must be 'player' or 'npc'" };
  }
  if (typeof partnerId !== "string" || partnerId.trim() === "") {
    return { ok: false, error: "partnerId must be a non-empty string" };
  }
  // Absent sentiment keeps the historical default of 1; a present sentiment
  // must be a finite number (engine clamps it to -1..1).
  let sentiment = 1;
  if (rawSentiment !== undefined && rawSentiment !== null && rawSentiment !== "") {
    if (typeof rawSentiment !== "number" || !Number.isFinite(rawSentiment)) {
      return { ok: false, error: "sentiment must be a finite number" };
    }
    sentiment = rawSentiment;
  }
  return { ok: true, partnerKind, partnerId: partnerId.trim(), sentiment };
}

// ── Bug 2: bounded waits (POST /api/dreams/start) ────────────────────────────
// Races `promise` against a timer. On timeout the rejection carries
// { timedOut: true } so the caller can answer 503 { retryable: true }
// instead of hanging ~30s behind a slow/unavailable LLM call.

export function withTimeout(promise, ms, message) {
  let timer = null;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(message), { timedOut: true }));
    }, ms);
  });
  const raced = Promise.race([promise, timeout]);
  const clear = () => { if (timer !== null) clearTimeout(timer); };
  raced.then(clear, clear); // cancel the timer whichever way the race settles
  return raced;
}

// ── Bug 4: POST /api/substrate/import ────────────────────────────────────────
// Accept exactly one of:
//   • a raw gzipped Buffer,
//   • { data: "<base64 of gzip>" },
//   • a plain JSON object with a dtus array (imported directly).
// Anything else — including bad gzip, bad JSON inside the gzip, or a
// non-object dtu — is a 400 with a clear error, never a Buffer.from(obj)
// crash (which is what the old `Buffer.from(req.body)` did to parsed JSON).

function gunzipJson(buf) {
  let raw;
  try {
    raw = gunzipSync(buf);
  } catch (_e) {
    return { ok: false, error: "invalid gzip substrate" };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (_e) {
    return { ok: false, error: "substrate is not valid JSON" };
  }
  return { ok: true, substrate: parsed };
}

export const SUBSTRATE_IMPORT_EXPECTED_ERROR = "expected gzipped substrate or {dtus:[...]}";

export function parseSubstrateImportBody(body) {
  let substrate = null;
  if (Buffer.isBuffer(body)) {
    const r = gunzipJson(body);
    if (!r.ok) return r;
    substrate = r.substrate;
  } else if (body && typeof body === "object" && !Array.isArray(body)) {
    if (typeof body.data === "string" && body.data.trim() !== "") {
      const r = gunzipJson(Buffer.from(body.data, "base64"));
      if (!r.ok) return r;
      substrate = r.substrate;
    } else if (Array.isArray(body.dtus)) {
      substrate = body;
    }
  }
  if (!substrate || typeof substrate !== "object" || Array.isArray(substrate)) {
    return { ok: false, error: SUBSTRATE_IMPORT_EXPECTED_ERROR };
  }
  const dtus = Array.isArray(substrate.dtus) ? substrate.dtus : [];
  for (const dtu of dtus) {
    if (!dtu || typeof dtu !== "object" || Array.isArray(dtu)) {
      return { ok: false, error: "substrate.dtus must be an array of objects" };
    }
  }
  return {
    ok: true,
    dtus,
    sourceUserId: substrate.userId != null ? substrate.userId : null,
  };
}