// server/lib/runtime/dtu-retrieval-eval.js
//
// Deterministic DTU retrieval quality harness — precision/recall on seeded
// relevance sets. No LLM calls; exercises recall pack + cognitive filtering.

import { loadRecallPack } from "../dila-recall.js";
import {
  upsertCognitiveMeta,
  invalidateDtu,
  filterApplicableDtus,
  enrichDtuOnWrite,
} from "../dtu-cognitive-schema.js";

/**
 * Seed a small hermes_dtus corpus for retrieval eval (in-memory test DB).
 */
export function seedRetrievalEvalCorpus(db) {
  if (!db) return { ok: false, reason: "no_db" };

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS hermes_dtus (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'Untitled',
        body_json TEXT NOT NULL DEFAULT '{}',
        tags_json TEXT NOT NULL DEFAULT '[]',
        memory_kind TEXT NOT NULL DEFAULT 'semantic',
        tier TEXT NOT NULL DEFAULT 'regular',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_recalled_at TEXT,
        recall_count INTEGER NOT NULL DEFAULT 0
      )
    `);
  } catch { /* table may exist with stricter schema */ }

  const rows = [
    { id: "ret_eval_relevant_1", title: "Ledger conservation", memory_kind: "semantic", tags: ["finance", "pinned"] },
    { id: "ret_eval_relevant_2", title: "DHTP compression policy", memory_kind: "semantic", tags: ["dhtp"] },
    { id: "ret_eval_noise_1", title: "Unrelated trivia", memory_kind: "semantic", tags: [] },
    { id: "ret_eval_stale_1", title: "Stale API doc", memory_kind: "semantic", tags: ["api"] },
  ];

  // hermes_dtus tier enum is ('small','mega','hyper') — default 'small' per schema
  const insert = db.prepare(`
    INSERT OR REPLACE INTO hermes_dtus (id, user_id, title, body_json, memory_kind, tier, tags_json, created_at)
    VALUES (?, 'hermes', ?, '{}', ?, 'small', ?, datetime('now'))
  `);

  for (const r of rows) {
    insert.run(r.id, r.title, r.memory_kind, JSON.stringify(r.tags));
    upsertCognitiveMeta(db, r.id, {
      applicability: { tags: r.tags, domains: ["retrieval_eval"] },
      outcomes: [{ key: "topic", value: r.title }],
    });
  }

  invalidateDtu(db, "ret_eval_stale_1", { reason: "superseded" });

  return {
    ok: true,
    relevantIds: ["ret_eval_relevant_1", "ret_eval_relevant_2"],
    staleIds: ["ret_eval_stale_1"],
    noiseIds: ["ret_eval_noise_1"],
  };
}

/**
 * Score recall pack against expected relevant set.
 */
export function scoreRetrievalPack(recallPack, { relevantIds = [], staleIds = [] } = {}) {
  if (!recallPack?.ok) return { ok: false, reason: "no_pack" };

  const recalled = new Set([
    ...(recallPack.recent || []).map((r) => r.id),
    ...(recallPack.pinned || []).map((r) => r.id),
  ]);

  const relevantSet = new Set(relevantIds);
  const staleSet = new Set(staleIds);

  let truePositives = 0;
  let falsePositives = 0;
  let staleLeaked = 0;

  for (const id of recalled) {
    if (relevantSet.has(id)) truePositives += 1;
    else if (staleSet.has(id)) staleLeaked += 1;
    else falsePositives += 1;
  }

  const recall = relevantSet.size ? truePositives / relevantSet.size : 0;
  const precision = recalled.size ? truePositives / recalled.size : 0;

  return {
    ok: staleLeaked === 0 && recall >= 0.5,
    recalledCount: recalled.size,
    truePositives,
    falsePositives,
    staleLeaked,
    recall,
    precision,
    recalledIds: [...recalled],
  };
}

/**
 * Run full deterministic retrieval eval battery.
 */
export function runDtuRetrievalEval(db) {
  const corpus = seedRetrievalEvalCorpus(db);
  if (!corpus.ok) return corpus;

  const pack = loadRecallPack(db, {
    recentLimit: 10,
    skipMemoryKinds: ["working", "compressed"],
    pinnedTags: ["pinned"],
    identityMemoId: "hermes_identity_memo_v1",
  });

  const packScore = scoreRetrievalPack(pack, {
    relevantIds: corpus.relevantIds,
    staleIds: corpus.staleIds,
  });

  const applicable = filterApplicableDtus(db, [
    ...corpus.relevantIds,
    ...corpus.staleIds,
    ...corpus.noiseIds,
  ], { domain: "retrieval_eval" });

  const applicableIds = applicable.map((a) => a.dtuId);
  const staleExcluded = !applicableIds.includes("ret_eval_stale_1");

  return {
    ok: packScore.ok && staleExcluded,
    suite: "dtu_retrieval_eval",
    packScore,
    applicableCount: applicable.length,
    staleExcluded,
    corpus,
  };
}

export { enrichDtuOnWrite };
