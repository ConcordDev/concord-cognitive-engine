// server/lib/admin-heartbeat.js
//
// Admin-tier switch for the governor heartbeat (founder ruling GB-0344). STATE.settings.heartbeatEnabled
// was only writable by owner-only routes (POST /api/settings, /api/sovereign/decree), so the admin seat had
// no sanctioned way to turn it back on after the memory watchdog's pause had been persisted.
//
//   GET  /api/admin/heartbeat   read-only view
//   POST /api/admin/heartbeat   { enabled: boolean }  -> flips ONLY settings.heartbeatEnabled
//
// Both behind requireRole("owner","admin","founder") (sovereign passes inside requireRole). The other four
// background flags (autogen/dream/evolution/synth) stay owner-only. A write clears any watchdog pause record
// for heartbeatEnabled (an explicit write supersedes the pause), is persisted immediately, and audit-logged.

export function mountAdminHeartbeatRoutes(app, { requireRole, getState, save, clearMemoryPause, persistableSettings, log = () => {} }) {
  const gate = requireRole("owner", "admin", "founder");

  const view = (STATE) => ({
    current: STATE.settings?.heartbeatEnabled ?? null,
    persisted: persistableSettings(STATE)?.heartbeatEnabled ?? null,
    memoryPaused: Object.keys(STATE._memoryPausedFeatures || {}),
  });

  app.get("/api/admin/heartbeat", gate, (req, res) => {
    try {
      return res.json({ ok: true, ...view(getState()) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });

  app.post("/api/admin/heartbeat", gate, (req, res) => {
    try {
      const enabled = req.body?.enabled;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ ok: false, error: "enabled (boolean) required" });
      }
      const STATE = getState();
      if (!STATE.settings) STATE.settings = {};
      const previous = STATE.settings.heartbeatEnabled ?? null;
      STATE.settings.heartbeatEnabled = enabled;
      clearMemoryPause(STATE, ["heartbeatEnabled"]);
      save();
      log("warn", "admin_heartbeat_toggle", { by: req.user?.username || req.user?.id || null, role: req.user?.role || null, previous, current: enabled });
      return res.json({ ok: true, previous, current: enabled, memoryPaused: Object.keys(STATE._memoryPausedFeatures || {}) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: String(e?.message || e) });
    }
  });
}
