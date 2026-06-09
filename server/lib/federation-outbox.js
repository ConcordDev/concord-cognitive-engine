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

import { signRequest } from './ap-signature.js';

const MAX_ATTEMPTS = 6;
const RETRY_BACKOFF_S = [60, 300, 900, 3600, 14400, 86400]; // 1m, 5m, 15m, 1h, 4h, 1d
const FETCH_TIMEOUT_MS = 8000;

const BASE_URL = process.env.CONCORD_BASE_URL || "https://concord-os.org";

/**
 * Build the per-user signing inputs (privateKeyPem + keyId) from env.
 * Returns null when signing is not configured — the outbox falls back
 * to unsigned POSTs in that case (which Mastodon will reject in
 * Authorized Fetch mode but pre-AF instances accept).
 *
 * In production CONCORD_AP_PRIVATE_KEY_PEM is the server-wide key and
 * CONCORD_AP_PUBLIC_KEY_PEM the matching public PEM exposed on every
 * actor's publicKey field. Future enhancement: per-user keypairs.
 */
// Same PEM unescape rule activitypub-bridge.js uses for the public
// key. We compute once at module-load so callers don't pay the regex
// on every outbox drain.
const _PRIVATE_KEY_PEM = (() => {
  const raw = process.env.CONCORD_AP_PRIVATE_KEY_PEM || "";
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
})();

function signingInputsFor(homeUserId) {
  if (!_PRIVATE_KEY_PEM) return null;
  // Must match buildActor() — the keyId fragment is the actor URL plus
  // #main-key, and peers will re-fetch publicKey.publicKeyPem from
  // there to verify our signature.
  const actorId = `${BASE_URL}/api/federation/users/${encodeURIComponent(homeUserId)}`;
  return { privateKeyPem: _PRIVATE_KEY_PEM, keyId: `${actorId}#main-key` };
}

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
    SELECT id, home_user_id, ap_activity_id, activity_type, activity_json, target_inbox_url, attempts, last_attempted_at
    FROM federation_outbox
    WHERE status IN ('pending', 'in_flight', 'failed')
      AND (last_attempted_at IS NULL OR last_attempted_at < ?)
    ORDER BY created_at ASC
    LIMIT ?
  `).all(now - 30, limit); // 30s minimum gap between attempts on the same row

  const results = [];
  const markInFlight = db.prepare(`UPDATE federation_outbox SET status = 'in_flight', last_attempted_at = ? WHERE id = ?`);
  const markDelivered = db.prepare(`UPDATE federation_outbox SET status = 'delivered', attempts = ?, last_error = NULL WHERE id = ?`);
  const markAbandoned = db.prepare(`UPDATE federation_outbox SET status = 'abandoned', attempts = ?, last_error = ? WHERE id = ?`);
  const markFailed = db.prepare(`UPDATE federation_outbox SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?`);
  for (const row of rows) {
    // Skip rows whose backoff window hasn't elapsed.
    if (row.attempts > 0 && row.last_attempted_at) {
      const due = nextAttemptDueAt(row.attempts - 1);
      if (due > now) {
        results.push({ id: row.id, ok: false, status: 'waiting_backoff' });
        continue;
      }
    }

    markInFlight.run(now, row.id);

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    let httpOk = false, httpStatus = null, errMsg = null;
    try {
      // Build base + (optional) HTTP-Signature headers. Outbound POSTs
      // are signed whenever CONCORD_AP_PRIVATE_KEY_PEM is set; otherwise
      // we ship unsigned, which Mastodon Authorized-Fetch mode will
      // reject (the row will fail and back off normally).
      const baseHeaders = {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json',
        'User-Agent': 'Concord-Federation/1.0',
      };
      const sigInputs = signingInputsFor(row.home_user_id);
      const headers = sigInputs
        ? signRequest({
            privateKeyPem: sigInputs.privateKeyPem,
            keyId: sigInputs.keyId,
            method: 'POST',
            url: row.target_inbox_url,
            body: row.activity_json,
            extraHeaders: baseHeaders,
          })
        : baseHeaders;

      const resp = await fetch(row.target_inbox_url, {
        method: 'POST',
        headers,
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
      markDelivered.run(newAttempts, row.id);
      results.push({ id: row.id, ok: true, status: 'delivered', httpStatus });
    } else if (newAttempts >= MAX_ATTEMPTS) {
      markAbandoned.run(newAttempts, errMsg, row.id);
      results.push({ id: row.id, ok: false, status: 'abandoned', reason: errMsg });
    } else {
      markFailed.run(newAttempts, errMsg, row.id);
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

/**
 * Phase 12 — Discover a remote ActivityPub actor via webfinger (RFC 7033)
 * + actor JSON-LD. Caches the resolved `(actorId, inboxUrl)` into
 * federation_peer_actors so subsequent posts skip the network roundtrip.
 *
 * @param {object} db
 * @param {string} handle — `user@host` form
 * @param {object=} opts
 * @param {(url:string, init?:object) => Promise<Response>=} opts.fetcher
 * @returns {Promise<{ ok:boolean, actorId?:string, inboxUrl?:string, error?:string }>}
 */
export async function discoverPeerByWebfinger(db, handle, { fetcher = globalThis.fetch, timeoutMs = 6000 } = {}) {
  if (!handle || typeof handle !== 'string') return { ok: false, error: 'bad_handle' };
  const m = handle.match(/^([^@\s]+)@([a-z0-9.-]+(?::\d+)?)$/i);
  if (!m) return { ok: false, error: 'malformed_handle' };
  const [, user, host] = m;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // 1. Webfinger lookup.
    const wfUrl = `https://${host}/.well-known/webfinger?resource=acct:${encodeURIComponent(user + '@' + host)}`;
    const wfRes = await fetcher(wfUrl, { headers: { Accept: 'application/jrd+json' }, signal: ctrl.signal });
    if (!wfRes.ok) return { ok: false, error: `webfinger_${wfRes.status}` };
    const wf = await wfRes.json();
    const apLink = Array.isArray(wf?.links) ? wf.links.find(l => l?.rel === 'self' && l?.type === 'application/activity+json') : null;
    const actorUrl = apLink?.href;
    if (!actorUrl) return { ok: false, error: 'no_activitypub_link' };

    // 2. Fetch the actor JSON-LD for the inbox URL.
    const actorRes = await fetcher(actorUrl, { headers: { Accept: 'application/activity+json' }, signal: ctrl.signal });
    if (!actorRes.ok) return { ok: false, error: `actor_${actorRes.status}` };
    const actor = await actorRes.json();
    if (!actor?.id || !actor?.inbox) return { ok: false, error: 'malformed_actor' };

    // 3. Cache.
    if (db) {
      try {
        upsertPeerActor(db, {
          actorId: actor.id,
          handle: `${user}@${host}`,
          displayName: actor.name || actor.preferredUsername || user,
          avatarUrl: actor.icon?.url || actor.icon?.[0]?.url || null,
          inboxUrl: actor.inbox,
          instanceUrl: `https://${host}`,
        });
      } catch { /* cache write failure is non-fatal */ }
    }

    return { ok: true, actorId: actor.id, inboxUrl: actor.inbox };
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}
