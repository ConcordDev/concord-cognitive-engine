#!/usr/bin/env node
/**
 * Backfill Embeddings for Concord Cognitive Engine
 *
 * Generates and stores embedding vectors for all existing DTUs that
 * don't have one yet. Processes in batches of 50 to avoid memory issues.
 *
 * Can run while server is live — uses the same Ollama instance.
 *
 * Usage:
 *   node server/scripts/backfill-embeddings.js
 *   node server/scripts/backfill-embeddings.js --dry-run
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.join(__dirname, "..");
const DATA_DIR = process.env.DATA_DIR || path.join(SERVER_DIR, "data");
const STATE_PATH = process.env.STATE_PATH || path.join(DATA_DIR, "concord_state.json");

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const EMBEDDING_FALLBACK = "all-minilm";
const BATCH_SIZE = 50;
const EMBED_TIMEOUT_MS = 15_000;

const dryRun = process.argv.includes("--dry-run");

// Resolve Ollama URLs (try all three brain ports + default)
const OLLAMA_URLS = [
  process.env.BRAIN_CONSCIOUS_URL || process.env.OLLAMA_HOST || "http://ollama-conscious:11434",
  process.env.BRAIN_SUBCONSCIOUS_URL || "http://ollama-subconscious:11434",
  process.env.BRAIN_UTILITY_URL || "http://ollama-utility:11434",
].filter(Boolean);

async function main() {
  console.log("[Backfill] Starting embedding backfill...");
  console.log(`[Backfill] Dry run: ${dryRun}`);
  console.log(`[Backfill] State path: ${STATE_PATH}`);

  // Load DTUs from state file
  let dtus;
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    dtus = state.dtus || {};
    if (Array.isArray(dtus)) {
      // Convert array to object
      const obj = {};
      for (const d of dtus) {
        if (d?.id) obj[d.id] = d;
      }
      dtus = obj;
    }
  } catch (e) {
    console.error(`[Backfill] Failed to load state: ${e.message}`);
    process.exit(1);
  }

  const ids = Object.keys(dtus);
  console.log(`[Backfill] Found ${ids.length} DTUs`);

  // Find working Ollama URL and model
  let ollamaUrl = null;
  let model = null;

  for (const url of OLLAMA_URLS) {
    for (const m of [EMBEDDING_MODEL, EMBEDDING_FALLBACK]) {
      try {
        const r = await fetch(`${url}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m, prompt: "test" }),
          signal: AbortSignal.timeout(30_000),
        });
        if (r.ok) {
          const data = await r.json();
          if (Array.isArray(data.embedding) && data.embedding.length > 0) {
            ollamaUrl = url;
            model = m;
            console.log(`[Backfill] Using ${m} on ${url} (dim=${data.embedding.length})`);
            break;
          }
        }
      } catch { /* try next */ }
    }
    if (ollamaUrl) break;
  }

  if (!ollamaUrl) {
    console.error("[Backfill] No embedding model available on any Ollama instance");
    process.exit(1);
  }

  if (dryRun) {
    console.log(`[Backfill] DRY RUN — would embed ${ids.length} DTUs with ${model} on ${ollamaUrl}`);
    process.exit(0);
  }

  // Process in batches
  let embedded = 0, errors = 0, skipped = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(ids.length / BATCH_SIZE);

    console.log(`[Backfill] Batch ${batchNum}/${totalBatches} (${batch.length} DTUs)...`);

    for (const id of batch) {
      const dtu = dtus[id];
      if (!dtu) { skipped++; continue; }

      // Build text for embedding
      const parts = [
        dtu.title || "",
        Array.isArray(dtu.tags) ? dtu.tags.join(" ") : "",
        dtu.cretiHuman || dtu.creti || "",
        dtu.human?.summary || "",
        Array.isArray(dtu.human?.bullets) ? dtu.human.bullets.join(" ") : "",
        Array.isArray(dtu.core?.definitions) ? dtu.core.definitions.join(" ") : "",
        Array.isArray(dtu.core?.claims) ? dtu.core.claims.join(" ") : "",
        dtu.machine?.notes || "",
      ];

      const text = parts.filter(Boolean).join(" ").trim().slice(0, 8192);
      if (!text) { skipped++; continue; }

      try {
        const r = await fetch(`${ollamaUrl}/api/embeddings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: text }),
          signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
        });

        if (!r.ok) { errors++; continue; }

        const data = await r.json();
        if (Array.isArray(data.embedding) && data.embedding.length > 0) {
          // Store embedding back on DTU object (will be saved to state)
          dtu._embedding = data.embedding;
          embedded++;
        } else {
          errors++;
        }
      } catch (e) {
        errors++;
        if (errors % 10 === 0) {
          console.warn(`[Backfill] ${errors} errors so far, last: ${e?.message}`);
        }
      }
    }

    // Qdrant ANN backfill (Item 1) — bulk-upsert this batch's vectors. No-op
    // unless VECTOR_DB=qdrant + reachable; best-effort, never blocks the run.
    try {
      const qd = (await import("../lib/qdrant-client.js")).default;
      if (qd.configured()) {
        const items = batch
          .filter((d) => Array.isArray(d._embedding) && d._embedding.length)
          .map((d) => ({ dtuId: d.id, vector: Float32Array.from(d._embedding), payload: { tier: d.tier } }));
        if (items.length) await qd.upsertBatch(items);
      }
    } catch { /* best-effort */ }

    // Progress
    const pct = Math.round(((i + batch.length) / ids.length) * 100);
    console.log(`[Backfill] Progress: ${pct}% (embedded: ${embedded}, errors: ${errors}, skipped: ${skipped})`);
  }

  // Save updated state with embeddings
  try {
    const raw = fs.readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    state.dtus = dtus;
    fs.writeFileSync(STATE_PATH, JSON.stringify(state), "utf-8");
    console.log("[Backfill] State saved with embeddings");
  } catch (e) {
    console.error(`[Backfill] Failed to save state: ${e.message}`);
  }

  console.log("[Backfill] Complete!");
  console.log(`  Embedded: ${embedded}`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Skipped:  ${skipped}`);
  console.log(`  Total:    ${ids.length}`);
}

main().catch(e => {
  console.error("[Backfill] Fatal error:", e);
  process.exit(1);
});
