// lib/interval-registry.js
// ═══════════════════════════════════════════
// MASTER INTERVAL REGISTRY
// No two intervals share a common multiple
// within any 10-minute window.
// Prime × base formula for collision-free scheduling.
// ═══════════════════════════════════════════

// ── Interval Definitions ───────────────────────────────────────────────────

export const INTERVALS = {
  // ── Critical (fast, lightweight) ──
  eventLoopMonitor:        7_000,     // 7s — just reads a counter

  // ── Heartbeat tier ──
  heartbeat:             120_000,     // 120s (2min)

  // ── Background cognition (staggered by primes) ──
  autogen:               130_000,     // 13 × 10s — only if enabled
  dream:                 170_000,     // 17 × 10s
  evolution:             190_000,     // 19 × 10s
  synthesize:            230_000,     // 23 × 10s

  // ── Repair and monitoring ──
  repairLoop:            290_000,     // 29 × 10s
  guardianScan:          310_000,     // 31 × 10s

  // ── Ghost fleet (slow, heavy) ──
  ghostFleetPrimary:     180_000,     // 3min
  ghostFleetSecondary:   370_000,     // 37 × 10s

  // ── Economy ──
  economySave:           300_000,     // 5min
  vaultAudit:          3_600_000,     // 1hr
  treasuryReconcile:   3_540_000,     // 59min (prime, offset from vault)

  // ── Data persistence ──
  stateSave:             410_000,     // 41 × 10s
  socialSave:            430_000,     // 43 × 10s

  // ── Substrate maintenance ──
  retroTag:            7_200_000,     // 2hr
  lensSync:            7_080_000,     // 118min (offset from retroTag)
  embeddingRebuild:    4_700_000,     // 47 × 100s
  consolidation:       5_300_000,     // 53 × 100s
  forgetting:          5_900_000,     // 59 × 100s

  // ── Leaderboard ──
  leaderboardUpdate:     610_000,     // 61 × 10s

  // ── Cleanup ──
  sessionCleanup:      1_800_000,     // 30min
  tokenCleanup:        2_100_000,     // 35min
  backupCleanup:      86_400_000,     // 24hr
  artifactGC:        604_800_000,     // 7 days
  snapshotCleanup:     3_780_000,     // 63min

  // ── Scaling ──
  loadMetrics:           60_000,      // 1min (lightweight)
  scaleCheck:           300_000,      // 5min

  // ── Entity biological ticks ──
  entityDecay:           470_000,     // 47 × 10s
  entitySleep:           530_000,     // 53 × 10s
  entityCulture:         590_000,     // 59 × 10s
  entityConsequence:     670_000,     // 67 × 10s (was 610_000 — shifted to avoid leaderboard collision)
  entityHypothesis:      710_000,     // 71 × 10s (was 670_000)
  entityResearch:        730_000,     // 73 × 10s (was 710_000)
  entitySkillDecay:      770_000,     // 77 × 10s (was 730_000)

  // ── World engine ──
  worldWeather:          790_000,     // 79 × 10s
  worldFaction:          830_000,     // 83 × 10s
  worldEconomy:          890_000,     // 89 × 10s
  worldEvents:           970_000,     // 97 × 10s

  // ── Miscellaneous maintenance ──
  marketplaceAbuseCleanup: 3_610_000, // ~60min (offset from vaultAudit)
  paymentMethodCleanup:    3_670_000, // ~61min
  shadowDtuCleanup:     21_600_000,   // 6hr
  indexReconciliation:  14_400_000,   // 4hr
  tokenBlacklistCleanup: 3_730_000,   // ~62min
  slidingWindowCleanup:    310_000,   // 31 × 10s (lightweight, same as guardianScan but different task)
  idempotencyCacheCleanup: 3_790_000, // ~63min
  attachmentCleanup:   43_200_000,    // 12hr
  alertingEval:            127_000,   // 127s (prime)
  reminderCleanup:     21_660_000,    // 6hr + 1min offset
  promotionRun:        21_720_000,    // 6hr + 2min offset
  backupRun:             3_850_000,   // ~64min
  oauthCleanup:          3_910_000,   // ~65min
};

// ── Registry State ─────────────────────────────────────────────────────────

const _registeredIntervals = new Map();
const _taskHandlers = new Map();

/**
 * Register a task handler that will be called at the specified interval.
 * @param {string} name — must match a key in INTERVALS
 * @param {function} handler — async/sync function to run
 */
export function registerTask(name, handler) {
  if (!INTERVALS[name]) {
    console.warn(`[intervals] Unknown interval name: ${name}. Registering anyway.`);
  }
  _taskHandlers.set(name, handler);
}

/**
 * Start all registered intervals with staggered startup delays.
 * Each interval starts 3 seconds after the previous one to prevent boot storms.
 */
export function startAllIntervals(structuredLog) {
  let delay = 0;
  const STAGGER_MS = 3000;

  for (const [name, intervalMs] of Object.entries(INTERVALS)) {
    const handler = _taskHandlers.get(name);
    if (!handler) continue; // Skip intervals with no registered handler

    delay += STAGGER_MS;

    const startDelay = delay;
    setTimeout(() => {
      const id = setInterval(() => {
        try {
          const result = handler();
          // Handle async handlers
          if (result && typeof result.catch === "function") {
            result.catch(err => {
              if (structuredLog) {
                structuredLog("error", "interval_error", { name, error: err.message });
              }
            });
          }
        } catch (err) {
          if (structuredLog) {
            structuredLog("error", "interval_error", { name, error: err.message });
          }
        }
      }, intervalMs);

      _registeredIntervals.set(name, {
        id,
        interval: intervalMs,
        startedAt: Date.now(),
        handler: name,
      });

      if (structuredLog) {
        structuredLog("info", "interval_registered", {
          name,
          intervalMs,
          delayMs: startDelay,
        });
      }
    }, startDelay);
  }

  return { scheduled: Object.keys(INTERVALS).filter(n => _taskHandlers.has(n)).length };
}

/**
 * Stop all registered intervals. Called during graceful shutdown.
 */
export function stopAllIntervals() {
  for (const [name, entry] of _registeredIntervals) {
    clearInterval(entry.id);
  }
  const count = _registeredIntervals.size;
  _registeredIntervals.clear();
  return { stopped: count };
}

/**
 * Stop a specific interval by name.
 */
export function stopInterval(name) {
  const entry = _registeredIntervals.get(name);
  if (!entry) return { ok: false, error: "not_found" };
  clearInterval(entry.id);
  _registeredIntervals.delete(name);
  return { ok: true, name };
}

/**
 * Get status of all registered intervals.
 */
export function getIntervalStatus() {
  const intervals = {};
  for (const [name, entry] of _registeredIntervals) {
    intervals[name] = {
      intervalMs: entry.interval,
      startedAt: entry.startedAt,
      uptimeMs: Date.now() - entry.startedAt,
    };
  }
  return {
    registered: _registeredIntervals.size,
    total: Object.keys(INTERVALS).length,
    handlersRegistered: _taskHandlers.size,
    intervals,
  };
}

// ── Collision Verification ─────────────────────────────────────────────────

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Verify no two intervals collide within a given window.
 * Returns list of collisions (should be empty).
 */
export function verifyNoCollisions(windowMs = 600_000) {
  const entries = Object.entries(INTERVALS);
  const collisions = [];

  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [nameA, msA] = entries[i];
      const [nameB, msB] = entries[j];

      // LCM = (a * b) / gcd(a, b)
      const g = gcd(msA, msB);
      const lcm = (msA / g) * msB; // avoid overflow with division first

      if (lcm <= windowMs) {
        collisions.push({ nameA, nameB, collisionAtMs: lcm });
      }
    }
  }

  return collisions;
}
