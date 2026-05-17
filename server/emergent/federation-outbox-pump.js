// server/emergent/federation-outbox-pump.js
//
// Phase 11 (Item 12) — heartbeat module that drains the federation
// outbox.  Wrapped in try/catch like every heartbeat — never throws,
// always returns { ok, ... }.
//
// Activated only when CONCORD_ACTIVITYPUB=true so dev / local-first
// installs don't make outbound HTTP fanouts they didn't ask for.

import { drainOutbox } from '../lib/federation-outbox.js';

export async function runFederationOutboxPump({ db } = {}) {
  if (process.env.CONCORD_ACTIVITYPUB !== 'true') {
    return { ok: true, reason: 'disabled' };
  }
  if (!db) return { ok: false, reason: 'no_db' };
  try {
    const result = await drainOutbox(db, { limit: 25 });
    return {
      ok: true,
      processed: result.processed || 0,
      delivered: (result.results || []).filter(r => r.status === 'delivered').length,
      failed: (result.results || []).filter(r => r.status === 'failed').length,
      abandoned: (result.results || []).filter(r => r.status === 'abandoned').length,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

export default runFederationOutboxPump;
