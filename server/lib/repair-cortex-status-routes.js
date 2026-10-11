// Admin repair-cortex status routes. Registered from server.js.
// Owner (and sovereign, via requireRole) only. Members and anonymous callers
// never receive signature counts.

export function registerRepairCortexStatusRoutes(app, {
  requireAuth,
  requireRole,
  repairState,
  brain,
  getErrorAccumulator,
  getRepairMemoryStats,
  getRepairObservationStatus,
  getFullRepairStatus,
}) {
  app.get("/api/admin/repair/status", requireAuth(), requireRole("owner"), (_req, res) => {
    res.json({
      sleeping: repairState.sleeping,
      currentFix: repairState.currentFix,
      totalFixes: repairState.totalFixes,
      knownPatterns: repairState.knownPatterns.length,
      consecutiveFailures: repairState.consecutiveFailures,
      maxConsecutiveFailures: repairState.maxConsecutiveFailures,
      recentFixes: repairState.fixHistory.slice(-20),
      repairBrainOnline: brain.repair.enabled,
      cortex: {
        errorAccumulator: getErrorAccumulator(),
        repairMemory: getRepairMemoryStats(),
        observations: getRepairObservationStatus(),
      },
    });
  });

  app.get("/api/admin/repair/full-status", requireAuth(), requireRole("owner"), (_req, res) => {
    res.json(getFullRepairStatus());
  });
}
