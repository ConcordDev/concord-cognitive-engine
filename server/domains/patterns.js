// server/domains/patterns.js — Phase H4 emergent pattern feed.
//
// Joins drift_alerts (from drift-monitor) + recent breakthrough
// findings (breakthrough-clusters) + federation pulse so the
// PatternFeed component has a fresh, low-noise stream.

export default function registerPatternsMacros(register) {
  register("patterns", "discover", async (ctx, input = {}) => {
    const db = ctx?.db;
    if (!db) return { ok: false, reason: "no_db" };
    const limit = Math.min(50, Math.max(1, Number(input?.limit) || 20));
    const out = { drift: [], breakthroughs: [], federation: [] };
    try {
      out.drift = db.prepare(`
        SELECT id, type, severity, message, detected_at FROM drift_alerts
        WHERE resolved_at IS NULL ORDER BY detected_at DESC LIMIT ?
      `).all(limit);
    } catch { /* table optional */ }
    try {
      out.breakthroughs = db.prepare(`
        SELECT id, theme, summary, created_at FROM cross_domain_breakthroughs
        ORDER BY created_at DESC LIMIT ?
      `).all(limit);
    } catch { /* optional */ }
    try {
      out.federation = db.prepare(`
        SELECT id, kind, payload_summary, ts FROM cnet_federation_pulse
        ORDER BY ts DESC LIMIT ?
      `).all(limit);
    } catch { /* optional */ }
    return { ok: true, ...out };
  }, { note: "Joins drift alerts + cross-domain breakthroughs + federation pulse." });
}
