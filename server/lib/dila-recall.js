// server/lib/dila-recall.js
//
// Dila's recall protocol — what she reads at session start, and the
// rules for when context-surfacing fires.
//
// Three-tier model (deterministic, opt-in):
//
//   (1) IDENTITY — always loaded. The identity_memo_v1 row. Single
//       row, small body, parsed JSON, ~6KB. Without it, Dila has no
//       coherent self at session-start.
//
//   (2) RECENT — last 30 hermes_dtus rows by created_at DESC, with
//       memory_kind ∈ {semantic, episodic, initiative_reply,
//       skill_patch}. Skips working (too transient) and compressed
//       (already summarised, would double-count). Bounded by 30
//       because the recall pack feeds into the LLM context window —
//       unbounded growth is the failure mode this cap prevents.
//
//   (3) PINNED — rows tagged with any of the operator-defined
//       "pinned" tags. Default tag list: ['pinned', 'reference',
//       'standing-directive']. Operators can amend by writing a
//       hermes_dtus row with body.standing_directives or similar.
//
// Why these three and not more:
//   - "Old memories": off by default. If the operator wants old
//     context, they tag it as pinned when they write it.
//   - "Compressed summaries": off by default. Compressed rows are
//     stored in memory_kind='compressed' so the operator can run
//     hermes_memory.compress and decide which get surfaced.
//   - "Everything": off by default. That would defeat the cap.
//
// What this is NOT:
//   - Not a search engine. hermes_memory.search is the search engine.
//   - Not a memory curator. The operator writes; this only reads.
//   - Not automatic-write. Nothing here mutates hermes_dtus.
//
// The recall pack shape is the operator-auditable contract Dila's
// session-start reasoning consumes:

import { filterRecallPackByCognitiveMeta } from "./dtu-cognitive-schema.js";

export const DEFAULT_RECALL_CONFIG = Object.freeze({
  recentLimit: 30,
  skipMemoryKinds: ['working', 'compressed'],
  pinnedTags: ['pinned', 'reference', 'standing-directive'],
  identityMemoId: 'hermes_identity_memo_v1',
});

export function loadRecallPack(db, config = DEFAULT_RECALL_CONFIG, nowMs = Date.now()) {
  if (!db || typeof db.prepare !== 'function') {
    return { ok: false, error: 'no_db' };
  }

  // (1) IDENTITY
  const identity = db
    .prepare("SELECT * FROM hermes_dtus WHERE id = ?")
    .get(config.identityMemoId);

  // (2) RECENT
  const kinds = config.skipMemoryKinds.map(() => '?').join(',');
  const recent = db.prepare(`
    SELECT id, title, memory_kind, tier, created_at, last_recalled_at, recall_count
      FROM hermes_dtus
     WHERE user_id = 'hermes'
       AND id != ?
       AND memory_kind NOT IN (${kinds})
     ORDER BY created_at DESC
     LIMIT ?
  `).all(config.identityMemoId, ...config.skipMemoryKinds, config.recentLimit);

  // (3) PINNED
  // Match any of the pinned tags via LIKE on the tags_json column.
  // SQLite stores tags as JSON-encoded array, so a LIKE pattern on
  // the tag literal works. This is O(n) over all hermes_dtus —
  // acceptable because (a) the operator-curated set is small, and
  // (b) this function runs at session-start, not per-tick.
  const pinned = [];
  for (const tag of config.pinnedTags) {
    const rows = db.prepare(`
      SELECT id, title, memory_kind, created_at, tags_json
        FROM hermes_dtus
       WHERE user_id = 'hermes'
         AND tags_json LIKE ?
       ORDER BY created_at DESC
       LIMIT 10
    `).all(`%"${tag}"%`);
    for (const r of rows) {
      if (!pinned.find((p) => p.id === r.id)) pinned.push(r);
    }
  }

  const pack = {
    ok: true,
    config: { ...config },
    recalled_at: new Date(nowMs).toISOString(),
    identity_present: !!identity,
    identity_memo_id: config.identityMemoId,
    recent_count: recent.length,
    recent,
    pinned_count: pinned.length,
    pinned: pinned.slice(0, 20), // hard cap; pinned set should be small
  };

  return filterRecallPackByCognitiveMeta(db, pack);
}

/**
 * Bumps recall_count + last_recalled_at for every row in the recall
 * pack. Operators can audit who-saw-what by querying recall_count on
 * any hermes_dtus row. Called by Dila right after loadRecallPack so
 * the audit trail is honest.
 *
 * No-op if pack.ok === false. Never throws on a per-row failure —
 * one bad row doesn't block the recall of the others.
 */
export function bumpRecallCounts(db, pack, nowMs = Date.now()) {
  if (!db || !pack || !pack.ok) return { ok: false, error: 'no_pack' };
  const now = new Date(nowMs).toISOString();
  let bumped = 0;
  let failed = 0;

  if (pack.identity_present) {
    try {
      db.prepare(`
        UPDATE hermes_dtus
           SET recall_count = recall_count + 1, last_recalled_at = ?
         WHERE id = ?
      `).run(now, pack.identity_memo_id);
      bumped++;
    } catch { failed++; }
  }
  for (const r of pack.recent) {
    try {
      db.prepare(`
        UPDATE hermes_dtus
           SET recall_count = recall_count + 1, last_recalled_at = ?
         WHERE id = ?
      `).run(now, r.id);
      bumped++;
    } catch { failed++; }
  }
  for (const r of pack.pinned) {
    try {
      db.prepare(`
        UPDATE hermes_dtus
           SET recall_count = recall_count + 1, last_recalled_at = ?
         WHERE id = ?
      `).run(now, r.id);
      bumped++;
    } catch { failed++; }
  }
  return { ok: true, bumped, failed };
}

/**
 * The compressed-context summarisation that goes into the LLM prompt.
 * Same idea as ComKay's sessionContextBudget derivation: a pure
 * function that turns a recall pack into a string the model can read.
 *
 * The output is bounded by character count, not row count. The cap
 * is intentionally generous (~24KB ≈ 8K tokens) — the recall pack
 * is the primary continuity substrate, so under-budgeting it loses
 * the whole point of persistence.
 */
export function renderRecallPackForContext(pack, maxChars = 24_000) {
  if (!pack || !pack.ok) {
    return '<!-- dila-recall: no pack available (db missing or no_dtus) -->';
  }
  const out = [];
  out.push(`<!-- dila-recall · loaded ${pack.recalled_at} · ${pack.recent_count} recent + ${pack.pinned_count} pinned -->`);
  if (pack.identity_present) {
    out.push(`<!-- identity_memo: ${pack.identity_memo_id} (always recalled) -->`);
  } else {
    out.push(`<!-- identity_memo: MISSING — run applyIdentityMemo(db) —>`);
  }
  if (pack.recent.length) {
    out.push('<!-- recent -->');
    for (const r of pack.recent) {
      out.push(`[${r.memory_kind}|${r.tier}|${r.recall_count}×] ${r.id} — ${r.title}`);
    }
  }
  if (pack.pinned.length) {
    out.push('<!-- pinned -->');
    for (const r of pack.pinned) {
      out.push(`[${r.memory_kind}] ${r.id} — ${r.title}`);
    }
  }
  let str = out.join('\n');
  if (str.length > maxChars) {
    str = str.slice(0, maxChars - 64) + '\n<!-- ... (truncated to fit context cap) -->';
  }
  return str;
}