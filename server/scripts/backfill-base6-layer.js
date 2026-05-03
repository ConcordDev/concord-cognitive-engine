#!/usr/bin/env node
// server/scripts/backfill-base6-layer.js
// Background script: compute base6_representation and semantic_layer for all dtus
// that have a numeric value but haven't been backfilled yet.
// Safe to re-run; rate-limited to avoid production impact.

import { computeBase6Layer, generateDTUSemantic } from "../lib/refusal-algebra/index.js";

const BATCH_SIZE = 100;
const RATE_LIMIT_MS = 100; // pause between batches

function sleep(ms) {
  return new Promise(r => { setTimeout(r, ms); });
}

/**
 * @param {import('better-sqlite3').Database} db
 */
async function backfillBase6Layer(db) {
  let offset = 0;
  let totalProcessed = 0;
  let totalSkipped = 0;

  console.info("[base6-backfill] Starting...");

  while (true) {
    const rows = db.prepare(
      "SELECT id, content, metadata_json FROM dtus WHERE base6_representation IS NULL LIMIT ? OFFSET ?"
    ).all(BATCH_SIZE, offset);

    if (rows.length === 0) break;

    for (const row of rows) {
      try {
        // Extract numeric value: check content (if numeric) or metadata_json.value
        let value = null;
        const num = Number(row.content);
        if (!isNaN(num) && row.content?.trim() !== "") {
          value = num;
        } else if (row.metadata_json) {
          try {
            const meta = JSON.parse(row.metadata_json);
            if (typeof meta.value === "number") value = meta.value;
          } catch { /* skip */ }
        }

        if (value !== null) {
          const base6 = computeBase6Layer(value);
          const semantic = generateDTUSemantic(value);
          if (base6) {
            db.prepare(
              "UPDATE dtus SET base6_representation = ?, semantic_layer = ? WHERE id = ?"
            ).run(base6, semantic, row.id);
            totalProcessed++;
          } else {
            totalSkipped++;
          }
        } else {
          totalSkipped++;
        }
      } catch (err) {
        console.warn(`[base6-backfill] Skipping DTU ${row.id}: ${err.message}`);
        totalSkipped++;
      }
    }

    offset += BATCH_SIZE;
    await sleep(RATE_LIMIT_MS);
  }

  console.info(`[base6-backfill] Done. Processed: ${totalProcessed}, Skipped: ${totalSkipped}`);
  return { totalProcessed, totalSkipped };
}

// Standalone execution
if (process.argv[1].endsWith("backfill-base6-layer.js")) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  let db;
  try {
    const Database = require("better-sqlite3");
    const dbPath = process.env.DB_PATH || "./concord.db";
    db = new Database(dbPath, { readonly: false });
    await backfillBase6Layer(db);
  } catch (err) {
    console.error("[base6-backfill] Fatal:", err.message);
    process.exit(1);
  } finally {
    db?.close?.();
  }
}

export { backfillBase6Layer };
