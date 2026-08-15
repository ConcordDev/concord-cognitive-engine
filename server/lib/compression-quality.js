/**
 * Compression Quality Gate — MEGA/HYPER Tier Upgrade Validation
 *
 * Ensures that tier upgrades (regular→mega, mega→hyper) are UPGRADES, not
 * downgrades. Validates that the resulting mega/hyper DTU adds real value:
 *   - Sufficient body content (≥200 chars)
 *   - Citations to source DTUs (lineage)
 *   - Novel content not in any single parent
 *   - Rich semantic structure
 *   - Cross-references or semantic expansion
 */

import logger from '../logger.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

const MIN_SCORE = Number(process.env.CONCORD_COMPRESSION_MIN_SCORE) || 0.6;
const MIN_CITATIONS = Number(process.env.CONCORD_COMPRESSION_MIN_CITATIONS) || 1;
const MIN_BODY_LEN = Number(process.env.CONCORD_COMPRESSION_MIN_BODY_LEN) || 200;
const MAX_OVERLAP = Number(process.env.CONCORD_COMPRESSION_MAX_OVERLAP) || 0.8;
const QUALITY_ENABLED = process.env.CONCORD_COMPRESSION_QUALITY_ENABLED !== '0';

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Extract body text from multiple possible fields */
function getBodyText(dtu) {
  return (
    dtu.cretiHuman ||
    dtu.creti ||
    dtu.body ||
    dtu.content ||
    dtu.core?.definitions?.join(' ') ||
    ''
  );
}

/** Tokenize text into words for overlap calculation */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/** Calculate Jaccard similarity between two token sets */
function jaccardSimilarity(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setA = new Set(tokensA);
  const setB = new Set(tokensB);
  const intersection = [...setA].filter(t => setB.has(t)).length;
  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/** Check how much of mega is new compared to a parent */
function overlapWithParent(megaBody, parentBody) {
  if (!megaBody || !parentBody) return 0;
  const megaToks = tokenize(megaBody);
  const parentToks = tokenize(parentBody);
  return jaccardSimilarity(megaToks, parentToks);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Score a compression (tier upgrade) quality.
 * @param {object} args - { mega (target DTU), children (source DTUs), STATE }
 * @returns {{ pass: boolean, score: number, reasons: string[] }}
 */
export function scoreCompression(args = {}) {
  if (!QUALITY_ENABLED) return { pass: true, score: 1.0, reasons: ['quality_gate_disabled'] };

  const { mega, children, STATE } = args;
  if (!mega || !children || children.length === 0) {
    return { pass: false, score: 0, reasons: ['invalid_inputs'] };
  }

  // System bypass: creator or ownerId is "system"
  if (mega.creator === 'system' || mega.ownerId === 'system' || mega.creator_id === 'system') {
    return { pass: true, score: 1.0, reasons: ['system_bypass'] };
  }

  const reasons = [];
  let score = 0.8; // start optimistic, subtract for failures

  // Rule 1: Body content length
  const body = getBodyText(mega);
  if (!body || String(body).length < MIN_BODY_LEN) {
    reasons.push(`body_too_short: ${(body || '').length} < ${MIN_BODY_LEN}`);
    score -= 0.3;
  }

  // Rule 2: Has citations to parents (lineage)
  const citations = mega.lineage?.parents?.length || 0;
  if (citations < MIN_CITATIONS) {
    reasons.push(`missing_citations: ${citations} < ${MIN_CITATIONS}`);
    score -= 0.25;
  } else {
    score += 0.05; // bonus for having citations
  }

  // Rule 3: Novelty check — overlap with each parent should be < MAX_OVERLAP
  const megaBody = getBodyText(mega);
  let anyParentTooSimilar = false;
  for (const child of children) {
    const childBody = getBodyText(child);
    const overlap = overlapWithParent(megaBody, childBody);
    if (overlap >= MAX_OVERLAP) {
      anyParentTooSimilar = true;
      reasons.push(`too_similar_to_parent: ${(overlap * 100).toFixed(1)}% > ${(MAX_OVERLAP * 100).toFixed(1)}%`);
    }
  }
  if (anyParentTooSimilar) {
    score -= 0.2;
  } else {
    score += 0.1; // bonus for sufficient novelty
  }

  // Rule 4: Semantic structure richness
  const hasTitle = !!mega.title && mega.title.length > 10;
  const hasBody = !!megaBody && megaBody.length >= MIN_BODY_LEN;
  const hasTags = Array.isArray(mega.tags) && mega.tags.length >= 2;
  const hasDefinitions = Array.isArray(mega.core?.definitions) && mega.core.definitions.length > 0;
  const hasExamples = Array.isArray(mega.core?.examples) && mega.core.examples.length > 0;
  const hasInvariants = Array.isArray(mega.core?.invariants) && mega.core.invariants.length > 0;
  const hasMeta = mega.meta && Object.keys(mega.meta).length > 2;

  const structureItems = [hasTitle, hasBody, hasTags, hasDefinitions, hasExamples, hasInvariants, hasMeta].filter(Boolean).length;
  if (structureItems < 2) {
    reasons.push(`insufficient_structure: ${structureItems} < 2`);
    score -= 0.2;
  } else if (structureItems >= 4) {
    score += 0.1; // bonus for rich structure
  }

  // Rule 5: Cross-reference check — either cite external DTU or expand neighborhood
  const hasExternalCitations = citations > 1; // more than just parent cluster
  const expandsSemanticNeighborhood = hasMeta || (hasExamples && hasInvariants);
  if (!hasExternalCitations && !expandsSemanticNeighborhood) {
    reasons.push('no_external_references_or_expansion');
    score -= 0.15;
  } else {
    score += 0.05;
  }

  // Clamp score to [0, 1]
  score = Math.max(0, Math.min(1, score));

  const pass = score >= MIN_SCORE && citations >= MIN_CITATIONS && String(body).length >= MIN_BODY_LEN;

  if (!pass) {
    reasons.push(`final_score: ${score.toFixed(3)} < ${MIN_SCORE}`);
  }

  return { pass, score, reasons };
}

/**
 * Log a compression attempt (pass or fail) to compression_audit.
 * @param {object} args - { db, mega, children, passed, score, reasons? }
 * @returns {boolean}
 */
export function logCompressionAttempt(args = {}) {
  const { db, mega, children, passed, score, reasons } = args;
  if (!db || !mega || !children) return false;

  try {
    const stmt = db.prepare(`
      INSERT INTO compression_audit (ts, source_dtu_id, target_mega_id, score, pass, reasons_json, child_count, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'compression-quality')
    `);
    stmt.run(
      Date.now(),
      children.map(c => c.id).join(','),
      mega.id,
      Number(score || 0).toFixed(3),
      passed ? 1 : 0,
      JSON.stringify(reasons || []),
      children.length
    );
    return true;
  } catch (err) {
    logger.warn?.('[compression-quality] Failed to log compression attempt', { error: err.message });
    return false;
  }
}

/**
 * Prune old rows from compression_audit.
 * Keeps last 50k rows, 30d retention (same as ingest_quality_log).
 * @param {object} db - SQLite database
 * @returns {{ pruned: number, kept: number }}
 */
export function pruneCompressionAudit(db) {
  if (!db) return { pruned: 0, kept: 0 };

  try {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    // First, delete rows older than 30 days
    const delStmt = db.prepare('DELETE FROM compression_audit WHERE ts < ?');
    const delResult = delStmt.run(thirtyDaysAgo);
    const deletedByAge = delResult.changes || 0;

    // Then, if still > 50k rows, delete oldest until 50k remain
    const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM compression_audit');
    const { cnt } = countStmt.get();
    let deletedByCount = 0;

    if (cnt > 50000) {
      const toDelete = cnt - 50000;
      const delOldestStmt = db.prepare(`
        DELETE FROM compression_audit
        WHERE id IN (SELECT id FROM compression_audit ORDER BY ts ASC LIMIT ?)
      `);
      const oldest = delOldestStmt.run(toDelete);
      deletedByCount = oldest.changes || 0;
    }

    const totalPruned = deletedByAge + deletedByCount;
    const keptCount = Math.max(0, cnt - totalPruned);

    if (totalPruned > 0) {
      logger.info?.('[compression-quality] Pruned compression audit', {
        deletedByAge,
        deletedByCount,
        totalPruned,
        remaining: keptCount,
      });
    }

    return { pruned: totalPruned, kept: keptCount };
  } catch (err) {
    logger.warn?.('[compression-quality] Failed to prune compression audit', { error: err.message });
    return { pruned: 0, kept: 0, error: err.message };
  }
}
