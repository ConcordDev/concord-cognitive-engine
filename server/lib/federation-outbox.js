// server/lib/federation-outbox.js
//
// Phase 11 (Item 12) — durable outbox + delivery pump for the
// federated social layer.
//
// The pump runs on a heartbeat and drains pending rows. Honest
// retry semantics: exponential backoff capped at 6 attempts, then
// status flips to 'abandoned' so the row stops consuming work.
//
// No fake "delivered" — every status transition reflects what the
// remote inbox actually returned.

const MAX_ATTEMPTS = 6;
const RETRY_BACKOFF_S = [60, 300, 900, 3600, 14400, 86400]; // 1m, 5m, 15m, 1h, 4h, 1d
const FETCH_TIMEOUT_MS = 8000;

function nextAttemptDueAt(attempts) {
  const idx = Math.min(attempts, RETRY_BACKOFF_S.length - 1);
  return Math.floor(Date.now() / 1000) + RETRY_BACKOFF_S[idx];
}

/**
 * INSERT a pending activity into the outbox. Idempotent on
 * (ap_activity_id, target_inbox_url) — caller can fan out one
 * activity to many inboxes safely.
 */
export function enqueueOutbound(db, { homeUserId, apActivityId, activityType, activityJson, targetInboxUrl }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!homeUserId || !apActivityId || !activityType || !activityJson || !targetInboxUrl) {
    return { ok: false, reason: 'missing_field' };
  }
  // Dedupe at insert time.
  const existing = db.prepare(`
    SELECT id, status FROM federation_outbox
    WHERE ap_activity_id = ? AND target_inbox_url = ?
  `).get(apActivityId, targetInboxUrl);
  if (existing) return { ok: true, id: existing.id, status: existing.status, deduped: true };

  const r = db.prepare(`
    INSERT INTO federation_outbox
      (home_user_id, ap_activity_id, activity_type, activity_json, target_inbox_url)
    VALUES (?, ?, ?, ?, ?)
  `).run(homeUserId, apActivityId, activityType, activityJson, targetInboxUrl);
  return { ok: true, id: r.lastInsertRowid };
}

/**
 * Drain up to `limit` pending rows due for delivery. Returns
 * per-row results: { id, ok, status, reason? }.
 *
 * The actual HTTP POST is best-effort — federation peers may be
 * offline, slow, or rate-limiting; we never throw.
 */
export async function drainOutbox(db, { limit = 25 } = {}) {
  if (!db) return { ok: false, reason: 'no_db', results: [] };
  const now = Math.floor(Date.now() / 1000);
  // 'pending' rows that have never been attempted, or whose backoff
  // window has elapsed.
  const rows = db.prepare(`
    SELECT id, ap_activity_id, activity_type, activity_json, target_inbox_url, attempts, last_attempted_at
    FROM federation_outbox
    WHERE status IN ('pending', 'in_flight', 'failed')
      AND (last_attempted_at IS NULL OR last_attempted_at < ?)
    ORDER BY created_at ASC
    LIMIT ?
  `).all(now - 30, limit); // 30s minimum gap between attempts on the same row

  const results = [];
  for (const row of rows) {
    // Skip rows whose backoff window hasn't elapsed.
    if (row.attempts > 0 && row.last_attempted_at) {
      const due = nextAttemptDueAt(row.attempts - 1);
      if (due > now) {
        results.push({ id: row.id, ok: false, status: 'waiting_backoff' });
        continue;
      }
    }

    db.prepare(`UPDATE federation_outbox SET status = 'in_flight', last_attempted_at = ? WHERE id = ?`).run(now, row.id);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let httpOk = false, httpStatus = null, errMsg = null;
    try {
      const resp = await fetch(row.target_inbox_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/activity+json',
          'Accept': 'application/activity+json',
          'User-Agent': 'Concord-Federation/1.0',
        },
        body: row.activity_json,
        signal: ctrl.signal,
      });
      httpStatus = resp.status;
      httpOk = resp.status >= 200 && resp.status < 300;
      if (!httpOk) errMsg = `HTTP ${resp.status}`;
    } catch (e) {
      errMsg = String(e?.message || e);
    } finally {
      clearTimeout(t);
    }

    const newAttempts = row.attempts + 1;
    if (httpOk) {
      db.prepare(`UPDATE federation_outbox SET status = 'delivered', attempts = ?, last_error = NULL WHERE id = ?`)
        .run(newAttempts, row.id);
      results.push({ id: row.id, ok: true, status: 'delivered', httpStatus });
    } else if (newAttempts >= MAX_ATTEMPTS) {
      db.prepare(`UPDATE federation_outbox SET status = 'abandoned', attempts = ?, last_error = ? WHERE id = ?`)
        .run(newAttempts, errMsg, row.id);
      results.push({ id: row.id, ok: false, status: 'abandoned', reason: errMsg });
    } else {
      db.prepare(`UPDATE federation_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`)
        .run(newAttempts, errMsg, row.id);
      results.push({ id: row.id, ok: false, status: 'failed', reason: errMsg, attempts: newAttempts });
    }
  }
  return { ok: true, processed: results.length, results };
}

/**
 * Accept an inbound ActivityPub activity. Validates the basic
 * envelope shape and inserts a row in federation_inbox; dedupes
 * on ap_activity_id. The processor (called separately) decides
 * whether to materialize a local post / reaction / follow.
 */
export function receiveInbound(db, { apActivityId, sourceActor, activityType, activityJson }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!apActivityId || !sourceActor || !activityType || !activityJson) {
    return { ok: false, reason: 'missing_field' };
  }
  try {
    db.prepare(`
      INSERT INTO federation_inbox (ap_activity_id, source_actor, activity_type, activity_json)
      VALUES (?, ?, ?, ?)
    `).run(apActivityId, sourceActor, activityType, activityJson);
    return { ok: true };
  } catch (e) {
    if (String(e?.message || '').includes('UNIQUE')) {
      return { ok: true, deduped: true };
    }
    return { ok: false, reason: String(e?.message || e) };
  }
}

/**
 * Pull pending inbox rows. Caller-side processor materializes them
 * and calls markInboundProcessed.
 */
export function pendingInbound(db, { limit = 50 } = {}) {
  if (!db) return [];
  return db.prepare(`
    SELECT id, ap_activity_id, source_actor, activity_type, activity_json, received_at
    FROM federation_inbox
    WHERE processed = 0
    ORDER BY received_at ASC
    LIMIT ?
  `).all(limit);
}

export function markInboundProcessed(db, { id }) {
  if (!db || !id) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  const r = db.prepare(`UPDATE federation_inbox SET processed = 1, processed_at = ? WHERE id = ?`).run(now, id);
  return { ok: true, updated: r.changes };
}

export function upsertPeerActor(db, { actorId, handle, displayName, avatarUrl, inboxUrl, instanceUrl }) {
  if (!db || !actorId) return { ok: false };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO federation_peer_actors (actor_id, handle, display_name, avatar_url, inbox_url, instance_url, first_seen_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(actor_id) DO UPDATE SET
      handle = COALESCE(excluded.handle, handle),
      display_name = COALESCE(excluded.display_name, display_name),
      avatar_url = COALESCE(excluded.avatar_url, avatar_url),
      inbox_url = COALESCE(excluded.inbox_url, inbox_url),
      instance_url = COALESCE(excluded.instance_url, instance_url),
      last_seen_at = excluded.last_seen_at
  `).run(actorId, handle || null, displayName || null, avatarUrl || null, inboxUrl || null, instanceUrl || null, now, now);
  return { ok: true };
}

export function outboxStats(db) {
  if (!db) return {};
  const rows = db.prepare(`SELECT status, COUNT(*) AS c FROM federation_outbox GROUP BY status`).all();
  const out = { total: 0 };
  for (const r of rows) { out[r.status] = r.c; out.total += r.c; }
  return out;
}
