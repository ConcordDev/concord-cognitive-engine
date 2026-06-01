// server/lib/referral-metrics.js
//
// F5 — distribution / referral instrumentation (the viral K-factor).
//
// Reads world_invites (the share/invite substrate) and computes the loop the
// cold-start strategy lives or dies on: how many invites each inviter sends, how
// many are accepted, and therefore K = invites-per-user × acceptance-rate (the
// viral coefficient — K≥1 means organic growth). Observe-only, pure DB, never
// throws. (Judgment + distribution strategy stay the user's; this only measures.)

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {{ok:boolean, invitesSent?:number, accepted?:number, declined?:number, pending?:number, expired?:number, acceptanceRate?:number, inviters?:number, invitesPerInviter?:number, kFactor?:number, viral?:boolean, topInviters?:Array, reason?:string}}
 */
export function referralReport(db) {
  if (!db) return { ok: false, reason: "no_db" };
  try {
    const total = db.prepare(`SELECT COUNT(*) AS n FROM world_invites`).get().n;
    if (!total) {
      return { ok: true, invitesSent: 0, accepted: 0, declined: 0, pending: 0, expired: 0, acceptanceRate: 0, inviters: 0, invitesPerInviter: 0, kFactor: 0, viral: false, topInviters: [] };
    }
    const byStatus = {};
    for (const r of db.prepare(`SELECT status, COUNT(*) AS n FROM world_invites GROUP BY status`).all()) {
      byStatus[r.status] = r.n;
    }
    const accepted = byStatus.accepted || 0;
    const inviters = db.prepare(`SELECT COUNT(DISTINCT from_user_id) AS n FROM world_invites`).get().n || 0;

    const acceptanceRate = total ? round4(accepted / total) : 0;
    const invitesPerInviter = inviters ? round4(total / inviters) : 0;
    // Viral coefficient: each inviter yields (invitesPerInviter × acceptanceRate) accepted joiners.
    const kFactor = round4(invitesPerInviter * acceptanceRate);

    const topInviters = db.prepare(`
      SELECT from_user_id AS userId,
             COUNT(*) AS sent,
             SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END) AS accepted
        FROM world_invites GROUP BY from_user_id
        ORDER BY accepted DESC, sent DESC LIMIT 10
    `).all();

    return {
      ok: true,
      invitesSent: total,
      accepted,
      declined: byStatus.declined || 0,
      pending: byStatus.pending || 0,
      expired: byStatus.expired || 0,
      acceptanceRate,
      inviters,
      invitesPerInviter,
      kFactor,
      viral: kFactor >= 1,
      topInviters,
    };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }

export default referralReport;
