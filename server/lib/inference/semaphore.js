// server/lib/inference/semaphore.js
// VRAM choreography — tracks which brains are warm/cold and manages loading priority.
// Uses static VRAM budgets from BRAIN_CONFIG; does not query GPU directly.

import { BRAIN_CONFIG } from "../brain-config.js";
import { LruMap, LruSet } from "../lru-map.js";

const VRAM_BUDGET_GB = parseFloat(process.env.VRAM_BUDGET_GB || "32");

const BRAIN_VRAM_GB = {
  repair:       1,   // qwen2.5:0.5b
  utility:      3,   // qwen2.5:3b
  subconscious: 7,   // qwen2.5:7b
  multimodal:   13,  // llava:13b
  conscious:    14,  // qwen2.5:14b / fine-tune
};

// Runtime state
const _warmBrains = new Set(["repair", "utility"]); // always hot
const _inflightCounts = new LruMap(); // brainName → number of concurrent calls
const _waiters = [];                // callbacks waiting for capacity

/**
 * Estimate current VRAM usage based on warm brains.
 * @returns {number} GB
 */
function currentVramUsage() {
  let total = 0;
  for (const brain of _warmBrains) {
    total += BRAIN_VRAM_GB[brain] || 0;
  }
  return total;
}

/**
 * Check if a brain can be loaded without exceeding budget.
 * @param {string} brainName
 * @returns {boolean}
 */
function canFit(brainName) {
  if (_warmBrains.has(brainName)) return true;
  const needed = BRAIN_VRAM_GB[brainName] || 0;
  return currentVramUsage() + needed <= VRAM_BUDGET_GB;
}

/**
 * Evict the lowest-priority warm brain that isn't currently in use.
 * Returns the evicted brain name, or null if nothing could be evicted.
 * @returns {string|null}
 */
function evictLowPriority() {
  // Sort by ascending priority (higher number = lower priority)
  const evictCandidates = [..._warmBrains]
    .filter(b => !["repair", "utility"].includes(b)) // never evict always-hot brains
    .filter(b => (_inflightCounts.get(b) || 0) === 0)
    .sort((a, b) => (BRAIN_CONFIG[b]?.priority ?? 2) - (BRAIN_CONFIG[a]?.priority ?? 2));

  if (evictCandidates.length === 0) return null;
  const evict = evictCandidates[0];
  _warmBrains.delete(evict);
  return evict;
}

/**
 * Acquire a semaphore slot for a brain call.
 * Marks brain as warm; evicts if needed.
 *
 * @param {string} brainName
 * @returns {{ release: Function }}
 */
export async function acquire(brainName) {
  const config = BRAIN_CONFIG[brainName];
  const maxConcurrent = config?.maxConcurrent || 2;

  // Wait until concurrency slot available
  await new Promise((resolve) => {
    function tryAcquire() {
      const inflight = _inflightCounts.get(brainName) || 0;
      if (inflight < maxConcurrent) {
        resolve();
      } else {
        _waiters.push({ brainName, resolve: tryAcquire });
      }
    }
    tryAcquire();
  });

  // Ensure brain is warm
  if (!_warmBrains.has(brainName)) {
    while (!canFit(brainName)) {
      const evicted = evictLowPriority();
      if (!evicted) break; // can't evict anything; proceed anyway
    }
    _warmBrains.add(brainName);
  }

  _inflightCounts.set(brainName, (_inflightCounts.get(brainName) || 0) + 1);

  return {
    release() {
      const count = Math.max(0, (_inflightCounts.get(brainName) || 1) - 1);
      _inflightCounts.set(brainName, count);

      // Wake any waiters for this brain
      const idx = _waiters.findIndex(w => w.brainName === brainName);
      if (idx !== -1) {
        const [waiter] = _waiters.splice(idx, 1);
        waiter.resolve();
      }
    },
  };
}

/**
 * @returns {{ warmBrains: string[], vramUsedGB: number, vramBudgetGB: number, inflight: Object }}
 */
export function getVramState() {
  return {
    warmBrains: [..._warmBrains],
    vramUsedGB: currentVramUsage(),
    vramBudgetGB: VRAM_BUDGET_GB,
    inflight: Object.fromEntries(_inflightCounts),
  };
}
