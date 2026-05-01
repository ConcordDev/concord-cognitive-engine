// server/lib/world-governance.js
// Emergents issue directives; NPCs vote on them. Democracy with consequences.

import crypto from 'node:crypto';

// ── Loyalty scores by NPC archetype ──────────────────────────────────────────

export const LOYALTY_BY_ARCHETYPE = {
  guard:      0.9,
  soldier:    0.85,
  henchman:   0.8,
  farmer:     0.5,
  merchant:   0.4,
  bard:       0.3,
  bandit:     0.2,
  goblin:     0.2,
  scientist:  0.6,
  journalist: 0.35,
  default:    0.5,
};

// Words in a directive text that signal violence/aggression
const AGGRESSIVE_WORDS = ['attack', 'raid', 'destroy', 'assault', 'kill', 'burn', 'pillage'];

// Archetypes that resist aggressive directives
const PEACEFUL_ARCHETYPES = new Set(['farmer', 'merchant', 'bard']);

// ── Directive creation ────────────────────────────────────────────────────────

/**
 * Issue a new directive into a world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string}  issuerId     player_id / emergent_id / npc_id
 * @param {string}  issuerType   'emergent'|'player'|'npc'
 * @param {string}  worldId
 * @param {string}  directive    the directive text
 * @param {object}  [opts]
 * @param {string}  [opts.directive_type='order']
 * @param {string}  [opts.faction]
 * @param {number}  [opts.expires_hours=24]
 * @returns {object} directive row
 */
export function issueDirective(db, issuerId, issuerType, worldId, directive, opts = {}) {
  const {
    directive_type = 'order',
    faction        = null,
    expires_hours  = 24,
  } = opts;

  const id        = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + expires_hours * 3600;

  db.prepare(`
    INSERT INTO world_directives
      (id, world_id, issuer_id, issuer_type, directive, directive_type, faction, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, worldId, issuerId, issuerType, directive, directive_type, faction, expiresAt);

  return db.prepare('SELECT * FROM world_directives WHERE id = ?').get(id);
}

// ── Voting ────────────────────────────────────────────────────────────────────

/**
 * Record a vote on a directive and update vote tallies.
 * Uses INSERT OR IGNORE to prevent double-voting.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string}  directiveId
 * @param {string}  voterId
 * @param {string}  voterType   'npc'|'player'
 * @param {'for'|'against'|'abstain'} vote
 * @param {string|null} [reason]
 * @returns {{ voted: boolean, directiveStatus: string }}
 */
export function voteOnDirective(db, directiveId, voterId, voterType, vote, reason = null) {
  const voteId = crypto.randomUUID();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO directive_votes (id, directive_id, voter_id, voter_type, vote, reason)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const result = insert.run(voteId, directiveId, voterId, voterType, vote, reason);
  const voted  = result.changes > 0;

  if (!voted) {
    // Already voted — return current status
    const dir = db.prepare('SELECT status FROM world_directives WHERE id = ?').get(directiveId);
    return { voted: false, directiveStatus: dir?.status ?? 'unknown' };
  }

  // Update vote tally on the directive
  if (vote === 'for') {
    db.prepare('UPDATE world_directives SET votes_for = votes_for + 1 WHERE id = ?').run(directiveId);
  } else if (vote === 'against') {
    db.prepare('UPDATE world_directives SET votes_against = votes_against + 1 WHERE id = ?').run(directiveId);
  } else {
    db.prepare('UPDATE world_directives SET votes_abstain = votes_abstain + 1 WHERE id = ?').run(directiveId);
  }

  // Re-read updated directive to check rejection threshold
  const dir = db.prepare('SELECT * FROM world_directives WHERE id = ?').get(directiveId);
  if (!dir || dir.status !== 'active') {
    return { voted, directiveStatus: dir?.status ?? 'resolved' };
  }

  const totalVoted = (dir.votes_for ?? 0) + (dir.votes_against ?? 0);
  const meetsQuorum = totalVoted >= (dir.quorum_required ?? 3);
  const rejectionRatio = totalVoted > 0 ? (dir.votes_against ?? 0) / totalVoted : 0;

  if (meetsQuorum && rejectionRatio >= (dir.rejection_threshold ?? 0.3)) {
    db.prepare(`
      UPDATE world_directives SET status = 'rejected', resolved_at = unixepoch() WHERE id = ?
    `).run(directiveId);
    return { voted, directiveStatus: 'rejected' };
  }

  return { voted, directiveStatus: 'active' };
}

// ── NPC vote simulation ───────────────────────────────────────────────────────

/**
 * Simulate how an NPC would vote on a directive, based on personality.
 *
 * @param {object} npc        must have: archetype, grief_level (0–1, optional)
 * @param {object} directive  must have: directive (text), directive_type
 * @returns {'for'|'against'|'abstain'}
 */
export function simulateNPCVote(npc, directive) {
  let loyalty = LOYALTY_BY_ARCHETYPE[npc.archetype] ?? LOYALTY_BY_ARCHETYPE.default;

  // Grieving NPCs are less loyal
  const grief = Math.max(0, Math.min(1, npc.grief_level ?? 0));
  loyalty -= grief * 0.3;

  // Laws get more scrutiny
  if (directive.directive_type === 'law') {
    loyalty -= 0.1;
  }

  // Clamp loyalty to [0, 1]
  loyalty = Math.max(0, Math.min(1, loyalty));

  // Check for aggressive language bias for peaceful archetypes
  const directiveText = (directive.directive ?? '').toLowerCase();
  const isAggressive  = AGGRESSIVE_WORDS.some(w => directiveText.includes(w));
  if (isAggressive && PEACEFUL_ARCHETYPES.has(npc.archetype)) {
    // Strong bias against: these NPCs will almost certainly vote against
    loyalty = Math.min(loyalty, 0.1);
  }

  const roll = Math.random();
  if (roll < loyalty) return 'for';
  if (roll < loyalty + 0.3) return 'abstain';
  return 'against';
}

// ── Tick: simulate pending NPC votes ─────────────────────────────────────────

/**
 * Process pending directives for a world, simulating NPC votes.
 * Called by the world heartbeat tick.
 *
 * - Active directives created within the last hour get NPC votes.
 * - Directives past their expires_at are set to 'expired'.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @returns {{ processed: number, resolved: number }}
 */
export function tickDirectiveVoting(db, worldId) {
  const now     = Math.floor(Date.now() / 1000);
  const oneHour = 3600;

  let processed = 0;
  let resolved  = 0;

  // Expire overdue directives first
  const expiredResult = db.prepare(`
    UPDATE world_directives
    SET status = 'expired', resolved_at = unixepoch()
    WHERE world_id = ? AND status = 'active' AND expires_at IS NOT NULL AND expires_at < ?
  `).run(worldId, now);
  resolved += expiredResult.changes;

  // Get active directives created within the last hour (voting window)
  const directives = db.prepare(`
    SELECT * FROM world_directives
    WHERE world_id = ? AND status = 'active' AND created_at > ?
  `).all(worldId, now - oneHour);

  for (const dir of directives) {
    // Get faction NPCs if faction is set, otherwise all world NPCs
    const npcs = dir.faction
      ? db.prepare(
          'SELECT id, archetype, state FROM world_npcs WHERE world_id = ? AND faction = ? AND is_dead = 0 LIMIT 50'
        ).all(worldId, dir.faction)
      : db.prepare(
          'SELECT id, archetype, state FROM world_npcs WHERE world_id = ? AND is_dead = 0 LIMIT 50'
        ).all(worldId);

    for (const npc of npcs) {
      // Skip if this NPC already voted
      const alreadyVoted = db.prepare(
        'SELECT 1 FROM directive_votes WHERE directive_id = ? AND voter_id = ?'
      ).get(dir.id, npc.id);
      if (alreadyVoted) continue;

      // Parse NPC state for grief_level
      let state = {};
      try { state = JSON.parse(npc.state || '{}'); } catch { /* ignore */ }
      const npcWithGrief = { ...npc, grief_level: state.grief_level ?? 0 };

      const vote   = simulateNPCVote(npcWithGrief, dir);
      const result = voteOnDirective(db, dir.id, npc.id, 'npc', vote, null);
      processed++;

      if (result.directiveStatus === 'rejected') {
        resolved++;
        break; // Directive resolved; stop processing NPCs for it
      }
    }
  }

  return { processed, resolved };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Return active directives for a world with current vote counts.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @returns {object[]}
 */
export function getActiveDirectives(db, worldId) {
  return db.prepare(`
    SELECT * FROM world_directives
    WHERE world_id = ? AND status = 'active'
    ORDER BY created_at DESC
  `).all(worldId);
}

/**
 * Return resolved directives (approved/rejected/expired) for a world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldId
 * @param {number} [limit=20]
 * @returns {object[]}
 */
export function getDirectiveHistory(db, worldId, limit = 20) {
  return db.prepare(`
    SELECT * FROM world_directives
    WHERE world_id = ? AND status != 'active'
    ORDER BY resolved_at DESC
    LIMIT ?
  `).all(worldId, limit);
}
