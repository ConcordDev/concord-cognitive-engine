// server/domains/offline.js
// Domain actions for offline/sync management: conflict detection and resolution,
// cache strategy optimization, and minimal delta computation.

export default function registerOfflineActions(registerLensAction) {
  /**
   * syncConflict
   * Detect and resolve sync conflicts using CRDT-style merge strategies,
   * last-write-wins with vector clocks, and conflict scoring.
   * artifact.data.replicas = [{ replicaId, state: { key: { value, timestamp, vectorClock?: { [replicaId]: number } } } }]
   * params.strategy = "lww" | "crdt_counter" | "crdt_set" (default "lww")
   */
  registerLensAction("offline", "syncConflict", (ctx, artifact, params) => {
    const replicas = artifact.data?.replicas || [];
    if (replicas.length < 2) return { ok: true, result: { message: "Need at least 2 replicas to detect conflicts." } };

    const strategy = params.strategy || "lww";

    // Collect all keys across replicas
    const allKeys = new Set();
    for (const replica of replicas) {
      for (const key of Object.keys(replica.state || {})) allKeys.add(key);
    }

    const conflicts = [];
    const merged = {};

    // Compare vector clocks: returns -1 (a < b), 0 (concurrent), 1 (a > b)
    function compareVectorClocks(a, b) {
      const aKeys = Object.keys(a || {});
      const bKeys = Object.keys(b || {});
      const allIds = new Set([...aKeys, ...bKeys]);
      let aGreater = false, bGreater = false;
      for (const id of allIds) {
        const aVal = (a || {})[id] || 0;
        const bVal = (b || {})[id] || 0;
        if (aVal > bVal) aGreater = true;
        if (bVal > aVal) bGreater = true;
      }
      if (aGreater && !bGreater) return 1;
      if (bGreater && !aGreater) return -1;
      return 0; // concurrent
    }

    for (const key of allKeys) {
      // Gather entries from all replicas for this key
      const entries = replicas
        .filter(r => r.state && r.state[key] !== undefined)
        .map(r => ({
          replicaId: r.replicaId,
          value: r.state[key].value,
          timestamp: r.state[key].timestamp || 0,
          vectorClock: r.state[key].vectorClock || {},
        }));

      if (entries.length <= 1) {
        merged[key] = entries[0]?.value;
        continue;
      }

      // Check for conflicts: entries are concurrent if vector clocks don't dominate
      const uniqueValues = new Set(entries.map(e => JSON.stringify(e.value)));
      if (uniqueValues.size === 1) {
        merged[key] = entries[0].value;
        continue;
      }

      // We have a conflict — resolve based on strategy
      let resolvedValue, resolution;

      if (strategy === "lww") {
        // Last-write-wins: use vector clock first, fall back to timestamp
        let winner = entries[0];
        for (let i = 1; i < entries.length; i++) {
          const cmp = compareVectorClocks(entries[i].vectorClock, winner.vectorClock);
          if (cmp > 0) {
            winner = entries[i];
          } else if (cmp === 0) {
            // Concurrent — fall back to timestamp
            if ((entries[i].timestamp || 0) > (winner.timestamp || 0)) {
              winner = entries[i];
            } else if (entries[i].timestamp === winner.timestamp) {
              // Tie-break by replica ID (deterministic)
              if (entries[i].replicaId > winner.replicaId) winner = entries[i];
            }
          }
        }
        resolvedValue = winner.value;
        resolution = `lww: replica ${winner.replicaId} wins`;

      } else if (strategy === "crdt_counter") {
        // G-Counter: sum all per-replica max values
        const perReplicaMax = {};
        for (const entry of entries) {
          const val = typeof entry.value === "number" ? entry.value : parseFloat(entry.value) || 0;
          if (!perReplicaMax[entry.replicaId] || val > perReplicaMax[entry.replicaId]) {
            perReplicaMax[entry.replicaId] = val;
          }
        }
        resolvedValue = Object.values(perReplicaMax).reduce((s, v) => s + v, 0);
        resolution = "crdt_counter: summed per-replica maximums";

      } else if (strategy === "crdt_set") {
        // OR-Set (observed-remove): union of all adds, remove only if observed
        const allItems = new Set();
        for (const entry of entries) {
          const items = Array.isArray(entry.value) ? entry.value : [entry.value];
          for (const item of items) allItems.add(typeof item === "object" ? JSON.stringify(item) : item);
        }
        resolvedValue = [...allItems].map(item => {
          try { return JSON.parse(item); } catch { return item; }
        });
        resolution = "crdt_set: union of all observed values";
      }

      // Conflict severity scoring
      const valueDivergence = uniqueValues.size / entries.length;
      const clockConcurrency = entries.filter((e, i) =>
        entries.some((f, j) => i !== j && compareVectorClocks(e.vectorClock, f.vectorClock) === 0)
      ).length / entries.length;
      const severity = Math.round((valueDivergence * 0.6 + clockConcurrency * 0.4) * 100);

      conflicts.push({
        key,
        conflictingValues: entries.map(e => ({ replicaId: e.replicaId, value: e.value, timestamp: e.timestamp })),
        resolvedValue,
        resolution,
        severity,
        severityLevel: severity >= 70 ? "high" : severity >= 40 ? "moderate" : "low",
      });

      merged[key] = resolvedValue;
    }

    // Merge vector clocks
    const mergedClock = {};
    for (const replica of replicas) {
      for (const entry of Object.values(replica.state || {})) {
        for (const [id, val] of Object.entries(entry.vectorClock || {})) {
          mergedClock[id] = Math.max(mergedClock[id] || 0, val);
        }
      }
    }

    artifact.data.mergedState = merged;
    artifact.data.mergedVectorClock = mergedClock;

    return {
      ok: true, result: {
        conflicts,
        mergedState: merged,
        mergedVectorClock: mergedClock,
        strategy,
        summary: {
          totalKeys: allKeys.size,
          conflictCount: conflicts.length,
          conflictRate: Math.round((conflicts.length / Math.max(1, allKeys.size)) * 10000) / 100,
          replicaCount: replicas.length,
          highSeverityConflicts: conflicts.filter(c => c.severityLevel === "high").length,
          avgSeverity: conflicts.length > 0 ? Math.round(conflicts.reduce((s, c) => s + c.severity, 0) / conflicts.length) : 0,
        },
      },
    };
  });

  /**
   * cacheStrategy
   * Optimize cache strategy: compute hot/cold data split, LRU vs LFU analysis,
   * and TTL optimization from access patterns.
   * artifact.data.accessLog = [{ key, timestamp, sizeBytes? }]
   * params.cacheCapacity = max items (default 100)
   */
  registerLensAction("offline", "cacheStrategy", (ctx, artifact, params) => {
    const accessLog = artifact.data?.accessLog || [];
    if (accessLog.length === 0) return { ok: true, result: { message: "No access log to analyze." } };

    const cacheCapacity = params.cacheCapacity || 100;

    // Compute access frequency and recency per key
    const keyStats = {};
    const timestamps = [];
    for (const entry of accessLog) {
      const key = entry.key;
      if (!keyStats[key]) keyStats[key] = { frequency: 0, accesses: [], size: entry.sizeBytes || 1 };
      keyStats[key].frequency++;
      const ts = new Date(entry.timestamp).getTime();
      if (!isNaN(ts)) {
        keyStats[key].accesses.push(ts);
        timestamps.push(ts);
      }
    }

    if (timestamps.length === 0) return { ok: true, result: { message: "No valid timestamps in access log." } };

    const now = Math.max(...timestamps);
    const earliest = Math.min(...timestamps);
    const totalDuration = now - earliest;

    const allKeys = Object.keys(keyStats);

    // Compute recency score and inter-access time for each key
    const keyAnalysis = allKeys.map(key => {
      const stats = keyStats[key];
      const sorted = stats.accesses.sort((a, b) => a - b);
      const lastAccess = sorted[sorted.length - 1];
      const recencyMs = now - lastAccess;

      // Inter-access time (mean gap between consecutive accesses)
      let meanInterAccess = totalDuration;
      if (sorted.length >= 2) {
        const gaps = [];
        for (let i = 1; i < sorted.length; i++) gaps.push(sorted[i] - sorted[i - 1]);
        meanInterAccess = gaps.reduce((s, g) => s + g, 0) / gaps.length;
      }

      // Optimal TTL: slightly above mean inter-access time
      const optimalTtlMs = Math.round(meanInterAccess * 1.5);

      return {
        key,
        frequency: stats.frequency,
        size: stats.size,
        recencyMs,
        lastAccess: new Date(lastAccess).toISOString(),
        meanInterAccessMs: Math.round(meanInterAccess),
        optimalTtlMs,
        optimalTtlSeconds: Math.round(optimalTtlMs / 1000),
      };
    });

    // Hot/cold split: Pareto analysis (80/20 rule)
    const sortedByFreq = [...keyAnalysis].sort((a, b) => b.frequency - a.frequency);
    const totalAccesses = sortedByFreq.reduce((s, k) => s + k.frequency, 0);
    let cumulativeAccess = 0;
    let hotCount = 0;
    for (const key of sortedByFreq) {
      cumulativeAccess += key.frequency;
      hotCount++;
      if (cumulativeAccess >= totalAccesses * 0.8) break;
    }
    const hotKeys = sortedByFreq.slice(0, hotCount).map(k => k.key);
    const coldKeys = sortedByFreq.slice(hotCount).map(k => k.key);

    // LRU simulation
    function simulateLRU(log, capacity) {
      const cache = [];
      let hits = 0;
      for (const entry of log) {
        const idx = cache.indexOf(entry.key);
        if (idx !== -1) {
          hits++;
          cache.splice(idx, 1);
          cache.push(entry.key);
        } else {
          if (cache.length >= capacity) cache.shift();
          cache.push(entry.key);
        }
      }
      return hits;
    }

    // LFU simulation
    function simulateLFU(log, capacity) {
      const cache = new Map(); // key -> frequency
      let hits = 0;
      for (const entry of log) {
        if (cache.has(entry.key)) {
          hits++;
          cache.set(entry.key, cache.get(entry.key) + 1);
        } else {
          if (cache.size >= capacity) {
            // Evict least frequently used
            let minFreq = Infinity, minKey = null;
            for (const [k, f] of cache) {
              if (f < minFreq) { minFreq = f; minKey = k; }
            }
            if (minKey !== null) cache.delete(minKey);
          }
          cache.set(entry.key, 1);
        }
      }
      return hits;
    }

    const lruHits = simulateLRU(accessLog, cacheCapacity);
    const lfuHits = simulateLFU(accessLog, cacheCapacity);

    const lruHitRate = Math.round((lruHits / accessLog.length) * 10000) / 100;
    const lfuHitRate = Math.round((lfuHits / accessLog.length) * 10000) / 100;

    const recommendedPolicy = lfuHitRate > lruHitRate + 2 ? "LFU" : lruHitRate > lfuHitRate + 2 ? "LRU" : "LRU"; // LRU as default tie-breaker

    // Global TTL recommendation
    const meanInterAccess = keyAnalysis.reduce((s, k) => s + k.meanInterAccessMs, 0) / keyAnalysis.length;
    const recommendedTtlSeconds = Math.round((meanInterAccess * 1.5) / 1000);

    return {
      ok: true, result: {
        hotColdSplit: {
          hotKeys: hotKeys.slice(0, 20),
          coldKeys: coldKeys.slice(0, 20),
          hotCount,
          coldCount: coldKeys.length,
          hotAccessShare: Math.round((cumulativeAccess / totalAccesses) * 10000) / 100,
          paretoRatio: `${hotCount}/${allKeys.length} keys serve ${Math.round((cumulativeAccess / totalAccesses) * 100)}% of accesses`,
        },
        evictionPolicy: {
          lru: { hits: lruHits, hitRate: lruHitRate },
          lfu: { hits: lfuHits, hitRate: lfuHitRate },
          recommended: recommendedPolicy,
          improvement: Math.abs(lruHitRate - lfuHitRate),
        },
        ttlOptimization: {
          globalRecommendedTtlSeconds: recommendedTtlSeconds,
          perKeyTtl: keyAnalysis.sort((a, b) => b.frequency - a.frequency).slice(0, 20).map(k => ({
            key: k.key,
            frequency: k.frequency,
            optimalTtlSeconds: k.optimalTtlSeconds,
          })),
        },
        metrics: {
          totalAccesses: accessLog.length,
          uniqueKeys: allKeys.length,
          cacheCapacity,
          avgAccessFrequency: Math.round((totalAccesses / allKeys.length) * 100) / 100,
        },
      },
    };
  });

  /**
   * deltaCompute
   * Compute minimal deltas for sync: diff between states, compress change sets,
   * and estimate bandwidth requirements.
   * artifact.data.baseState = { key: value, ... }
   * artifact.data.currentState = { key: value, ... }
   * params.compressionRatio = estimated compression (default 0.6)
   */
  registerLensAction("offline", "deltaCompute", (ctx, artifact, params) => {
    const baseState = artifact.data?.baseState || {};
    const currentState = artifact.data?.currentState || {};
    const compressionRatio = params.compressionRatio || 0.6;

    const baseKeys = new Set(Object.keys(baseState));
    const currentKeys = new Set(Object.keys(currentState));

    // Compute diffs
    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];

    for (const key of currentKeys) {
      if (!baseKeys.has(key)) {
        added.push({ key, value: currentState[key] });
      } else {
        const baseVal = JSON.stringify(baseState[key]);
        const currVal = JSON.stringify(currentState[key]);
        if (baseVal !== currVal) {
          // Compute granular diff for objects
          let fieldChanges = null;
          if (typeof baseState[key] === "object" && baseState[key] !== null &&
              typeof currentState[key] === "object" && currentState[key] !== null &&
              !Array.isArray(baseState[key]) && !Array.isArray(currentState[key])) {
            fieldChanges = [];
            const allFields = new Set([...Object.keys(baseState[key]), ...Object.keys(currentState[key])]);
            for (const field of allFields) {
              if (!(field in baseState[key])) {
                fieldChanges.push({ field, type: "added", newValue: currentState[key][field] });
              } else if (!(field in currentState[key])) {
                fieldChanges.push({ field, type: "removed", oldValue: baseState[key][field] });
              } else if (JSON.stringify(baseState[key][field]) !== JSON.stringify(currentState[key][field])) {
                fieldChanges.push({ field, type: "modified", oldValue: baseState[key][field], newValue: currentState[key][field] });
              }
            }
          }

          modified.push({
            key,
            oldValue: baseState[key],
            newValue: currentState[key],
            fieldChanges,
            editDistance: computeEditDistance(baseVal, currVal),
          });
        } else {
          unchanged.push(key);
        }
      }
    }

    for (const key of baseKeys) {
      if (!currentKeys.has(key)) {
        removed.push({ key, oldValue: baseState[key] });
      }
    }

    // Levenshtein edit distance for strings
    function computeEditDistance(a, b) {
      if (a.length > 1000 || b.length > 1000) {
        // Approximate for large strings
        return Math.abs(a.length - b.length) + Math.round(Math.min(a.length, b.length) * 0.3);
      }
      const m = a.length, n = b.length;
      const dp = Array.from({ length: m + 1 }, (_, i) => {
        const row = new Array(n + 1);
        row[0] = i;
        return row;
      });
      for (let j = 0; j <= n; j++) dp[0][j] = j;
      for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
          dp[i][j] = a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }
      return dp[m][n];
    }

    // Estimate sizes
    function estimateSize(obj) {
      return new TextEncoder().encode(JSON.stringify(obj)).length;
    }

    const deltaPayload = { added, removed, modified: modified.map(m => ({ key: m.key, newValue: m.newValue, fieldChanges: m.fieldChanges })) };
    const fullStateSize = estimateSize(currentState);
    const deltaSize = estimateSize(deltaPayload);
    const compressedDeltaSize = Math.round(deltaSize * compressionRatio);
    const compressedFullSize = Math.round(fullStateSize * compressionRatio);

    const savings = fullStateSize > 0
      ? Math.round(((fullStateSize - deltaSize) / fullStateSize) * 10000) / 100
      : 0;
    const compressedSavings = compressedFullSize > 0
      ? Math.round(((compressedFullSize - compressedDeltaSize) / compressedFullSize) * 10000) / 100
      : 0;

    // Bandwidth estimate at various speeds
    const speeds = { "3g": 0.75, "4g": 12.5, "wifi": 62.5, "ethernet": 125 }; // MB/s
    const bandwidthEstimate = {};
    for (const [network, speedMBps] of Object.entries(speeds)) {
      bandwidthEstimate[network] = {
        fullSync: Math.round((compressedFullSize / (speedMBps * 1024 * 1024)) * 1000 * 100) / 100,
        deltaSync: Math.round((compressedDeltaSize / (speedMBps * 1024 * 1024)) * 1000 * 100) / 100,
        unit: "ms",
      };
    }

    return {
      ok: true, result: {
        changes: {
          added: added.length,
          removed: removed.length,
          modified: modified.length,
          unchanged: unchanged.length,
          totalKeys: baseKeys.size + added.length,
        },
        delta: {
          addedEntries: added.slice(0, 20),
          removedKeys: removed.map(r => r.key),
          modifications: modified.slice(0, 20).map(m => ({
            key: m.key,
            editDistance: m.editDistance,
            fieldChanges: m.fieldChanges,
          })),
        },
        bandwidth: {
          fullStateSizeBytes: fullStateSize,
          deltaSizeBytes: deltaSize,
          compressedDeltaBytes: compressedDeltaSize,
          compressionRatio,
          deltaSavingsPercent: savings,
          compressedSavingsPercent: compressedSavings,
          networkEstimates: bandwidthEstimate,
        },
        recommendation: deltaSize < fullStateSize * 0.5 ? "delta_sync" : "full_sync",
      },
    };
  });
}
