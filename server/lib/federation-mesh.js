// server/lib/federation-mesh.js
//
// Federated brain / mesh (#38) — DB-backed peer registry + a consent-gated
// inbox for incoming DTUs, plus a consented "6th brain" consult of peers over
// the real SSRF-guarded connectorFetch. The consent gate is real: a received DTU
// is only accepted if our INTENDED use honours the grant it carries
// (allowDerivatives / allowCommercial); a revoked peer is blocked from future
// acceptance. The brain consult makes a real HTTP call to each peer's endpoint —
// with none reachable it returns honest unavailable, never a fabricated reply.

let _idc = 0;
function fid(p) { return `${p}_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/** Register/refresh a peer. */
export function registerPeer(db, { peerId, url = null, brainUrl = null, pubKey = null, capabilities = [] } = {}) {
  if (!db || !peerId) return { ok: false, reason: "missing_peer" };
  try {
    db.prepare(`
      INSERT INTO fedmesh_peers (peer_id, url, brain_url, pub_key, capabilities_json, revoked)
      VALUES (?, ?, ?, ?, ?, 0)
      ON CONFLICT(peer_id) DO UPDATE SET url = excluded.url, brain_url = excluded.brain_url,
        pub_key = excluded.pub_key, capabilities_json = excluded.capabilities_json, revoked = 0
    `).run(peerId, url, brainUrl, pubKey, JSON.stringify(capabilities || []));
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, peerId };
}

export function listPeers(db, { includeRevoked = false } = {}) {
  if (!db) return [];
  try {
    const where = includeRevoked ? "" : "WHERE revoked = 0";
    return db.prepare(`SELECT peer_id AS peerId, url, brain_url AS brainUrl, capabilities_json, revoked FROM fedmesh_peers ${where} ORDER BY added_at`).all()
      .map((r) => ({ ...r, capabilities: safeParse(r.capabilities_json, []) }));
  } catch { return []; }
}

/** Block a peer: future inbound from it is auto-rejected. */
export function revokePeer(db, peerId) {
  if (!db || !peerId) return { ok: false, reason: "missing_peer" };
  try { db.prepare(`UPDATE fedmesh_peers SET revoked = 1 WHERE peer_id = ?`).run(peerId); } catch { /* */ }
  return { ok: true, peerId };
}

/**
 * The real consent gate. `policy` declares our intended use; a DTU is accepted
 * only if its grant permits it. Pure.
 * @returns {{accept, reason, mustAttribute}}
 */
export function evaluateConsent(envelope, policy = {}) {
  const c = (envelope && envelope.consent) || {};
  if (policy.intendCommercial && c.allowCommercial === false) return { accept: false, reason: "commercial_not_allowed", mustAttribute: !!c.requireAttribution };
  if (policy.intendDerivatives && c.allowDerivatives === false) return { accept: false, reason: "derivatives_not_allowed", mustAttribute: !!c.requireAttribution };
  return { accept: true, reason: "ok", mustAttribute: !!c.requireAttribution };
}

/** Enqueue an incoming DTU envelope from a peer (status pending). */
export function receiveDtu(db, { fromPeer, dtuId = null, envelope = {} } = {}) {
  if (!db || !fromPeer) return { ok: false, reason: "missing_peer" };
  const id = fid("fin");
  try {
    db.prepare(`INSERT INTO fedmesh_inbox (id, from_peer, dtu_id, envelope_json, consent_status) VALUES (?, ?, ?, ?, 'pending')`)
      .run(id, fromPeer, dtuId, JSON.stringify(envelope || {}));
  } catch (e) {
    return { ok: false, reason: "insert_failed", error: String(e?.message || e) };
  }
  return { ok: true, inboxId: id };
}

/**
 * Drain the pending inbox against the consent policy. A revoked peer's items are
 * rejected outright; the rest are accepted/rejected per evaluateConsent. Returns
 * { accepted, rejected }.
 */
export function drainInbox(db, policy = {}) {
  if (!db) return { accepted: 0, rejected: 0 };
  let accepted = 0, rejected = 0;
  try {
    const pending = db.prepare(`SELECT id, from_peer, envelope_json FROM fedmesh_inbox WHERE consent_status = 'pending' LIMIT 500`).all();
    const revoked = new Set(db.prepare(`SELECT peer_id FROM fedmesh_peers WHERE revoked = 1`).all().map((r) => r.peer_id));
    const setStatus = db.prepare(`UPDATE fedmesh_inbox SET consent_status = ?, reason = ? WHERE id = ?`);
    const tx = db.transaction(() => {
      for (const row of pending) {
        if (revoked.has(row.from_peer)) { setStatus.run("rejected", "peer_revoked", row.id); rejected++; continue; }
        const verdict = evaluateConsent(safeParse(row.envelope_json, {}), policy);
        if (verdict.accept) { setStatus.run("accepted", verdict.reason, row.id); accepted++; }
        else { setStatus.run("rejected", verdict.reason, row.id); rejected++; }
      }
    });
    tx();
  } catch { /* best-effort */ }
  return { accepted, rejected };
}

/**
 * Consented "6th brain": consult each peer's brain endpoint over connectorFetch
 * and return the replies that came back. Real HTTP — when no peer is reachable
 * it returns { ok:false, reason:'no_reachable_peer' }; it never invents a reply.
 */
export async function consultFederatedBrain(db, userId, { slot = "conscious", messages = [], timeoutMs = 6000 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  const peers = listPeers(db).filter((p) => p.brainUrl);
  if (!peers.length) return { ok: false, reason: "no_peer_with_brain" };
  let connectorFetch;
  try { ({ connectorFetch } = await import("./connector-client.js")); } catch { return { ok: false, reason: "fetch_unavailable" }; }

  const replies = [];
  for (const p of peers) {
    try {
      const res = await connectorFetch(db, userId || null, "federation", p.brainUrl, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slot, messages }),
      }, { timeoutMs });
      if (res && res.ok) {
        const data = await res.json().catch(() => null);
        const text = String(data?.text || data?.reply || "").trim();
        if (text) replies.push({ peerId: p.peerId, text });
      }
    } catch { /* peer unreachable — skip, never fabricate */ }
  }
  if (!replies.length) return { ok: false, reason: "no_reachable_peer" };
  return { ok: true, replies, consultedPeers: peers.length };
}

function safeParse(s, dflt) { try { return JSON.parse(s); } catch { return dflt; } }

export default { registerPeer, listPeers, revokePeer, evaluateConsent, receiveDtu, drainInbox, consultFederatedBrain };
