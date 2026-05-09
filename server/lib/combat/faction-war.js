// server/lib/combat/faction-war.js
//
// Shared faction-war event scaffolding. Spawns N NPCs from each side with
// style-seeded combat flow history so they enter the war already partially
// evolved; ticks NPC-vs-NPC engagements; emits realtime updates to anyone
// watching. Players who join the event slot into one side and fight via
// the regular combat:attack path — their flows count toward both their
// personal evolution and the side's collective wins.
//
// This is the multi-player layer of the Flow Combat spec: dozens of NPCs
// in the background co-evolving against each other while players drop in
// and contribute. The recorder + flow engine handle scale by being O(1)
// per action; the war tick caps engagements per tick to bound CPU.

import crypto from "node:crypto";
import logger from "../../logger.js";
import { recordCombatFlow } from "./flow-recorder.js";
import { evolveFighterCombos } from "./flow-engine.js";

const FACTION_DEFAULT_STYLES = {
  iron_wardens:        ["ground-grapple", "shield-wall", "halberd-ring"],
  scholars_guild:      ["arcane-arc", "ward-trace", "scroll-burst"],
  merchant_collective: ["coin-toss", "evade-dance", "hired-guard"],
  shadow_network:      ["assassin-flick", "smoke-veil", "ice-pick"],
  zero_collective:     ["breach", "overload", "drone-swarm"],
  blackout_resistance: ["dirt-fighter", "emp-burst", "ambush-fade"],
  default:             ["ufc", "street-fighter", "ground-grapple"],
};

// ── State ────────────────────────────────────────────────────────────────────

const _wars = new Map();          // warId → { eventId, sides, npcs, lastTickAt, ... }

// ── Schema ───────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS faction_war_npcs (
    id           TEXT PRIMARY KEY,           -- npc id (used as fighter_id in combat_flows)
    war_id       TEXT NOT NULL,
    event_id     TEXT,
    faction_id   TEXT NOT NULL,
    style_seed   TEXT NOT NULL DEFAULT '',
    spawned_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    health       REAL NOT NULL DEFAULT 100,
    alive        INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_faction_war_npcs_war ON faction_war_npcs(war_id, alive);

  CREATE TABLE IF NOT EXISTS faction_wars (
    id            TEXT PRIMARY KEY,
    event_id      TEXT,
    cityId        TEXT,
    side_a        TEXT NOT NULL,             -- faction id
    side_b        TEXT NOT NULL,
    side_a_wins   INTEGER NOT NULL DEFAULT 0,
    side_b_wins   INTEGER NOT NULL DEFAULT 0,
    started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
    ended_at      INTEGER,
    status        TEXT NOT NULL DEFAULT 'active'
  );
  CREATE INDEX IF NOT EXISTS idx_faction_wars_status ON faction_wars(status);
`;

let _schemaApplied = false;
function ensureSchema(db) {
  if (_schemaApplied) return;
  try { db.exec(SCHEMA); } catch { /* exists */ }
  _schemaApplied = true;
}

// ── Spawn ────────────────────────────────────────────────────────────────────

/**
 * Spawn a new faction war. Creates NPCs on each side and seeds each one
 * with 8-12 prior combat flows so the flow engine has signal to derive
 * starter combos when the war kicks off.
 *
 * @param {object} params
 * @param {string} params.eventId
 * @param {string} params.cityId
 * @param {string} params.sideA            faction id
 * @param {string} params.sideB            faction id
 * @param {number} [params.spawnsPerSide=8]
 * @param {object} [params.context={ context: 'ground' }]
 */
export function spawnFactionWar(db, params) {
  if (!db || !params?.sideA || !params?.sideB) return { ok: false, error: "missing_args" };
  ensureSchema(db);

  const warId = crypto.randomUUID();
  const spawnsPerSide = Math.max(2, Math.min(50, Number(params.spawnsPerSide || 8)));
  const ctxLabel = params.context?.context || "ground";

  db.prepare(`
    INSERT INTO faction_wars (id, event_id, cityId, side_a, side_b, status)
    VALUES (?, ?, ?, ?, ?, 'active')
  `).run(warId, params.eventId || null, params.cityId || null, params.sideA, params.sideB);

  const stylesA = FACTION_DEFAULT_STYLES[params.sideA] ?? FACTION_DEFAULT_STYLES.default;
  const stylesB = FACTION_DEFAULT_STYLES[params.sideB] ?? FACTION_DEFAULT_STYLES.default;

  function seedFlowsFor(npcId, style) {
    // 8 prior chains of [light, heavy, light] so the recorder has enough
    // signal for the flow engine to land at least one tier-1 combo on the
    // first evolve pass after the war begins.
    for (let f = 0; f < 8; f++) {
      const chain = `seed:${warId}:${npcId}:${f}`;
      recordCombatFlow(db, {
        fighterId: npcId, fighterKind: "npc", context: ctxLabel, style,
        action: "attack-light", actionMeta: { warId, seed: true },
        hit: true, damage: 8 + Math.random() * 4,
        chainId: chain, stepIndex: 0,
      });
      recordCombatFlow(db, {
        fighterId: npcId, fighterKind: "npc", context: ctxLabel, style,
        action: "attack-heavy", actionMeta: { warId, seed: true },
        hit: true, damage: 15 + Math.random() * 6,
        chainId: chain, stepIndex: 1,
      });
      recordCombatFlow(db, {
        fighterId: npcId, fighterKind: "npc", context: ctxLabel, style,
        action: f % 2 === 0 ? "attack-light" : "grapple",
        actionMeta: { warId, seed: true },
        hit: Math.random() > 0.2, damage: 7 + Math.random() * 6,
        chainId: chain, stepIndex: 2,
      });
    }
  }

  const insert = db.prepare(`
    INSERT INTO faction_war_npcs (id, war_id, event_id, faction_id, style_seed)
    VALUES (?, ?, ?, ?, ?)
  `);

  const npcs = { sideA: [], sideB: [] };
  for (let i = 0; i < spawnsPerSide; i++) {
    const idA = `war:${warId}:a:${i}`;
    const styleA = stylesA[i % stylesA.length];
    insert.run(idA, warId, params.eventId || null, params.sideA, styleA);
    seedFlowsFor(idA, styleA);
    npcs.sideA.push({ id: idA, style: styleA });

    const idB = `war:${warId}:b:${i}`;
    const styleB = stylesB[i % stylesB.length];
    insert.run(idB, warId, params.eventId || null, params.sideB, styleB);
    seedFlowsFor(idB, styleB);
    npcs.sideB.push({ id: idB, style: styleB });
  }

  // Run an initial evolve pass so each side starts the war with at least
  // one tier-1 combo each (the spec's "you're not fighting a scripted
  // enemy" beat — the NPCs already know how to fight before you arrive).
  for (const n of [...npcs.sideA, ...npcs.sideB]) {
    try { evolveFighterCombos(db, n.id, "npc"); } catch { /* best-effort */ }
  }

  _wars.set(warId, {
    warId, eventId: params.eventId, cityId: params.cityId,
    sideA: params.sideA, sideB: params.sideB,
    npcs, lastTickAt: 0, context: ctxLabel,
  });

  logger.info?.({ warId, sideA: params.sideA, sideB: params.sideB, spawnsPerSide }, "faction_war_spawned");
  return { ok: true, warId, npcs };
}

// ── Tick ─────────────────────────────────────────────────────────────────────

/**
 * Run one tick of all active faction wars. Each tick pairs alive NPCs from
 * opposing sides and records a single round of combat (attack-light or
 * attack-heavy) between them. CPU-bounded: at most 6 engagements per war
 * per tick. Long enough to make the fight feel alive in the background;
 * short enough to scale to dozens of wars at once.
 */
export function tickAllFactionWars(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  ensureSchema(db);

  const realtimeEmit = globalThis.realtimeEmit;
  const maxEngagementsPerWar = Math.max(1, Math.min(20, Number(opts.maxEngagements || 6)));

  let totalEngagements = 0;
  for (const war of _wars.values()) {
    const aliveA = war.npcs.sideA.filter((n) => isAlive(db, n.id));
    const aliveB = war.npcs.sideB.filter((n) => isAlive(db, n.id));
    if (aliveA.length === 0 || aliveB.length === 0) {
      endWar(db, war, aliveA.length === 0 ? "side_b" : "side_a");
      continue;
    }
    const n = Math.min(maxEngagementsPerWar, Math.min(aliveA.length, aliveB.length));
    for (let i = 0; i < n; i++) {
      const attacker = aliveA[Math.floor(Math.random() * aliveA.length)];
      const defender = aliveB[Math.floor(Math.random() * aliveB.length)];
      // Both directions of the engagement record so each fighter's flows
      // grow against the other.
      runEngagement(db, war, attacker, defender);
      runEngagement(db, war, defender, attacker);
      totalEngagements += 2;
    }
    // Periodic evolution per fighter — every ~12th tick a random NPC
    // re-evolves so combo tiers grow naturally over the war.
    if (Math.random() < 0.18) {
      const sample = [...aliveA, ...aliveB][Math.floor(Math.random() * (aliveA.length + aliveB.length))];
      if (sample) try { evolveFighterCombos(db, sample.id, "npc"); } catch { /* ok */ }
    }
    war.lastTickAt = Date.now();
    // Realtime so any player nearby can see the casualty / kill counter live
    if (realtimeEmit) {
      const tally = db.prepare(
        `SELECT side_a_wins, side_b_wins FROM faction_wars WHERE id = ?`
      ).get(war.warId);
      try {
        realtimeEmit("faction-war:tick", {
          warId: war.warId,
          sideA: war.sideA,
          sideB: war.sideB,
          tally,
          aliveA: aliveA.length,
          aliveB: aliveB.length,
        });
      } catch { /* best-effort */ }
    }
  }
  return { ok: true, engagements: totalEngagements };
}

function runEngagement(db, war, attacker, defender) {
  const heavy = Math.random() < 0.35;
  const action = heavy ? "attack-heavy" : "attack-light";
  const damage = heavy ? 14 + Math.random() * 6 : 7 + Math.random() * 5;
  const hit = Math.random() < 0.7; // 70% baseline hit rate
  const chainId = `war:${war.warId}:${attacker.id}:${Date.now()}`;
  recordCombatFlow(db, {
    fighterId: attacker.id, fighterKind: "npc",
    context: war.context, style: attacker.style,
    action, actionMeta: { warId: war.warId, vs: defender.id },
    targetId: defender.id, hit, damage: hit ? damage : 0,
    chainId, stepIndex: 0,
  });
  // Defender block / dodge attempt
  if (hit && Math.random() < 0.3) {
    recordCombatFlow(db, {
      fighterId: defender.id, fighterKind: "npc",
      context: war.context, style: defender.style,
      action: Math.random() < 0.5 ? "block" : "dodge",
      actionMeta: { warId: war.warId, vsAttacker: attacker.id },
      targetId: attacker.id, hit: false, damage: 0,
    });
  }
  if (hit) applyNpcDamage(db, war, defender, damage);
}

function isAlive(db, npcId) {
  const r = db.prepare(`SELECT alive FROM faction_war_npcs WHERE id = ?`).get(npcId);
  return r?.alive === 1;
}

function applyNpcDamage(db, war, npc, dmg) {
  const r = db.prepare(`SELECT health FROM faction_war_npcs WHERE id = ?`).get(npc.id);
  if (!r) return;
  const newHp = Math.max(0, r.health - dmg);
  if (newHp <= 0) {
    db.prepare(`UPDATE faction_war_npcs SET health = 0, alive = 0 WHERE id = ?`).run(npc.id);
    // Increment the *opposing* side's win counter
    const side = npc.id.includes(":a:") ? "a" : "b";
    const winnerCol = side === "a" ? "side_b_wins" : "side_a_wins";
    db.prepare(`UPDATE faction_wars SET ${winnerCol} = ${winnerCol} + 1 WHERE id = ?`).run(war.warId);
    try {
      const realtimeEmit = globalThis.realtimeEmit;
      realtimeEmit?.("faction-war:kill", { warId: war.warId, npcId: npc.id, faction: side === "a" ? war.sideA : war.sideB });
    } catch { /* best-effort */ }
  } else {
    db.prepare(`UPDATE faction_war_npcs SET health = ? WHERE id = ?`).run(newHp, npc.id);
  }
}

function endWar(db, war, victoriousSide) {
  db.prepare(`
    UPDATE faction_wars
    SET status = 'ended', ended_at = unixepoch()
    WHERE id = ?
  `).run(war.warId);
  _wars.delete(war.warId);
  try {
    const realtimeEmit = globalThis.realtimeEmit;
    realtimeEmit?.("faction-war:end", {
      warId: war.warId,
      victor: victoriousSide === "side_a" ? war.sideA : war.sideB,
    });
  } catch { /* best-effort */ }
}

// ── Read ─────────────────────────────────────────────────────────────────────

export function listActiveWars(db) {
  ensureSchema(db);
  // TODO: project explicit columns (auto-fix suggestion)
  const rows = db.prepare(`SELECT * FROM faction_wars WHERE status = 'active'`).all();
  return rows.map((r) => {
    const npcs = db.prepare(
      `SELECT id, faction_id, style_seed, health, alive FROM faction_war_npcs WHERE war_id = ?`
    ).all(r.id);
    return { ...r, npcs };
  });
}

export const _internal = { FACTION_DEFAULT_STYLES };
