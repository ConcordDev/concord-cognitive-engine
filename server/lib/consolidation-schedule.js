// Wall-clock consolidation cadence.
//
// The governor used to run consolidation only when `_tick % 30 === 0`.
// That counter lives in memory, so every restart (and every idle skip)
// threw the cadence away. Eligibility is now "enough wall time since the
// last successful attempt", with the interval equal to the old
// every-N-ticks period so the pace stays the same when the process stays up.

/**
 * @param {object} [opts]
 * @param {number} [opts.heartbeatMs] configured heartbeat period
 * @param {number} [opts.everyTicks] historical tick modulus (TICK_FREQUENCIES.CONSOLIDATION)
 * @param {number|string} [opts.overrideMs] CONCORD_CONSOLIDATION_INTERVAL_MS
 * @param {number} [opts.minHeartbeatMs]
 * @param {number} [opts.maxHeartbeatMs]
 * @returns {number} milliseconds between consolidation passes
 */
export function consolidationIntervalMs({
  heartbeatMs = 60000,
  everyTicks = 30,
  overrideMs,
  minHeartbeatMs = 15000,
  maxHeartbeatMs = 10 * 60 * 1000,
} = {}) {
  const override = Number(overrideMs);
  if (Number.isFinite(override) && override >= 1000) return override;
  const hb = Math.min(
    maxHeartbeatMs,
    Math.max(minHeartbeatMs, Number(heartbeatMs) || 60000),
  );
  const ticks = Math.max(1, Number(everyTicks) || 30);
  return ticks * hb;
}

/**
 * @param {object} opts
 * @param {number} opts.lastRunAt epoch ms of the last attempt (0 = never)
 * @param {number} [opts.now]
 * @param {number} opts.intervalMs
 * @returns {boolean}
 */
export function consolidationIsDue({ lastRunAt, now = Date.now(), intervalMs }) {
  const last = Number(lastRunAt) || 0;
  if (!last) return true;
  const interval = Number(intervalMs);
  if (!Number.isFinite(interval) || interval <= 0) return true;
  return (now - last) >= interval;
}
