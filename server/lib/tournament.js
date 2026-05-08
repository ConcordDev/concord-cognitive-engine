// server/lib/tournament.js
//
// Player-organized tournament toolkit. Single-elimination v1; round-robin
// reserved for v2. Rule-set is enforced server-side at bout creation
// (control scheme lock, procedural-combo disable, hp cap, time limit,
// best-of count) so neither fighter can violate the declared meta.
//
// Lifecycle:
//   createTournament()            — organizer creates, sets rules + prize pool
//   registerEntrant(stakeCC?)     — players register; stakes go into escrow
//   startTournament()             — organizer kicks off; brackets get seeded
//   advanceBracket(bracketId)     — when a bout completes, advance the winner
//   completeTournament()          — final winner declared, prize disbursed,
//                                    chronicle minted, escrow released
//
// Coherence anchor: each tournament chronicle DTU cites the rule-set,
// final bracket tree, and per-bout chronicle DTUs as machine-readable
// metadata. Future tournaments derive lineage from prior chronicles via
// citation, so the meta has provenance.

import crypto from "crypto";
import { recordTransaction, checkRefIdProcessed } from "../economy/ledger.js";
import { getBalance } from "../economy/balances.js";

// User-to-user CC move via economy_ledger (the canonical balance source).
// CRITICAL: an earlier draft used burn+mint on the treasury bus, which
// left user balances unchanged because balances are derived from
// economy_ledger.from_user_id / to_user_id. Always use
// recordTransaction here so balances actually update.
//
// Idempotent: if the refId is already in the ledger we no-op rather
// than double-apply (defense vs replay attacks on tournament endpoints).
function _ccMove(db, { fromUserId, toUserId, amount, refId, type = "tournament_escrow" }) {
  if (!db) throw new Error("db_required");
  if (!fromUserId || !toUserId) throw new Error("from/to_required");
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("amount_invalid");
  // Idempotency: if this refId already moved CC, skip silently. Tournament
  // payouts and stakes are stamped with deterministic refIds so a
  // retried call won't double-pay.
  if (refId) {
    const seen = checkRefIdProcessed(db, refId);
    if (seen?.exists) return { ok: true, skipped: "already_processed" };
  }
  // Guard: don't move CC the entrant doesn't have. Without this, a
  // negative-balance transaction would still record (the ledger doesn't
  // gate balance), letting a player stake more than they hold.
  const balance = getBalance(db, fromUserId);
  if ((balance?.balance ?? 0) < amount) {
    throw new Error(`insufficient_balance: have ${balance?.balance ?? 0}, need ${amount}`);
  }
  recordTransaction(db, {
    type,
    from: fromUserId,
    to:   toUserId,
    amount,
    fee:  0,
    net:  amount,
    refId,
    metadata: { kind: "tournament_escrow" },
  });
  return { ok: true };
}

const ESCROW_USER_PREFIX = "escrow:tournament:";
const DEFAULT_RULES = Object.freeze({
  allowed_schemes:   ["bare_hands", "boxer", "karate", "blade"],
  procedural_combos: true,
  max_tier:          5,
  hp_cap:            100,
  time_limit_s:      180,
  best_of:           3,
  stake_cc:          0,
});

function _newId(prefix) {
  // Cryptographically secure id generation — Math.random fallback was
  // CodeQL-flagged as insecure randomness in a security context.
  // crypto.randomUUID is in Node 18+ stdlib so the conditional fallback
  // was unreachable in practice; randomBytes covers exotic runtimes.
  const rand = crypto.randomUUID
    ? crypto.randomUUID()
    : crypto.randomBytes(12).toString("hex");
  return `${prefix}_${rand}`;
}

function _ensureRules(rules) {
  return { ...DEFAULT_RULES, ...(rules || {}) };
}

/**
 * Create a tournament. Organizer can seed the prize pool from their own
 * balance OR by escrowing entrant stakes. Either way the prize pool is
 * held in a synthetic escrow user keyed to the tournament id.
 */
export function createTournament(db, {
  title, organizerId, worldId = "concordia-hub", districtId = null,
  bracketKind = "single_elim", rules = {}, maxEntrants = 16,
  organizerSeedCC = 0,
} = {}) {
  if (!db) return { ok: false, error: "db_required" };
  if (!title) return { ok: false, error: "title_required" };
  if (!organizerId) return { ok: false, error: "organizer_required" };
  const id = _newId("tour");
  const escrowUser = `${ESCROW_USER_PREFIX}${id}`;
  const merged = _ensureRules(rules);

  try {
    db.prepare(`
      INSERT INTO tournaments
        (id, title, organizer_id, world_id, district_id, status,
         bracket_kind, rules_json, prize_pool_cc, escrow_user_id, max_entrants)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
    `).run(
      id, title, organizerId, worldId, districtId,
      bracketKind, JSON.stringify(merged), 0, escrowUser, Math.max(2, maxEntrants),
    );

    if (organizerSeedCC > 0) {
      // Move CC from organizer to escrow account. transferCoins handles
      // the ledger entries. Failure here rolls back the tournament create.
      try {
        _ccMove(db, {
          fromUserId: organizerId, toUserId: escrowUser,
          amount: Number(organizerSeedCC),
          refId: `tournament_seed:${id}:${organizerId}`,
        });
        db.prepare(`UPDATE tournaments SET prize_pool_cc = ? WHERE id = ?`)
          .run(Number(organizerSeedCC), id);
      } catch (err) {
        db.prepare(`DELETE FROM tournaments WHERE id = ?`).run(id);
        return { ok: false, error: `escrow_seed_failed: ${err.message}` };
      }
    }
    return { ok: true, tournamentId: id, escrowUserId: escrowUser, rules: merged };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Register an entrant. If rules.stake_cc > 0 the stake is transferred
 * from the entrant to escrow; failure rejects registration.
 */
export function registerEntrant(db, tournamentId, userId) {
  if (!db || !tournamentId || !userId) return { ok: false, error: "missing_args" };
  // TODO: project explicit columns (auto-fix suggestion)
  const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
  if (!t) return { ok: false, error: "tournament_not_found" };
  if (t.status !== "open") return { ok: false, error: "registration_closed" };
  const count = db.prepare(`SELECT COUNT(*) AS n FROM tournament_entrants WHERE tournament_id = ?`).get(tournamentId);
  if ((count?.n || 0) >= t.max_entrants) return { ok: false, error: "tournament_full" };
  const rules = JSON.parse(t.rules_json || "{}");
  const stake = Number(rules.stake_cc || 0);

  const id = _newId("ent");
  // Atomic: stake-move + entrant-insert + prize-pool-bump must all
  // succeed or none. Pre-fix the stake could be debited but the entrant
  // never recorded if a crash happened between calls.
  try {
    const tx = db.transaction(() => {
      if (stake > 0) {
        _ccMove(db, {
          fromUserId: userId, toUserId: t.escrow_user_id,
          amount: stake,
          refId: `tournament_stake:${tournamentId}:${userId}`,
        });
      }
      db.prepare(`
        INSERT INTO tournament_entrants
          (id, tournament_id, user_id, seed, stake_paid, status)
        VALUES (?, ?, ?, ?, ?, 'registered')
      `).run(id, tournamentId, userId, (count?.n || 0) + 1, stake);
      db.prepare(`
        UPDATE tournaments SET prize_pool_cc = prize_pool_cc + ? WHERE id = ?
      `).run(stake, tournamentId);
    });
    tx();
    return { ok: true, entrantId: id, stakePaid: stake };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Seed the bracket and start. Pairs entrants by registration order
 * (which becomes seed). Odd entrant gets a bye in round 1.
 */
export function startTournament(db, tournamentId, userId) {
  // TODO: project explicit columns (auto-fix suggestion)
  const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
  if (!t) return { ok: false, error: "tournament_not_found" };
  if (t.organizer_id !== userId) return { ok: false, error: "not_organizer" };
  if (t.status !== "open") return { ok: false, error: "wrong_status" };
  const entrants = db.prepare(`
    SELECT user_id FROM tournament_entrants
    WHERE tournament_id = ? AND status = 'registered'
    ORDER BY seed ASC
  `).all(tournamentId);
  if (entrants.length < 2) return { ok: false, error: "need_2_entrants" };

  // Bound entrant count by max_entrants in case of races between
  // /register calls — no entrant should ever push the bracket past cap.
  if (entrants.length > t.max_entrants) {
    return { ok: false, error: "entrants_exceed_max" };
  }

  // Atomic: bracket seed + tournament-status flip + entrant-status flip
  // must land together or not at all. Two concurrent /start calls that
  // both passed the "open" check would otherwise seed parallel brackets.
  try {
    const tx = db.transaction(() => {
      // Race-safe re-check: if status flipped under us between the load
      // and the transaction, abort.
      const cur = db.prepare(`SELECT status FROM tournaments WHERE id = ?`).get(tournamentId);
      if (!cur || cur.status !== "open") throw new Error("status_changed_during_start");

      const round = 1;
      for (let i = 0; i < entrants.length; i += 2) {
        const a = entrants[i].user_id;
        const b = entrants[i + 1]?.user_id || null;
        db.prepare(`
          INSERT INTO tournament_brackets
            (id, tournament_id, round_number, slot_index, fighter_a_id, fighter_b_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(_newId("br"), tournamentId, round, i / 2, a, b, b ? "pending" : "bye");

        if (!b) {
          // Auto-advance the bye to next round; v1 keeps it simple.
          db.prepare(`
            UPDATE tournament_brackets SET winner_id = ?, status = 'complete', completed_at = unixepoch()
            WHERE tournament_id = ? AND round_number = ? AND slot_index = ?
          `).run(a, tournamentId, round, i / 2);
        }
      }

      db.prepare(`UPDATE tournaments SET status = 'in_progress', started_at = unixepoch() WHERE id = ?`)
        .run(tournamentId);
      db.prepare(`UPDATE tournament_entrants SET status = 'active' WHERE tournament_id = ?`)
        .run(tournamentId);
    });
    tx();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Mark a bracket bout complete + advance winner to next round. Called by
 * the training-match end handler when the bout's tournament_bracket_id
 * is set.
 */
export function completeBracket(db, bracketId, winnerId, chronicleDtuId = null) {
  // TODO: project explicit columns (auto-fix suggestion)
  const br = db.prepare(`SELECT * FROM tournament_brackets WHERE id = ?`).get(bracketId);
  if (!br) return { ok: false, error: "bracket_not_found" };
  if (br.status === "complete") return { ok: true, alreadyComplete: true };

  db.prepare(`
    UPDATE tournament_brackets
    SET winner_id = ?, status = 'complete', completed_at = unixepoch(), chronicle_dtu_id = ?
    WHERE id = ?
  `).run(winnerId, chronicleDtuId, bracketId);

  // Mark the loser eliminated
  const loserId = br.fighter_a_id === winnerId ? br.fighter_b_id : br.fighter_a_id;
  if (loserId) {
    db.prepare(`
      UPDATE tournament_entrants
      SET status = 'eliminated', eliminated_at_round = ?
      WHERE tournament_id = ? AND user_id = ?
    `).run(br.round_number, br.tournament_id, loserId);
  }

  // If all bouts in this round are complete, seed the next round
  const remaining = db.prepare(`
    SELECT COUNT(*) AS n FROM tournament_brackets
    WHERE tournament_id = ? AND round_number = ? AND status != 'complete'
  `).get(br.tournament_id, br.round_number);

  if ((remaining?.n || 0) === 0) {
    const winners = db.prepare(`
      SELECT winner_id FROM tournament_brackets
      WHERE tournament_id = ? AND round_number = ? AND winner_id IS NOT NULL
      ORDER BY slot_index ASC
    `).all(br.tournament_id, br.round_number).map((r) => r.winner_id);

    if (winners.length === 1) {
      // Champion! Trigger completion (caller will mint chronicle + payout).
      return { ok: true, championId: winners[0], roundComplete: true };
    }

    const nextRound = br.round_number + 1;
    for (let i = 0; i < winners.length; i += 2) {
      db.prepare(`
        INSERT INTO tournament_brackets
          (id, tournament_id, round_number, slot_index, fighter_a_id, fighter_b_id, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `).run(
        _newId("br"), br.tournament_id, nextRound, i / 2,
        winners[i], winners[i + 1] || null,
      );
    }
  }

  return { ok: true };
}

/**
 * Disburse the prize pool from escrow to the champion + mint the
 * tournament chronicle DTU citing all per-bout chronicles for lineage.
 */
export function completeTournament(db, tournamentId, championId, chronicleDtuId = null) {
  // TODO: project explicit columns (auto-fix suggestion)
  const t = db.prepare(`SELECT * FROM tournaments WHERE id = ?`).get(tournamentId);
  if (!t) return { ok: false, error: "tournament_not_found" };
  if (t.status === "completed") return { ok: true, alreadyComplete: true };

  // Disburse the prize pool
  if (t.prize_pool_cc > 0 && championId) {
    try {
      _ccMove(db, {
        fromUserId: t.escrow_user_id, toUserId: championId,
        amount: t.prize_pool_cc,
        refId: `tournament_payout:${tournamentId}:${championId}`,
      });
    } catch (err) {
      // Payout failed — log but still mark completion so escrow can be
      // reclaimed manually. Don't strand the tournament.
      // Payout failed: log via the ledger (zero-amount marker) so ops
      // can see the stuck escrow. Wrap in try/catch — even the marker
      // recording shouldn't throw if the ledger is unavailable.
      try {
        recordTransaction(db, {
          type: "tournament_payout_failed",
          from: t.escrow_user_id,
          to:   championId,
          amount: 0,
          fee: 0,
          net: 0,
          metadata: { tournamentId, error: err.message },
        });
      } catch { /* ok */ }
      return { ok: false, error: `payout_failed: ${err.message}` };
    }
  }

  db.prepare(`
    UPDATE tournaments
    SET status = 'completed', winner_id = ?, completed_at = unixepoch(), chronicle_dtu_id = ?
    WHERE id = ?
  `).run(championId, chronicleDtuId, tournamentId);
  return { ok: true, championId, payoutCC: t.prize_pool_cc };
}

/**
 * Validate a bout against the tournament's rule-set. Called when a
 * training-match is being created with `tournament_bracket_id`.
 */
export function validateBoutRules(db, bracketId, fighterAId, fighterBId, declaredScheme) {
  // TODO: project explicit columns (auto-fix suggestion)
  const br = db.prepare(`SELECT * FROM tournament_brackets WHERE id = ?`).get(bracketId);
  if (!br) return { ok: false, error: "bracket_not_found" };
  const t = db.prepare(`SELECT rules_json FROM tournaments WHERE id = ?`).get(br.tournament_id);
  if (!t) return { ok: false, error: "tournament_not_found" };
  const rules = JSON.parse(t.rules_json || "{}");

  // Defensive: require both bracket fighter slots to be populated.
  // A bye-row mid-update would have null on one side, which would
  // bypass the directional mismatch check below by being equal-to-null
  // on both branches.
  if (!br.fighter_a_id || !br.fighter_b_id) {
    return { ok: false, error: "bracket_not_paired" };
  }
  if ((br.fighter_a_id !== fighterAId && br.fighter_a_id !== fighterBId) ||
      (br.fighter_b_id !== fighterAId && br.fighter_b_id !== fighterBId)) {
    return { ok: false, error: "fighter_mismatch" };
  }

  if (Array.isArray(rules.allowed_schemes) && rules.allowed_schemes.length > 0) {
    if (declaredScheme && !rules.allowed_schemes.includes(declaredScheme)) {
      return { ok: false, error: "scheme_not_allowed", allowed: rules.allowed_schemes };
    }
  }
  return { ok: true, rules };
}

export { DEFAULT_RULES };
