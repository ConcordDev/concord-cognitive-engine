// server/lib/mahjong/session.js
//
// Phase E4 — orchestrator for a mahjong session.
//
// Player + 3 NPCs at a single table. Turn order: 0 (player, east, dealer)
// → 1 (south) → 2 (west) → 3 (north) → back to 0.
//
// Simplifications for v1:
//  - No calls (chi/pon/kan) — strict draw/discard rounds
//  - No riichi declaration
//  - No ron on discard (only tsumo on draw)
//  - Player wins only by tsumo
//  - NPCs check for tsumo each draw (if their drawn tile completes a hand)

import crypto from "node:crypto";
import { newWall, dealInitialHands, drawNext, SEAT_COUNT, HAND_SIZE, SEAT_WINDS } from "./wall.js";
import { isWinningHand, sortTiles } from "./hand.js";
import { discardByStyle, NPC_STYLES } from "./npc-discard.js";

const PLAYER_SEAT = 0;

/**
 * Start a new session. `opts`:
 *   - worldId (required)
 *   - playerUserId (required) — seated at index 0
 *   - npcIds (optional, 3 strings) — defaults to npc_safe_a/b/c
 *   - seed (optional) — defaults to a fresh random
 */
export function startSession(db, opts = {}) {
  if (!db) return { ok: false, error: "missing_db" };
  if (!opts.worldId || !opts.playerUserId) return { ok: false, error: "missing_inputs" };

  const seed = opts.seed != null ? Number(opts.seed) : (crypto.randomBytes(4).readUInt32LE(0));
  const wallState = newWall(seed);
  const dealt = dealInitialHands(wallState.wall);

  const id = `mj_${crypto.randomBytes(6).toString("hex")}`;
  const npcIds = opts.npcIds && opts.npcIds.length === 3
    ? opts.npcIds
    : ["npc_safe_a", "npc_tempai_b", "npc_yakuhunt_c"];
  const npcStyles = opts.npcStyles && opts.npcStyles.length === 3
    ? opts.npcStyles
    : ["safe", "tempai", "yakuhunt"];

  try {
    db.prepare(`
      INSERT INTO mahjong_sessions
        (id, world_id, dealer_seat, round_wind, dora_indicator, wall_remaining, turn_seat, seed)
      VALUES (?, ?, 0, 'east', ?, ?, 0, ?)
    `).run(id, opts.worldId, wallState.doraIndicator, wallState.wall.length - dealt.drawIdx, seed);

    // Seat 0 = player (east, dealer).
    db.prepare(`
      INSERT INTO mahjong_seats
        (session_id, seat_index, entity_kind, entity_id, seat_wind, hand_json, melded_json, discards_json, style)
      VALUES (?, 0, 'player', ?, 'east', ?, '[]', '[]', NULL)
    `).run(id, opts.playerUserId, JSON.stringify(sortTiles(dealt.hands[0])));

    for (let i = 1; i < SEAT_COUNT; i++) {
      const style = NPC_STYLES.includes(npcStyles[i - 1]) ? npcStyles[i - 1] : "tempai";
      db.prepare(`
        INSERT INTO mahjong_seats
          (session_id, seat_index, entity_kind, entity_id, seat_wind, hand_json, melded_json, discards_json, style)
        VALUES (?, ?, 'npc', ?, ?, ?, '[]', '[]', ?)
      `).run(id, i, npcIds[i - 1], SEAT_WINDS[i], JSON.stringify(sortTiles(dealt.hands[i])), style);
    }

    // Dealer draws their starting 14th tile immediately so the first
    // turn (theirs) can begin with a discard.
    const firstDraw = drawNext(wallState.wall, dealt.drawIdx);
    if (firstDraw.tile) {
      const playerHand = sortTiles([...dealt.hands[0], firstDraw.tile]);
      db.prepare(`UPDATE mahjong_seats SET hand_json = ? WHERE session_id = ? AND seat_index = 0`)
        .run(JSON.stringify(playerHand), id);
      db.prepare(`UPDATE mahjong_sessions SET wall_remaining = ? WHERE id = ?`)
        .run(wallState.wall.length - firstDraw.drawIdx, id);
      _log(db, id, 0, "draw", { tile: firstDraw.tile });
      // Auto-tsumo check on initial draw.
      if (isWinningHand(playerHand)) {
        // Don't auto-declare — leave to player. But flag it.
      }
    }

    return { ok: true, sessionId: id, seed };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Player discards a tile. The session then auto-runs NPC turns until
 * the next player turn (or until someone wins / wall exhausts).
 * Returns the final state.
 */
export function discardTile(db, sessionId, tile) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  try {
    const sess = db.prepare(`SELECT * FROM mahjong_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };
    if (sess.ended_at) return { ok: false, error: "session_ended" };
    if (sess.turn_seat !== PLAYER_SEAT) return { ok: false, error: "not_player_turn" };

    const playerSeat = db.prepare(`SELECT * FROM mahjong_seats WHERE session_id = ? AND seat_index = 0`).get(sessionId);
    const hand = JSON.parse(playerSeat.hand_json);
    if (hand.length !== HAND_SIZE + 1) return { ok: false, error: "must_draw_first" };
    const idx = hand.indexOf(tile);
    if (idx < 0) return { ok: false, error: "tile_not_in_hand" };

    // Discard.
    const newHand = sortTiles(hand.filter((_, i) => i !== idx));
    const discards = JSON.parse(playerSeat.discards_json);
    discards.push(tile);
    db.prepare(`
      UPDATE mahjong_seats SET hand_json = ?, discards_json = ?
      WHERE session_id = ? AND seat_index = 0
    `).run(JSON.stringify(newHand), JSON.stringify(discards), sessionId);
    _log(db, sessionId, 0, "discard", { tile });

    // Advance turn through NPCs back to the player.
    return _autoRunNpcs(db, sessionId);
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Player declares tsumo (a winning self-drawn hand). Validates the
 * 14-tile hand IS a winning shape.
 */
export function declareTsumo(db, sessionId) {
  if (!db || !sessionId) return { ok: false, error: "missing_inputs" };
  try {
    const sess = db.prepare(`SELECT * FROM mahjong_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };
    if (sess.ended_at) return { ok: false, error: "session_ended" };
    if (sess.turn_seat !== PLAYER_SEAT) return { ok: false, error: "not_player_turn" };

    const seat = db.prepare(`SELECT * FROM mahjong_seats WHERE session_id = ? AND seat_index = 0`).get(sessionId);
    const hand = JSON.parse(seat.hand_json);
    if (hand.length !== 14) return { ok: false, error: "wrong_hand_size" };
    if (!isWinningHand(hand)) return { ok: false, error: "not_a_winning_hand" };

    // End session, mark winner.
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`UPDATE mahjong_sessions SET ended_at = ?, end_reason = 'tsumo', winner_seat = 0 WHERE id = ?`)
      .run(now, sessionId);
    db.prepare(`UPDATE mahjong_seats SET tsumo_at = ? WHERE session_id = ? AND seat_index = 0`)
      .run(now, sessionId);
    _log(db, sessionId, 0, "tsumo", { hand });

    return { ok: true, winnerSeat: 0, hand, roundWind: sess.round_wind };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

/** Read the full session state for the UI. */
export function getState(db, sessionId) {
  if (!db || !sessionId) return null;
  try {
    const sess = db.prepare(`SELECT * FROM mahjong_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return null;
    const seats = db.prepare(`SELECT * FROM mahjong_seats WHERE session_id = ? ORDER BY seat_index ASC`).all(sessionId);
    return {
      ...sess,
      seats: seats.map((s) => ({
        seat_index: s.seat_index,
        entity_kind: s.entity_kind,
        entity_id: s.entity_id,
        seat_wind: s.seat_wind,
        hand_json: s.hand_json,
        melded_json: s.melded_json,
        discards_json: s.discards_json,
        style: s.style,
        tsumo_at: s.tsumo_at,
      })),
    };
  } catch { return null; }
}

/** Internal — run NPC turns until the next player turn or end. */
function _autoRunNpcs(db, sessionId) {
  try {
    const sess = db.prepare(`SELECT * FROM mahjong_sessions WHERE id = ?`).get(sessionId);
    if (!sess) return { ok: false, error: "no_session" };

    let turnSeat = (sess.turn_seat + 1) % SEAT_COUNT;
    let wallRem = sess.wall_remaining;
    const seed = sess.seed;
    let allowance = SEAT_COUNT; // safety bound

    // Hoisted constant-SQL statements reused across the bounded NPC-turn loop.
    const selSeat = db.prepare(`SELECT * FROM mahjong_seats WHERE session_id = ? AND seat_index = ?`);
    const selDrawCount = db.prepare(`SELECT COUNT(*) AS n FROM mahjong_actions_log WHERE session_id = ? AND action_kind = 'draw'`);
    const endExhausted = db.prepare(`UPDATE mahjong_sessions SET ended_at = ?, end_reason = 'exhausted', wall_remaining = 0 WHERE id = ?`);
    const setSeatHand = db.prepare(`UPDATE mahjong_seats SET hand_json = ? WHERE session_id = ? AND seat_index = ?`);
    const setWallRem = db.prepare(`UPDATE mahjong_sessions SET wall_remaining = ? WHERE id = ?`);
    const endTsumo = db.prepare(`UPDATE mahjong_sessions SET ended_at = ?, end_reason = 'tsumo', winner_seat = ? WHERE id = ?`);
    const setSeatTsumo = db.prepare(`UPDATE mahjong_seats SET tsumo_at = ? WHERE session_id = ? AND seat_index = ?`);
    const selAllDiscards = db.prepare(`SELECT discards_json FROM mahjong_seats WHERE session_id = ?`);
    const setSeatHandDiscards = db.prepare(`
        UPDATE mahjong_seats SET hand_json = ?, discards_json = ?
        WHERE session_id = ? AND seat_index = ?
      `);

    while (turnSeat !== PLAYER_SEAT && allowance > 0 && wallRem > 0) {
      allowance--;
      const seat = selSeat.get(sessionId, turnSeat);

      // Reconstruct wall position. Simplification: we re-derive the
      // wall draw position from the actions log (count of all "draw"
      // entries). drawIdx grows monotonically.
      const drawCount = selDrawCount.get(sessionId).n;
      const wallState = newWall(seed);
      const dealt = dealInitialHands(wallState.wall);
      const nextDrawIdx = dealt.drawIdx + drawCount - 1; // -1 because dealer's first draw is already counted in initial deal
      // Actually we increment cleanly: dealt.drawIdx after dealing initials = 52,
      // then dealer's first draw consumed 1 more (drawCount=1), so nextDrawIdx = 52.
      // Each subsequent draw increments drawCount by 1. So:
      const trueDrawIdx = dealt.drawIdx + drawCount; // first draw is at dealt.drawIdx (after initial deal)
      // We use trueDrawIdx for "the next tile to draw".
      const draw = drawNext(wallState.wall, trueDrawIdx);
      if (!draw.tile) {
        // Wall exhausted.
        endExhausted.run(Math.floor(Date.now() / 1000), sessionId);
        _log(db, sessionId, turnSeat, "wall_exhausted", {});
        return { ok: true, ended: true, endReason: "exhausted" };
      }

      // NPC draws.
      const hand = JSON.parse(seat.hand_json);
      const newHand = sortTiles([...hand, draw.tile]);
      setSeatHand.run(JSON.stringify(newHand), sessionId, turnSeat);
      wallRem = wallState.wall.length - draw.drawIdx;
      setWallRem.run(wallRem, sessionId);
      _log(db, sessionId, turnSeat, "draw", { tile: draw.tile });

      // NPC tsumo check.
      if (isWinningHand(newHand)) {
        const now = Math.floor(Date.now() / 1000);
        endTsumo.run(now, turnSeat, sessionId);
        setSeatTsumo.run(now, sessionId, turnSeat);
        _log(db, sessionId, turnSeat, "tsumo", { hand: newHand });
        return { ok: true, ended: true, endReason: "tsumo", winnerSeat: turnSeat };
      }

      // NPC discard.
      const allDiscardsArr = selAllDiscards.all(sessionId)
        .map((r) => JSON.parse(r.discards_json));
      const discardIdx = discardByStyle(seat.style || "tempai", newHand, { allDiscards: allDiscardsArr });
      const discardTile = newHand[discardIdx];
      const remainingHand = sortTiles(newHand.filter((_, i) => i !== discardIdx));
      const discards = JSON.parse(seat.discards_json);
      discards.push(discardTile);
      setSeatHandDiscards.run(JSON.stringify(remainingHand), JSON.stringify(discards), sessionId, turnSeat);
      _log(db, sessionId, turnSeat, "discard", { tile: discardTile });

      turnSeat = (turnSeat + 1) % SEAT_COUNT;
    }

    // Player's turn next: draw a tile.
    if (turnSeat === PLAYER_SEAT && wallRem > 0) {
      const drawCount = db.prepare(`SELECT COUNT(*) AS n FROM mahjong_actions_log WHERE session_id = ? AND action_kind = 'draw'`).get(sessionId).n;
      const wallState = newWall(seed);
      const dealt = dealInitialHands(wallState.wall);
      const trueDrawIdx = dealt.drawIdx + drawCount;
      const draw = drawNext(wallState.wall, trueDrawIdx);
      if (!draw.tile) {
        db.prepare(`UPDATE mahjong_sessions SET ended_at = ?, end_reason = 'exhausted', wall_remaining = 0 WHERE id = ?`)
          .run(Math.floor(Date.now() / 1000), sessionId);
        return { ok: true, ended: true, endReason: "exhausted" };
      }
      const playerSeat = db.prepare(`SELECT hand_json FROM mahjong_seats WHERE session_id = ? AND seat_index = 0`).get(sessionId);
      const playerHand = sortTiles([...JSON.parse(playerSeat.hand_json), draw.tile]);
      db.prepare(`UPDATE mahjong_seats SET hand_json = ? WHERE session_id = ? AND seat_index = 0`)
        .run(JSON.stringify(playerHand), sessionId);
      wallRem = wallState.wall.length - draw.drawIdx;
      db.prepare(`UPDATE mahjong_sessions SET wall_remaining = ?, turn_seat = 0 WHERE id = ?`).run(wallRem, sessionId);
      _log(db, sessionId, 0, "draw", { tile: draw.tile });
    } else {
      db.prepare(`UPDATE mahjong_sessions SET turn_seat = ? WHERE id = ?`).run(turnSeat, sessionId);
    }

    return { ok: true, ended: false, turnSeat: PLAYER_SEAT, wallRemaining: wallRem };
  } catch (err) {
    return { ok: false, error: err?.message };
  }
}

function _log(db, sessionId, seatIdx, kind, payload) {
  try {
    db.prepare(`
      INSERT INTO mahjong_actions_log (session_id, seat_index, action_kind, payload_json)
      VALUES (?, ?, ?, ?)
    `).run(sessionId, seatIdx, kind, JSON.stringify(payload || {}));
  } catch { /* best-effort */ }
}

export const PLAYER_SEAT_INDEX = PLAYER_SEAT;
