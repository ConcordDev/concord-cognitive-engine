// Concordia presenter verbs on /godot-ws and /unity-ws.
// Gift, barge-in, party snapshot, inheritance, dodge i-frames — same libs the
// HTTP/macro paths already use. Kitchen clients (no row yet) still get the
// authored giftReaction math; they never get a fabricated kernel consume.

import { giveGift, giftReaction, GIFT_DELTA } from "./gifting.js";
import { interveneInScheme } from "./npc-schemes.js";
import { getInheritanceForHeir, getInheritanceFromDeceased } from "./npc-legacy.js";
import { joinSession } from "./concordia-session.js";
import { grantIFrames } from "./combat-state.js";
import { openInstance, DUNGEON_ENCOUNTERS } from "./dungeon-instance.js";
import { getMyParty } from "./parties.js";
import { startHorde, getActiveHorde } from "./horde-mode.js";
import { startRun as startExtraction, getActiveRun as getActiveExtraction } from "./extraction.js";
import { runParticipants } from "./run-coop.js";

export function handleGiftGive(db, userId, data = {}) {
  const npcId = String(data.npcId || "");
  const itemId = String(data.itemId || "");
  if (!userId || !npcId || !itemId) return { ok: false, reason: "missing_inputs" };
  if (db) {
    const r = giveGift(db, {
      userId,
      npcId,
      itemId,
      worldId: data.worldId ? String(data.worldId) : "concordia-hub",
    });
    if (r.ok) return { ...r, source: "kernel", npcId };
    if (r.reason === "npc_not_found" || r.reason === "item_not_owned" || r.reason === "no_inventory") {
      const reaction = giftReaction(
        { archetype: data.archetype },
        data.itemName || itemId,
      );
      return {
        ok: true,
        reaction,
        delta: GIFT_DELTA[reaction],
        affinity: null,
        source: "kit",
        kernel: r.reason,
        npcId,
      };
    }
    return r;
  }
  const reaction = giftReaction({ archetype: data.archetype }, data.itemName || itemId);
  return { ok: true, reaction, delta: GIFT_DELTA[reaction], source: "kit" };
}

export function handleSchemeIntervene(db, userId, data = {}) {
  const schemeId = String(data.schemeId || data.id || "");
  const action = String(data.action || "ignore");
  if (!userId || !schemeId) return { ok: false, reason: "missing_inputs" };
  if (!db) return { ok: true, action, source: "presenter", schemeId };
  try {
    const r = interveneInScheme(db, userId, schemeId, action);
    return { ...r, source: r.ok ? "kernel" : (r.reason || "kernel") };
  } catch (e) {
    const msg = String(e?.message || e);
    if (/no such table/i.test(msg) || /npc_schemes/i.test(msg))
      return { ok: false, reason: "scheme_not_found" };
    return { ok: false, reason: msg };
  }
}

export function handlePartyRequest(userId, data = {}) {
  const worldId = String(data.worldId || "concordia-hub");
  if (!userId) return { ok: false, reason: "missing_user" };
  const x = Number(data.x || 0);
  const z = Number(data.z || 0);
  return joinSession(worldId, userId, { x, z });
}

export function handleInheritanceRequest(db, data = {}) {
  const heirId = data.heirId ? String(data.heirId) : "";
  const deceasedId = data.deceasedId ? String(data.deceasedId) : "";
  if (!heirId && !deceasedId) return { ok: false, reason: "missing_inputs" };
  if (!db) return { ok: true, links: [], source: "presenter" };
  const links = heirId
    ? getInheritanceForHeir(db, heirId)
    : getInheritanceFromDeceased(db, deceasedId);
  return { ok: true, links: Array.isArray(links) ? links : [], source: "kernel" };
}

export function handleDodge(userId, data = {}) {
  if (!userId) return { ok: false, reason: "missing_user" };
  const perfect = data.perfect === true || data.wasParry === true;
  const ms = perfect ? 500 : 350;
  try { grantIFrames(userId, ms); } catch { /* in-memory optional */ }
  return { ok: true, iframeMs: ms, perfect: !!perfect };
}

export function handleDungeonOpen(db, userId, data = {}) {
  const encounterId = String(data.encounterId || "hollow_warden");
  const enc = DUNGEON_ENCOUNTERS[encounterId];
  if (!enc) return { ok: false, reason: "unknown_encounter" };
  const catalog = {
    name: enc.name,
    hp: enc.baseHp,
    maxHp: enc.baseHp,
    phase: enc.phases[0].name,
    mechanic: enc.phases[0].mechanic,
  };
  if (!userId) return { ok: false, reason: "missing_user" };
  if (db) {
    try {
      const r = openInstance(db, {
        leaderUserId: userId,
        worldId: data.worldId ? String(data.worldId) : "concordia-hub",
        encounterId,
        members: Array.isArray(data.members) ? data.members : [],
      });
      if (r.ok) return { ...r, source: "kernel" };
      if (r.reason === "locked_out" || r.reason === "unknown_encounter") return r;
      return { ok: true, source: "presenter", encounterId, boss: catalog, kernel: r.reason };
    } catch (e) {
      return { ok: true, source: "presenter", encounterId, boss: catalog, kernel: String(e?.message || e) };
    }
  }
  return { ok: true, source: "presenter", encounterId, boss: catalog };
}

export function handleRunStart(db, userId, data = {}) {
  const kind = String(data.kind || data.mode || "").toLowerCase();
  const worldId = String(data.worldId || "concordia-hub");
  if (!userId) return { ok: false, reason: "missing_user" };
  if (kind !== "horde" && kind !== "extraction") return { ok: false, reason: "unknown_kind" };
  if (!db) return { ok: false, reason: "no_db" };

  let partyId = data.partyId ? String(data.partyId) : "";
  if (!partyId) {
    try {
      const mine = getMyParty(db, userId);
      if (mine?.party_id) partyId = mine.party_id;
    } catch { /* parties table optional */ }
  }
  partyId = partyId || null;

  try {
    if (kind === "horde") {
      const r = startHorde(db, userId, { worldId, partyId });
      if (!r?.ok) return { ok: false, reason: r?.error || "start_failed", kind };
      const run = getActiveHorde(db, userId);
      const roster = runParticipants(db, "horde", r.runId);
      return {
        ok: true,
        kind,
        source: "kernel",
        runId: r.runId,
        joined: !!r.joined,
        alreadyActive: !!r.alreadyActive,
        partyId: r.partyId || partyId,
        roster,
        wave: run?.wave_reached ?? 0,
        kills: run?.kills ?? 0,
        score: run?.score ?? 0,
      };
    }
    const r = startExtraction(db, userId, { worldId, partyId });
    if (!r?.ok) return { ok: false, reason: r?.error || "start_failed", kind };
    const run = getActiveExtraction(db, userId);
    const roster = runParticipants(db, "extraction", r.runId);
    return {
      ok: true,
      kind,
      source: "kernel",
      runId: r.runId,
      joined: !!r.joined,
      alreadyActive: !!r.alreadyActive,
      partyId: r.partyId || partyId,
      roster,
      timeoutAt: r.timeoutAt || run?.timeout_at,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e), kind };
  }
}

export default {
  handleGiftGive,
  handleSchemeIntervene,
  handlePartyRequest,
  handleInheritanceRequest,
  handleDodge,
  handleDungeonOpen,
  handleRunStart,
};
