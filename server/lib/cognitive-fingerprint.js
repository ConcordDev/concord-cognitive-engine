// server/lib/cognitive-fingerprint.js
//
// Cognitive Fingerprint (#5) — derives a user's thinking-style profile from REAL
// activity only: the DTUs they authored, how many distinct lenses they work in,
// the mean depth (CRETI) of their work, and how often it gets cited. No
// fabricated metrics. Pure reads (3 bounded queries, no N+1); snapshotted over
// time by the cognitive-fingerprint-cycle heartbeat for trend tracking.

let _idc = 0;
function fpId() { return `cfp_${Date.now().toString(36)}_${(_idc++).toString(36)}`; }

/** Derive a label from the structural signals. */
function deriveStyle({ output, breadth, topShare, citationInfluence }) {
  if (output === 0) return "nascent";
  if (citationInfluence > output) return "influential";
  if (breadth >= 5) return "polymath";
  if (topShare > 0.6) return "specialist";
  return "generalist";
}

/**
 * Compute the current fingerprint for a user. Never throws; returns zeros when
 * the user has no activity.
 * @returns {{output, domainBreadth, citationInfluence, avgDepth, dominantDomains, style}}
 */
export function computeFingerprint(db, userId) {
  const uid = String(userId || "");
  const base = { output: 0, domainBreadth: 0, citationInfluence: 0, avgDepth: 0, dominantDomains: [], style: "nascent" };
  if (!db || !uid) return base;
  try {
    const agg = db.prepare("SELECT COUNT(*) AS n, AVG(creti_score) AS avg FROM dtus WHERE creator_id = ?").get(uid);
    const output = agg?.n || 0;
    const avgDepth = Math.round((agg?.avg || 0) * 100) / 100;

    const domains = db.prepare(`
      SELECT lens_id AS d, COUNT(*) AS c FROM dtus
      WHERE creator_id = ? AND lens_id IS NOT NULL
      GROUP BY lens_id ORDER BY c DESC
    `).all(uid);
    const domainBreadth = domains.length;
    const topShare = output > 0 && domains[0] ? domains[0].c / output : 0;
    const dominantDomains = domains.slice(0, 3).map((x) => ({ domain: x.d, count: x.c }));

    let citationInfluence = 0;
    try { citationInfluence = db.prepare("SELECT COUNT(*) AS n FROM royalty_lineage WHERE parent_creator = ?").get(uid).n; } catch { /* table optional */ }

    const style = deriveStyle({ output, breadth: domainBreadth, topShare, citationInfluence });
    return { output, domainBreadth, citationInfluence, avgDepth, dominantDomains, style };
  } catch {
    return base;
  }
}

/** Snapshot the current fingerprint into the time-series table. Returns the row or null. */
export function snapshotFingerprint(db, userId) {
  const uid = String(userId || "");
  if (!db || !uid) return null;
  const fp = computeFingerprint(db, uid);
  try {
    const id = fpId();
    db.prepare(`
      INSERT INTO cognitive_fingerprint (id, user_id, output, domain_breadth, citation_influence, avg_depth, dominant_domains, style)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, uid, fp.output, fp.domainBreadth, fp.citationInfluence, fp.avgDepth, JSON.stringify(fp.dominantDomains), fp.style);
    return { id, userId: uid, ...fp };
  } catch {
    return null;
  }
}

/** Read the snapshot history (newest first). */
export function getFingerprintHistory(db, userId, limit = 30) {
  try {
    return db.prepare(`
      SELECT output, domain_breadth AS domainBreadth, citation_influence AS citationInfluence,
             avg_depth AS avgDepth, dominant_domains AS dominantDomains, style, computed_at AS computedAt
      FROM cognitive_fingerprint WHERE user_id = ? ORDER BY computed_at DESC LIMIT ?
    `).all(String(userId || ""), Math.min(Math.max(Number(limit) || 30, 1), 200))
      .map((r) => ({ ...r, dominantDomains: JSON.parse(r.dominantDomains || "[]") }));
  } catch {
    return [];
  }
}

export default { computeFingerprint, snapshotFingerprint, getFingerprintHistory };
