// Cockpit HTTP surface (GB-1500). CKPT-01 mounts the failure-count read route;
// later tickets add the run routes to this same file.
import { failureCounts } from "../lib/cockpit/telemetry.js";

const ADMIN_ROLES = new Set(["owner", "admin", "sovereign", "founder"]);

/** @param {{ app: import("express").Express, db: object }} deps */
export function mountCockpitRoutes({ app, db }) {
  app.get("/api/cockpit/failures", (req, res) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ ok: false, error: "auth_required" });
    const hours = Math.min(168, Math.max(1, Number.parseInt(req.query.hours, 10) || 24));
    const all = req.query.scope === "all" && ADMIN_ROLES.has(String(req.user?.role || "").toLowerCase());
    const sinceSec = Math.floor(Date.now() / 1000) - hours * 3600;
    const out = failureCounts(db, { userId: all ? null : userId, sinceSec });
    if (!out.ok) return res.status(503).json(out);
    return res.json({ ...out, hours, scope: all ? "all" : "self" });
  });
}
