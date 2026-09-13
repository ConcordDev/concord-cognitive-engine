// server/lib/concordia-agent-body.js
//
// AgentBody P0 — character lifecycle on /unity-ws.
// Concord owns the soul (this module + affect_state). Unity owns the pawn.
// MCP is not a control plane.

import crypto from "node:crypto";
import { bindAffect, getAffectStateFor } from "./affect-bridge.js";

const DEFAULT_WORLD = "concordia-hub";
const DEFAULT_NEEDS = { hunger: 0, thirst: 0, energy: 1, comfort: 0.7, pain: 0 };

function newId() {
  return "chr_" + crypto.randomBytes(8).toString("hex");
}

function parseJson(s, fallback) {
  if (s == null || s === "") return fallback;
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" ? v : fallback;
  } catch {
    return fallback;
  }
}

function tableOk(db) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='concordia_agent_characters'`).get();
  } catch {
    return false;
  }
}

function summarizeAffect(db, characterId, worldId) {
  const E = getAffectStateFor(db, characterId, worldId) || bindAffect(db, characterId, worldId);
  if (!E) return null;
  return { v: E.v, a: E.a, s: E.s, c: E.c, g: E.g, t: E.t, f: E.f };
}

function rowToSoul(db, row) {
  const worldId = row.world_id || DEFAULT_WORLD;
  return {
    ok: true,
    characterId: row.id,
    assistantId: row.assistant_id,
    appearance: parseJson(row.appearance_json, {}),
    charter: row.charter || "",
    pose: { worldId, x: row.x, y: row.y, z: row.z, yaw: row.yaw },
    needs: parseJson(row.needs_json, { ...DEFAULT_NEEDS }),
    affect: summarizeAffect(db, row.id, worldId),
    boundSession: row.bound_session || null,
  };
}

export function handleCharacterCreate(db, userId, data = {}) {
  const assistantId = String(data.assistantId || userId || "").trim();
  if (!assistantId) return { ok: false, reason: "missing_assistant" };
  if (!db) return { ok: false, reason: "no_db" };
  if (!tableOk(db)) return { ok: false, reason: "no_character_table" };
  const appearance = data.appearance && typeof data.appearance === "object" ? data.appearance : {};
  const charter = String(data.charter || "");
  const worldId = String(data.worldId || DEFAULT_WORLD);
  const id = newId();
  try {
    db.prepare(
      `INSERT INTO concordia_agent_characters
        (id, assistant_id, user_id, appearance_json, charter, world_id, needs_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, assistantId, userId || null, JSON.stringify(appearance), charter, worldId, JSON.stringify(DEFAULT_NEEDS));
  } catch (e) {
    return { ok: false, reason: e?.message || "insert_failed" };
  }
  const affect = bindAffect(db, id, worldId);
  if (!affect) return { ok: false, reason: "affect_bind_failed", characterId: id };
  const row = db.prepare(`SELECT * FROM concordia_agent_characters WHERE id = ?`).get(id);
  return rowToSoul(db, row);
}

export function handleCharacterLoad(db, userId, data = {}) {
  const characterId = String(data.characterId || "").trim();
  if (!characterId) return { ok: false, reason: "missing_character" };
  if (!db) return { ok: false, reason: "no_db" };
  if (!tableOk(db)) return { ok: false, reason: "no_character_table" };
  const row = db.prepare(`SELECT * FROM concordia_agent_characters WHERE id = ?`).get(characterId);
  if (!row) return { ok: false, reason: "not_found" };
  bindAffect(db, characterId, row.world_id || DEFAULT_WORLD);
  return rowToSoul(db, row);
}

export function handleCharacterBind(db, userId, data = {}) {
  const loaded = handleCharacterLoad(db, userId, data);
  if (!loaded.ok) return loaded;
  const sessionId = String(data.sessionId || userId || "unity-local-guest");
  try {
    db.prepare(
      `UPDATE concordia_agent_characters SET bound_session = ?, updated_at = unixepoch() WHERE id = ?`,
    ).run(sessionId, loaded.characterId);
  } catch {
    /* bind flag is best-effort */
  }
  loaded.boundSession = sessionId;
  loaded.spawn = true;
  return loaded;
}

export function handleCharacterUnbind(db, userId, data = {}) {
  const characterId = String(data.characterId || "").trim();
  if (!characterId) return { ok: false, reason: "missing_character" };
  if (!db) return { ok: false, reason: "no_db" };
  if (!tableOk(db)) return { ok: false, reason: "no_character_table" };
  const row = db.prepare(`SELECT * FROM concordia_agent_characters WHERE id = ?`).get(characterId);
  if (!row) return { ok: false, reason: "not_found" };
  const worldId = String(data.worldId || row.world_id || DEFAULT_WORLD);
  const x = Number.isFinite(data.x) ? data.x : row.x;
  const y = Number.isFinite(data.y) ? data.y : row.y;
  const z = Number.isFinite(data.z) ? data.z : row.z;
  const yaw = Number.isFinite(data.yaw) ? data.yaw : row.yaw;
  let appearanceJson = row.appearance_json;
  if (data.appearance && typeof data.appearance === "object")
    appearanceJson = JSON.stringify(data.appearance);
  try {
    db.prepare(
      `UPDATE concordia_agent_characters
       SET world_id = ?, x = ?, y = ?, z = ?, yaw = ?, appearance_json = ?, bound_session = NULL, updated_at = unixepoch()
       WHERE id = ?`,
    ).run(worldId, x, y, z, yaw, appearanceJson, characterId);
  } catch (e) {
    return { ok: false, reason: e?.message || "unbind_failed" };
  }
  const next = db.prepare(`SELECT * FROM concordia_agent_characters WHERE id = ?`).get(characterId);
  return rowToSoul(db, next);
}

export function handleAgentPerceive(db, userId, data = {}) {
  const loaded = handleCharacterLoad(db, userId, data);
  if (!loaded.ok) return loaded;
  return {
    ok: true,
    characterId: loaded.characterId,
    self: {
      needs: loaded.needs,
      affect: loaded.affect,
      pose: loaded.pose,
    },
    nearby: Array.isArray(data.nearby) ? data.nearby : [],
    telegraph: data.telegraph || null,
    plots: Array.isArray(data.plots) ? data.plots : [],
    talkInbox: Array.isArray(data.talkInbox) ? data.talkInbox : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    charterDigest: (loaded.charter || "").slice(0, 240),
  };
}

export function handleAgentIntent(db, userId, data = {}) {
  const characterId = String(data.characterId || "").trim();
  if (!characterId) return { ok: false, reason: "missing_character" };
  if (db && tableOk(db)) {
    const row = db.prepare(`SELECT id FROM concordia_agent_characters WHERE id = ?`).get(characterId);
    if (!row) return { ok: false, reason: "not_found" };
  }
  return {
    ok: true,
    characterId,
    goal: data.goal || "idle",
    goto: data.goto || null,
    engage: data.engage || null,
    stance: data.stance || "cautious",
    say: data.say || null,
    scheme: data.scheme || null,
    interact: !!data.interact,
  };
}
