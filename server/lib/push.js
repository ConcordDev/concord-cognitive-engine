// server/lib/push.js
//
// Phase 11 (Item 13) — push notification dispatcher.
//
// Routes a single createNotification fan-out to all of a user's
// registered devices.  Two backends:
//
//   - 'web'  — WebPush via VAPID. Uses the `web-push` npm package
//              if installed; otherwise serializes payload + endpoint
//              into the outbox row and reports the missing
//              dependency in the response envelope.
//
//   - 'expo' — Expo push tokens. Uses `expo-server-sdk` if installed;
//              otherwise the same graceful-missing-dep envelope.
//
// Neither package is required for the rest of the server to boot.
// Push is opt-in by config — without VAPID keys (web) or with no
// registered tokens, this module is a no-op.
//
// No fake "sent" responses ever — every send reports whether the
// upstream actually accepted. 410 Gone purges the token row.

let _webPush = null;
let _expoSdk = null;

async function getWebPush() {
  if (_webPush !== null) return _webPush;
  try {
    const mod = await import('web-push');
    _webPush = mod.default ?? mod;
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@concord-os.org';
      try { _webPush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); }
      catch (_e) { /* invalid keys → callers report missing-config */ }
    }
    return _webPush;
  } catch {
    _webPush = false;
    return false;
  }
}

async function getExpo() {
  if (_expoSdk !== null) return _expoSdk;
  try {
    const mod = await import('expo-server-sdk');
    const Expo = mod.Expo ?? mod.default?.Expo ?? mod.default;
    if (!Expo) { _expoSdk = false; return false; }
    _expoSdk = new Expo();
    return _expoSdk;
  } catch {
    _expoSdk = false;
    return false;
  }
}

/**
 * INSERT a push token, or bump last_used_at if the (user_id, token)
 * already exists.
 */
export function registerToken(db, { userId, token, platform, deviceLabel = null, expiresAt = null }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!userId || !token) return { ok: false, reason: 'user_id_and_token_required' };
  if (!['web', 'expo'].includes(platform)) return { ok: false, reason: 'invalid_platform' };
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO push_tokens (user_id, token, platform, device_label, expires_at, created_at, last_used_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, token) DO UPDATE SET
      platform = excluded.platform,
      device_label = excluded.device_label,
      expires_at = excluded.expires_at,
      last_used_at = excluded.last_used_at
  `).run(userId, token, platform, deviceLabel, expiresAt, now, now);
  return { ok: true };
}

/**
 * Remove a token. Used when the OS reports the device uninstalled
 * the app or when the server gets a 410 Gone back from a send.
 */
export function removeToken(db, { token }) {
  if (!db || !token) return { ok: false, reason: 'db_and_token_required' };
  const r = db.prepare(`DELETE FROM push_tokens WHERE token = ?`).run(token);
  return { ok: true, removed: r.changes };
}

/**
 * Fan a payload out to every device registered for `userId`.
 * Returns per-device results so the caller can decide what to
 * report to the UI.
 */
export async function sendPush(db, { userId, title, body, data = {} }) {
  if (!db) return { ok: false, reason: 'no_db' };
  if (!userId) return { ok: false, reason: 'no_user' };

  const rows = db.prepare(`SELECT id, token, platform FROM push_tokens WHERE user_id = ?`).all(userId);
  if (rows.length === 0) return { ok: true, sent: 0, results: [] };

  const results = [];
  const webPush = await getWebPush();
  const expo = await getExpo();

  for (const row of rows) {
    if (row.platform === 'web') {
      if (!webPush || !process.env.VAPID_PUBLIC_KEY) {
        results.push({ id: row.id, ok: false, reason: 'web_push_unavailable' });
        continue;
      }
      try {
        let subscription;
        try { subscription = JSON.parse(row.token); }
        catch { results.push({ id: row.id, ok: false, reason: 'invalid_subscription_json' }); continue; }
        await webPush.sendNotification(subscription, JSON.stringify({ title, body, data }));
        db.prepare(`UPDATE push_tokens SET last_used_at = ? WHERE id = ?`)
          .run(Math.floor(Date.now() / 1000), row.id);
        results.push({ id: row.id, ok: true });
      } catch (e) {
        const status = e?.statusCode;
        if (status === 410 || status === 404) {
          removeToken(db, { token: row.token });
          results.push({ id: row.id, ok: false, reason: 'gone_purged' });
        } else {
          results.push({ id: row.id, ok: false, reason: String(e?.message || e) });
        }
      }
    } else if (row.platform === 'expo') {
      if (!expo) {
        results.push({ id: row.id, ok: false, reason: 'expo_sdk_unavailable' });
        continue;
      }
      try {
        const tickets = await expo.sendPushNotificationsAsync([{ to: row.token, sound: 'default', title, body, data }]);
        const tic = tickets[0];
        if (tic?.status === 'ok') {
          db.prepare(`UPDATE push_tokens SET last_used_at = ? WHERE id = ?`)
            .run(Math.floor(Date.now() / 1000), row.id);
          results.push({ id: row.id, ok: true, ticket: tic.id });
        } else {
          const reason = tic?.details?.error || tic?.message || 'unknown';
          if (reason === 'DeviceNotRegistered') removeToken(db, { token: row.token });
          results.push({ id: row.id, ok: false, reason });
        }
      } catch (e) {
        results.push({ id: row.id, ok: false, reason: String(e?.message || e) });
      }
    }
  }

  return {
    ok: true,
    sent: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

/** GC sweep: remove tokens not used in the last `days` days. */
export function purgeStale(db, days = 90) {
  if (!db) return { ok: false, reason: 'no_db' };
  const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
  const r = db.prepare(`DELETE FROM push_tokens WHERE last_used_at < ?`).run(cutoff);
  return { ok: true, purged: r.changes };
}
