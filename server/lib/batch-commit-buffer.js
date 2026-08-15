// server/lib/batch-commit-buffer.js
//
// In-Memory Batch-Commit Buffer for high-frequency writes.
//
// Instead of executing a disk write for every individual combat action,
// transaction turn, or faction shift, the system updates a high-speed local
// Map and flushes the consolidated data changes down to the persistent
// store in one clean, debounced batch block every 2-3 seconds.
//
// Fixes:
//   - Faction affinity DB lock contention (5+ parallel writers all hammering
//     npc_faction_affinity.gd)
//   - Cascading retry storms under load
//   - Event-loop lag spikes from synchronous disk I/O on the hot path

import logger from './logger.js';

export function createBatchCommitBuffer(opts) {
  const {
    flushIntervalMs = 2500,
    maxBufferSize = 10000,
    coalesce = 'sum',
    onFlush,
    onError,
    manual = false,
    maxFlushWaitMs = 10000,
  } = opts;

  const buffer = new Map();
  let flushTimer = null;
  let maxWaitTimer = null;
  let firstEntryTime = 0;
  let isFlushing = false;
  let pendingAfterFlush = false;

  async function flush() {
    if (isFlushing) {
      pendingAfterFlush = true;
      return;
    }
    if (buffer.size === 0) {
      firstEntryTime = 0;
      return;
    }
    isFlushing = true;
    if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }

    const entries = Array.from(buffer.entries()).map(([key, e]) => ({
      key,
      value: e.value,
      updateCount: e.updateCount,
    }));
    buffer.clear();
    firstEntryTime = 0;

    try {
      await onFlush(entries);
    } catch (err) {
      if (onError) onError(err, entries);
      else console.error('[batch-commit] flush failed:', err);
    } finally {
      isFlushing = false;
      if (pendingAfterFlush && buffer.size > 0) {
        pendingAfterFlush = false;
        setImmediate(flush);
      }
    }
  }

  function scheduleFlush() {
    if (manual) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush().catch(() => {});
    }, flushIntervalMs);
    if (flushTimer && flushTimer.unref) flushTimer.unref();

    if (maxFlushWaitMs > 0 && !maxWaitTimer && firstEntryTime > 0) {
      const wait = maxFlushWaitMs - (Date.now() - firstEntryTime);
      if (wait > 0) {
        maxWaitTimer = setTimeout(() => {
          maxWaitTimer = null;
          flush().catch(() => {});
        }, wait);
        if (maxWaitTimer && maxWaitTimer.unref) maxWaitTimer.unref();
      } else {
        flush().catch(() => {});
      }
    }
  }

  return {
    enqueue(key, value) {
      const existing = buffer.get(key);
      if (existing) {
        if (coalesce === 'sum' && typeof existing.value === 'number' && typeof value === 'number') {
          existing.value = existing.value + value;
        } else if (coalesce === 'append' && Array.isArray(existing.value) && Array.isArray(value)) {
          existing.value.push(...value);
        } else {
          existing.value = value;
        }
        existing.lastUpdated = Date.now();
        existing.updateCount++;
      } else {
        buffer.set(key, {
          key,
          value,
          firstSeen: Date.now(),
          lastUpdated: Date.now(),
          updateCount: 1,
        });
        if (firstEntryTime === 0) firstEntryTime = Date.now();
      }

      if (buffer.size >= maxBufferSize) {
        flush().catch(() => {});
      } else {
        scheduleFlush();
      }
    },

    snapshot() {
      return Array.from(buffer.entries()).map(([key, e]) => ({
        key, value: e.value, updateCount: e.updateCount,
      }));
    },

    size() {
      return buffer.size;
    },

    flush,

    stop() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (maxWaitTimer) { clearTimeout(maxWaitTimer); maxWaitTimer = null; }
    },

    start() {
      if (!manual && buffer.size > 0) scheduleFlush();
    },
  };
}

// ── Pre-configured buffers ────────────────────────────────────────────────

let _factionRepBuffer = null;
let factionRepFlushHandler = null;

export function getFactionRepBuffer() {
  if (!_factionRepBuffer) {
    _factionRepBuffer = createBatchCommitBuffer({
      flushIntervalMs: 2500,
      maxBufferSize: 5000,
      coalesce: 'sum',
      onFlush: async (entries) => {
        const grouped = new Map();
        for (const { key, value, updateCount } of entries) {
          const [playerId, factionId] = key.split(':');
          if (!grouped.has(factionId)) grouped.set(factionId, []);
          grouped.get(factionId).push({ playerId, delta: value });
        }
        if (factionRepFlushHandler) {
          await factionRepFlushHandler(grouped);
        }
        logger('info', 'faction_rep_flush', {
          entryCount: entries.length,
          totalUpdates: entries.reduce((s, e) => s + e.updateCount, 0),
          factions: grouped.size,
        });
      },
      onError: (err, entries) => {
        logger('error', 'faction_rep_flush_failed', {
          err: String(err),
          entryCount: entries.length,
        });
      },
    });
  }
  return _factionRepBuffer;
}

export function setFactionRepFlushHandler(handler) {
  factionRepFlushHandler = handler;
}

let _xpBuffer = null;
export function getXpBuffer() {
  if (!_xpBuffer) {
    _xpBuffer = createBatchCommitBuffer({
      flushIntervalMs: 3000,
      maxBufferSize: 10000,
      coalesce: 'sum',
      onFlush: async (entries) => {
        logger('info', 'xp_flush', { playerCount: entries.length });
      },
    });
  }
  return _xpBuffer;
}

let _moneyBuffer = null;
export function getMoneyBuffer() {
  if (!_moneyBuffer) {
    _moneyBuffer = createBatchCommitBuffer({
      flushIntervalMs: 3000,
      maxBufferSize: 10000,
      coalesce: 'sum',
      onFlush: async (entries) => {
        logger('info', 'money_flush', { playerCount: entries.length });
      },
    });
  }
  return _moneyBuffer;
}

export async function flushAllBuffers() {
  const tasks = [];
  if (_factionRepBuffer) tasks.push(_factionRepBuffer.flush());
  if (_xpBuffer) tasks.push(_xpBuffer.flush());
  if (_moneyBuffer) tasks.push(_moneyBuffer.flush());
  await Promise.all(tasks);
}

export default {
  createBatchCommitBuffer,
  getFactionRepBuffer,
  getXpBuffer,
  getMoneyBuffer,
  setFactionRepFlushHandler,
  flushAllBuffers,
};
