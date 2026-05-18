// server/domains/studio-players.js
//
// Studio Sprint B Item #1 — Session Player macro surface.

import {
  summonPlayer,
  generatePattern,
  mentorPlayer,
  publishPlayer,
  listPlayersForUser,
  ROLES,
} from "../lib/studio/session-players.js";

export default function registerStudioPlayerMacros(register) {
  register("studio", "player_summon", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return summonPlayer(db, {
      userId,
      role: input.role,
      name: input.name,
    });
  }, { note: "summon an AI Session Player for the user" });

  register("studio", "player_generate", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const bars = Math.max(1, Math.min(32, parseInt(input.bars) || 4));
    return generatePattern(db, {
      userId,
      playerId: String(input.playerId || ""),
      bars,
      context: input.context || {},
      deterministic: input.deterministic === true,
    });
  }, { note: "have a session player compose a pattern", requiresLLM: true });

  register("studio", "player_mentor", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return mentorPlayer(db, {
      userId,
      playerId: String(input.playerId || ""),
      feedback: String(input.feedback || ""),
    });
  }, { note: "give a session player mentor feedback that biases the next generation" });

  register("studio", "player_publish", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    return publishPlayer(db, {
      userId,
      playerId: String(input.playerId || ""),
      priceCents: parseInt(input.priceCents) || 0,
      license: String(input.license || "CC-BY-SA-4.0"),
      summary: String(input.summary || ""),
    });
  }, { note: "publish a session player as an agent_spec DTU" });

  register("studio", "player_list", async (ctx, input = {}) => {
    const db = ctx?.db;
    const userId = ctx?.actor?.userId;
    if (!userId) return { ok: false, reason: "no_actor" };
    const limit = Math.max(1, Math.min(200, parseInt(input.limit) || 50));
    return { ok: true, players: listPlayersForUser(db, userId, limit), roles: ROLES };
  }, { note: "list the user's summoned session players" });
}
