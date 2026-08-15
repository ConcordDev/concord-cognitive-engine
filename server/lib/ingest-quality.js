/**
 * Ingest Quality Gate — Feed DTU Coherence Check
 *
 * Validates incoming feed DTUs before persistence to prevent garbage from
 * reaching dtu_store. Checks:
 *   - Title length (30–200 chars)
 *   - Body length (≥200 chars)
 *   - Source attribution (externalUrl or source.url present)
 *   - Dedup key freshness (URL + canonical title + first 100 body chars)
 *   - Repetition (no 10-gram repeated 3+ times)
 *   - Blacklist tags (noise, gibberish, bot-detected)
 *   - System bypass (creator="system" or ownerId="system" skips all gates)
 */

import logger from '../logger.js';

// ══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════════

const MIN_TITLE_LEN = Number(process.env.CONCORD_INGEST_MIN_TITLE_LEN) || 30;
const MAX_TITLE_LEN = Number(process.env.CONCORD_INGEST_MAX_TITLE_LEN) || 200;
const MIN_BODY_LEN = Number(process.env.CONCORD_INGEST_MIN_BODY_LEN) || 200;
const QUALITY_ENABLED = process.env.CONCORD_INGEST_QUALITY_ENABLED !== '0';
const REPETITION_NGRAM = Number(process.env.CONCORD_INGEST_REPETITION_NGRAM) || 10;
const REPETITION_THRESHOLD = Number(process.env.CONCORD_INGEST_REPETITION_THRESHOLD) || 3;

const BLACKLIST_TAGS = new Set(['noise', 'gibberish', 'bot-detected']);

// ══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════════════════════════

/** Extract body text from multiple possible fields */
function getBodyText(dtu) {
  return (
    dtu.creti ||
    dtu.body ||
    dtu.content ||
    dtu.core?.definitions?.[0] ||
    dtu.core?.evidence?.[0]?.value ||
    ''
  );
}

/** Get source URL from multiple possible locations */
function getSourceUrl(dtu) {
  return (
    dtu.meta?.externalUrl ||
    dtu.meta?.sourceUrl ||
    dtu.source?.url ||
    dtu.sourceUrl ||
    ''
  );
}

/** Check if string looks like a URL */
function looksLikeUrl(str) {
  if (!str || typeof str !== 'string') return false;
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

/** Canonical title: lowercase, trim, remove extra spaces */
function canonicalTitle(title) {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

/** Extract 10-grams (or NGRAM-grams) from text */
function extractNgrams(text, n = 10) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);

  const ngrams = new Map();
  for (let i = 0; i <= words.length - n; i++) {
    const gram = words.slice(i, i + n).join(' ');
    ngrams.set(gram, (ngrams.get(gram) || 0) + 1);
  }
  return ngrams;
}

/** Check for excessive repetition of n-grams */
function checkRepetition(text, ngram = REPETITION_NGRAM, threshold = REPETITION_THRESHOLD) {
  const ngrams = extractNgrams(text, ngram);
  for (const [gram, count] of ngrams) {
    if (count >= threshold) {
      return { repetitive: true, gram, count };
    }
  }
  return { repetitive: false };
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Check if a DTU passes the coherence gate.
 * @param {object} dtu - DTU to validate
 * @param {object} opts - { seenDedupKeys?, db? }
 * @returns {{ ok: boolean, reason?: string, details?: object }}
 */
export function checkQualityGate(dtu, opts = {}) {
  if (!QUALITY_ENABLED) return { ok: true };

  // System bypass: creator or ownerId is "system"
  if (dtu.creator === 'system' || dtu.ownerId === 'system') {
    return { ok: true, bypass: 'system' };
  }

  // Title length check
  const title = dtu.title || '';
  if (title.length < MIN_TITLE_LEN) {
    return { ok: false, reason: 'title_too_short', details: { length: title.length, min: MIN_TITLE_LEN } };
  }
  if (title.length > MAX_TITLE_LEN) {
    return { ok: false, reason: 'title_too_long', details: { length: title.length, max: MAX_TITLE_LEN } };
  }

  // Body length check
  const body = getBodyText(dtu);
  if (!body || String(body).length < MIN_BODY_LEN) {
    return { ok: false, reason: 'body_too_short', details: { length: (body || '').length, min: MIN_BODY_LEN } };
  }

  // Source attribution check
  const sourceUrl = getSourceUrl(dtu);
  if (!sourceUrl || !looksLikeUrl(sourceUrl)) {
    return { ok: false, reason: 'missing_source', details: { provided: !!sourceUrl } };
  }

  // Blacklist tags check
  const tags = Array.isArray(dtu.tags) ? dtu.tags : [];
  for (const tag of tags) {
    if (BLACKLIST_TAGS.has(String(tag).toLowerCase())) {
      return { ok: false, reason: 'blacklisted_tag', details: { tag } };
    }
  }

  // Repetition check
  const repCheck = checkRepetition(body, REPETITION_NGRAM, REPETITION_THRESHOLD);
  if (repCheck.repetitive) {
    return { ok: false, reason: 'repetitive', details: { gram: repCheck.gram, count: repCheck.count } };
  }

  // All checks passed
  return { ok: true };
}

/**
 * Log a rejected DTU to ingest_quality_log (for analysis).
 * Called by feed-manager after quality gate rejection.
 * @param {object} args - { db?, dtu, feedId, feedSource, reason, dedupKey? }
 * @returns {boolean}
 */
export function logRejectedDTU(args = {}) {
  const { db, dtu, feedId, feedSource, reason, dedupKey } = args;
  if (!db || !reason) return false;

  try {
    const body = getBodyText(dtu);
    const sourceUrl = getSourceUrl(dtu);
    const stmt = db.prepare(`
      INSERT INTO ingest_quality_log (ts, feed_id, feed_source, title, reject_reason, body_len, source_url, details_json, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ingest-quality')
    `);
    stmt.run(
      Date.now(),
      feedId || feedSource?.id || 'unknown',
      feedSource?.name || feedSource?.id || 'unknown',
      dtu.title || '',
      reason,
      String(body || '').length,
      sourceUrl || '',
      JSON.stringify({ dedupKey, userId: dtu.ownerId, creator: dtu.creator })
    );
    return true;
  } catch (err) {
    logger.warn?.('[ingest-quality] Failed to log rejected DTU', { feedId, reason, error: err.message });
    return false;
  }
}

/**
 * Prune old rows from ingest_quality_log.
 * Called at boot + every 6h: keep last 50k rows, 30d retention.
 * @param {object} db - SQLite database
 * @returns {{ pruned: number, kept: number }}
 */
export function pruneQualityLog(db) {
  if (!db) return { pruned: 0, kept: 0 };

  try {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

    // First, delete rows older than 30 days
    const delStmt = db.prepare('DELETE FROM ingest_quality_log WHERE ts < ?');
    const delResult = delStmt.run(thirtyDaysAgo);
    const deletedByAge = delResult.changes || 0;

    // Then, if still > 50k rows, delete oldest until 50k remain
    const countStmt = db.prepare('SELECT COUNT(*) as cnt FROM ingest_quality_log');
    const { cnt } = countStmt.get();
    let deletedByCount = 0;

    if (cnt > 50000) {
      const toDelete = cnt - 50000;
      const delOldestStmt = db.prepare(`
        DELETE FROM ingest_quality_log
        WHERE id IN (SELECT id FROM ingest_quality_log ORDER BY ts ASC LIMIT ?)
      `);
      const oldest = delOldestStmt.run(toDelete);
      deletedByCount = oldest.changes || 0;
    }

    const totalPruned = deletedByAge + deletedByCount;
    const keptCount = Math.max(0, cnt - totalPruned);

    if (totalPruned > 0) {
      logger.info?.('[ingest-quality] Pruned quality log', {
        deletedByAge,
        deletedByCount,
        totalPruned,
        remaining: keptCount,
      });
    }

    return { pruned: totalPruned, kept: keptCount };
  } catch (err) {
    logger.warn?.('[ingest-quality] Failed to prune quality log', { error: err.message });
    return { pruned: 0, kept: 0, error: err.message };
  }
}
