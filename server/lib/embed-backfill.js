/**
 * Embed Backfill — Boot-time E5 Embedding Population
 *
 * Walks all live DTUs from dtu_store and generates 1024-dim embeddings
 * via intfloat/e5-large-v2, batched for performance.
 *
 * Kicked off at boot AFTER migrations, fire-and-forget (doesn't block startup).
 * Logs progress every 100 DTUs; yields between batches to avoid stalling the
 * event loop.
 */

import logger from '../logger.js';
import { shouldRunHeavyMaintenance } from "./presence-idle.js";

// ══════════════════════════════════════════════════════════════════════════════

const BATCH_SIZE = 50;
const LOG_INTERVAL = 100;

/**
 * Backfill embeddings_e5 table for all live DTUs.
 * Fire-and-forget; doesn't block caller.
 *
 * @param {object} args - { db, embed, STATE }
 * @returns {Promise<{ ok: boolean, total: number, batched: number, errors: number }>}
 */
export async function backfillE5Embeddings(args = {}) {
  // Sprint 60+ — idle gate. E5 backfill burns LLM calls; skip with no users.
  if (!shouldRunHeavyMaintenance()) return { ok: true, skipped: "idle_no_users", processed: 0 };
  const { db, embed, STATE } = args;
  if (!db || !embed) {
    logger.warn?.('[embed-backfill] Missing db or embed function');
    return { ok: false, reason: 'missing_deps', total: 0, batched: 0, errors: 0 };
  }

  try {
    // Fetch all DTUs from SQLite (STATE.dtus is empty at boot before seeds load).
    // Read from dtu_store and parse the JSON data blob to extract text fields.
    // Include payload_kind to detect non-text DTUs (Sprint 32 E6).
    let allDTUs = [];
    try {
      const stmt = db.prepare('SELECT id, data, payload_kind FROM dtu_store LIMIT 10000');
      const rows = stmt.all();
      let parseErrors = 0;
      allDTUs = rows.map(row => {
        let data = {};
        if (row.data) {
          try {
            data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
          } catch (e) {
            parseErrors++;
            logger.debug?.('[embed-backfill] JSON parse failed for DTU %s: %s', row.id, e.message);
          }
        }
        return {
          id: row.id,
          creti: data.creti || data.cretiHuman || data.body || data.content || ''
        };
      });
      if (parseErrors > 0) {
        logger.info?.('[embed-backfill] Loaded %d DTUs with %d parse errors', allDTUs.length, parseErrors);
      }
    } catch (err) {
      logger.warn?.('[embed-backfill] Failed to load DTUs from db: %s', err.message);
      return { ok: false, reason: 'db_read_failed', total: 0, batched: 0, errors: 0 };
    }

    if (allDTUs.length === 0) {
      logger.info?.('[embed-backfill] No DTUs to backfill');
      return { ok: true, total: 0, batched: 0, errors: 0 };
    }

    logger.info?.('[embed-backfill] Starting backfill for %d DTUs', allDTUs.length);

    let batched = 0;
    let errors = 0;
    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO embeddings_e5 (dtu_id, vector, dim, model, source, created_at, updated_at)
      VALUES (?, ?, 1024, 'mxbai-embed-large', 'dtu.creti', ?, ?)
    `);

    // Process in batches
    for (let i = 0; i < allDTUs.length; i += BATCH_SIZE) {
      const batch = allDTUs.slice(i, i + BATCH_SIZE);
      const now = Date.now();

      for (const dtu of batch) {
        try {
          // Skip non-text DTUs (Sprint 32 E6 — binary attachments)
          const payloadKind = dtu.payload_kind || 'text';
          if (['binary', 'pdf', 'image', 'audio', 'video', 'gzip'].includes(payloadKind)) {
            logger.info?.('[embed-backfill] Skipping non-text DTU %s (kind: %s)', dtu.id, payloadKind);
            // Still mark it as considered: write empty vector with source='skipped_non_text'
            const emptyVector = new Float32Array(1024);
            const buffer = Buffer.from(emptyVector.buffer, emptyVector.byteOffset, emptyVector.byteLength);
            insertStmt.run(dtu.id, buffer, now, now);
            continue;
          }

          // Get body text
          const bodyText = dtu.creti || '';
          if (!bodyText || String(bodyText).length < 10) {
            continue; // Skip empty DTUs
          }

          // Generate passage embedding (type='passage' adds prefix)
          const vec = await embed(bodyText, 'passage');
          if (!vec) {
            errors++;
            logger.warn?.('[embed-backfill] No embedding returned for DTU %s', dtu.id);
            continue;
          }

          // Convert Float32Array to Buffer for SQLite BLOB storage
          const buffer = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);

          // Insert into embeddings_e5
          insertStmt.run(dtu.id, buffer, now, now);
          batched++;
        } catch (err) {
          errors++;
          logger.warn?.('[embed-backfill] Error embedding DTU %s: %s', dtu.id, err.message);
          if (err.stack) logger.debug?.('[embed-backfill] Stack: %s', err.stack);
        }
      }

      // Log progress every LOG_INTERVAL DTUs
      if ((i + BATCH_SIZE) % LOG_INTERVAL === 0 || i + BATCH_SIZE >= allDTUs.length) {
        logger.info?.('[embed-backfill] Progress: %d/%d batched (errors: %d)', batched, allDTUs.length, errors);
      }

      // Yield to event loop between batches
      await new Promise(r => { setImmediate(r); });
    }

    logger.info?.('[embed-backfill] Complete: %d batched, %d errors', batched, errors);
    return { ok: true, total: allDTUs.length, batched, errors };
  } catch (err) {
    logger.warn?.('[embed-backfill] Fatal error', { error: err.message });
    return { ok: false, reason: 'fatal_error', total: 0, batched: 0, errors: 0, errorMsg: err.message };
  }
}
