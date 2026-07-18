/**
 * Qualia Engine — Runtime for the Existential OS
 *
 * Maintains live qualia state for each entity (emergent, session, or system).
 * Each entity has a set of active operating systems whose numeric channels
 * represent continuous experiential state (0-1 floats).
 *
 * Storage: STATE.qualia (Map). In-memory only. No database tables.
 * Failure mode: silent. Engine never crashes the host process.
 */

import { existentialOS, getExistentialOS } from "./registry.js";
import logger from '../logger.js';

const HISTORY_MAX = 50; // Rolling window of past snapshots

/**
 * Clamp a value to [lo, hi].
 */
function clamp(v, lo = 0, hi = 1) {
  return Math.max(lo, Math.min(hi, v));
}

export class QualiaEngine {
  /**
   * @param {object} STATE - Global server STATE object
   */
  constructor(STATE) {
    this._STATE = STATE;
    if (!this._STATE.qualia) {
      this._STATE.qualia = new Map();
    }
  }

  /** @returns {Map} The qualia store */
  get _store() {
    if (!this._STATE.qualia) this._STATE.qualia = new Map();
    return this._STATE.qualia;
  }

  /**
   * Initialize a qualia state for an entity.
   * If no OS keys provided, activate Tier 0 + Tier 5 by default.
   *
   * @param {string} entityId
   * @param {string[]} [activeOSKeys]
   * @returns {{ ok: boolean, entityId: string }}
   */
  createQualiaState(entityId, activeOSKeys) {
    if (!entityId) return { ok: false, error: "entityId required" };

    const defaultKeys = [
      "truth_os", "logic_os",                                    // Tier 0
      "meta_growth_os", "self_repair_os", "reflection_os",       // Tier 5
    ];
    const keys = activeOSKeys && activeOSKeys.length > 0 ? activeOSKeys : defaultKeys;

    const channels = {};
    const activeOS = [];

    for (const key of keys) {
      const os = getExistentialOS(key);
      if (!os) continue;
      activeOS.push(key);
      for (const ch of os.numeric_channels) {
        channels[`${key}.${ch}`] = 0;
      }
    }

    const state = {
      entityId,
      activeOS,
      channels,
      lastUpdated: new Date().toISOString(),
      history: [],
    };

    this._store.set(entityId, state);
    return { ok: true, entityId };
  }

  /**
   * Update a single channel value. Clamp to valid range. Check policies.
   *
   * @param {string} entityId
   * @param {string} osKey
   * @param {string} channelName
   * @param {number} value
   * @returns {{ ok: boolean, policyTriggered?: object }}
   */
  updateChannel(entityId, osKey, channelName, value) {
    const state = this._store.get(entityId);
    if (!state) return { ok: false, error: "entity_not_found" };

    const fullKey = `${osKey}.${channelName}`;
    const clamped = clamp(Number(value) || 0);

    state.channels[fullKey] = clamped;
    state.lastUpdated = new Date().toISOString();

    // Check for policy threshold crossings
    const policyTriggered = this._checkPolicies(entityId, osKey, channelName, clamped);

    return { ok: true, policyTriggered: policyTriggered || undefined };
  }

  /**
   * Batch update multiple channels at once.
   *
   * @param {string} entityId
   * @param {Record<string, number>} updates - e.g. { "truth_os.evidence_weight": 0.9 }
   * @returns {{ ok: boolean, updated: number, policyEvents: object[] }}
   */
  batchUpdate(entityId, updates) {
    const state = this._store.get(entityId);
    if (!state) return { ok: false, error: "entity_not_found" };
    if (!updates || typeof updates !== "object") return { ok: false, error: "updates required" };

    const policyEvents = [];
    let updated = 0;

    for (const [fullKey, value] of Object.entries(updates)) {
      const clamped = clamp(Number(value) || 0);
      state.channels[fullKey] = clamped;
      updated++;

      // Extract osKey and channelName
      const dotIdx = fullKey.indexOf(".");
      if (dotIdx > 0) {
        const osKey = fullKey.slice(0, dotIdx);
        const channelName = fullKey.slice(dotIdx + 1);
        const policy = this._checkPolicies(entityId, osKey, channelName, clamped);
        if (policy) policyEvents.push(policy);
      }
    }

    state.lastUpdated = new Date().toISOString();
    return { ok: true, updated, policyEvents };
  }

  /**
   * Return current full qualia state for an entity.
   *
   * @param {string} entityId
   * @returns {object|null}
   */
  getQualiaState(entityId) {
    const state = this._store.get(entityId);
    if (!state) return null;
    return { ...state, channels: { ...state.channels } };
  }

  /**
   * Return a single channel value.
   *
   * @param {string} entityId
   * @param {string} osKey
   * @param {string} channelName
   * @returns {number|null}
   */
  getChannel(entityId, osKey, channelName) {
    const state = this._store.get(entityId);
    if (!state) return null;
    const val = state.channels[`${osKey}.${channelName}`];
    return val !== undefined ? val : null;
  }

  /**
   * Compressed summary — average intensity per OS, policy violations,
   * dominant OS (highest average). This is what gets attached to DTUs.
   *
   * @param {string} entityId
   * @returns {object|null}
   */
  getQualiaSummary(entityId) {
    const state = this._store.get(entityId);
    if (!state) return null;

    const osSummaries = {};
    const policyAlerts = [];

    for (const osKey of state.activeOS) {
      const os = getExistentialOS(osKey);
      if (!os) continue;

      const channelValues = [];
      for (const ch of os.numeric_channels) {
        const val = state.channels[`${osKey}.${ch}`];
        if (val !== undefined) channelValues.push(val);
      }

      const avg = channelValues.length > 0
        ? channelValues.reduce((a, b) => a + b, 0) / channelValues.length
        : 0;

      osSummaries[osKey] = {
        label: os.label,
        category: os.category,
        avgIntensity: Math.round(avg * 1000) / 1000,
        channelCount: channelValues.length,
      };

      // Check policies for alerts
      if (os.policies) {
        for (const [policyKey, threshold] of Object.entries(os.policies)) {
          // Policy keys look like: "alert_when_uncertainty_above" → channel "uncertainty_score"
          // We extract what we can and check values
          for (const ch of os.numeric_channels) {
            if (policyKey.includes(ch.replace(/_/g, "_"))) {
              const val = state.channels[`${osKey}.${ch}`];
              const isAbove = policyKey.includes("above") || policyKey.includes("when_");
              const isBelow = policyKey.includes("below");
              if (isAbove && val > threshold) {
                policyAlerts.push({ os: osKey, policy: policyKey, channel: ch, value: val, threshold });
              } else if (isBelow && val < threshold) {
                policyAlerts.push({ os: osKey, policy: policyKey, channel: ch, value: val, threshold });
              }
            }
          }
        }
      }
    }

    // Find dominant OS
    let dominantOS = null;
    let maxAvg = -1;
    for (const [key, summary] of Object.entries(osSummaries)) {
      if (summary.avgIntensity > maxAvg) {
        maxAvg = summary.avgIntensity;
        dominantOS = key;
      }
    }

    return {
      entityId: state.entityId,
      dominantOS,
      osSummaries,
      policyAlerts,
      activeOSCount: state.activeOS.length,
      totalChannels: Object.keys(state.channels).length,
      lastUpdated: state.lastUpdated,
    };
  }

  /**
   * Activate an OS for an entity. Initialize its channels to 0.
   *
   * @param {string} entityId
   * @param {string} osKey
   * @returns {{ ok: boolean }}
   */
  activateOS(entityId, osKey) {
    const state = this._store.get(entityId);
    if (!state) return { ok: false, error: "entity_not_found" };

    const os = getExistentialOS(osKey);
    if (!os) return { ok: false, error: "os_not_found" };

    if (!state.activeOS.includes(osKey)) {
      state.activeOS.push(osKey);
    }

    for (const ch of os.numeric_channels) {
      const key = `${osKey}.${ch}`;
      if (state.channels[key] === undefined) {
        state.channels[key] = 0;
      }
    }

    state.lastUpdated = new Date().toISOString();
    return { ok: true, activated: osKey };
  }

  /**
   * Deactivate an OS. Preserve last values in history before removing.
   *
   * @param {string} entityId
   * @param {string} osKey
   * @returns {{ ok: boolean }}
   */
  deactivateOS(entityId, osKey) {
    const state = this._store.get(entityId);
    if (!state) return { ok: false, error: "entity_not_found" };

    const os = getExistentialOS(osKey);
    if (!os) return { ok: false, error: "os_not_found" };

    // Snapshot current values before deactivating
    const lastValues = {};
    for (const ch of os.numeric_channels) {
      const key = `${osKey}.${ch}`;
      if (state.channels[key] !== undefined) {
        lastValues[key] = state.channels[key];
        delete state.channels[key];
      }
    }

    state.activeOS = state.activeOS.filter((k) => k !== osKey);

    // Record in history
    state.history.push({
      type: "deactivation",
      osKey,
      lastValues,
      timestamp: new Date().toISOString(),
    });
    if (state.history.length > HISTORY_MAX) {
      state.history = state.history.slice(-HISTORY_MAX);
    }

    state.lastUpdated = new Date().toISOString();
    return { ok: true, deactivated: osKey };
  }

  /**
   * Snapshot current state to history. Used before major operations.
   *
   * @param {string} entityId
   * @returns {{ ok: boolean }}
   */
  snapshotQualia(entityId) {
    const state = this._store.get(entityId);
    if (!state) return { ok: false, error: "entity_not_found" };

    state.history.push({
      type: "snapshot",
      channels: { ...state.channels },
      activeOS: [...state.activeOS],
      timestamp: new Date().toISOString(),
    });

    if (state.history.length > HISTORY_MAX) {
      state.history = state.history.slice(-HISTORY_MAX);
    }

    return { ok: true, snapshotCount: state.history.length };
  }

  /**
   * Get all entity IDs with qualia states.
   *
   * @returns {string[]}
   */
  listEntities() {
    return Array.from(this._store.keys());
  }

  /**
   * Get summaries for all entities (dashboard view).
   *
   * @returns {object[]}
   */
  getAllSummaries() {
    const summaries = [];
    for (const entityId of this._store.keys()) {
      const s = this.getQualiaSummary(entityId);
      if (s) summaries.push(s);
    }
    return summaries;
  }

  /**
   * Export raw channel values for EVERY entity, keyed by entityId:
   *   { entityId: { "os.channel": number, ... }, ... }
   *
   * This is the exact shape `hooks.persistQualiaState` upserts into
   * `qualia_state` and logs deltas into `qualia_log`. That heartbeat prefers
   * `engine.snapshot()` — which never existed, so it silently returned
   * `no_snapshot_export` every tick and NO qualia state ever reached the DB (it
   * lived only in memory and evaporated on restart, and no trajectory/log was
   * ever written). Implementing it here closes that dead wire. Returns a plain
   * object (a shallow copy of each channel map) so the persist path can
   * `Object.keys()` it and can't mutate live state.
   *
   * @returns {Record<string, Record<string, number>>}
   */
  snapshot() {
    const out = {};
    for (const [entityId, state] of this._store.entries()) {
      if (state && state.channels && typeof state.channels === "object") {
        out[entityId] = { ...state.channels };
      }
    }
    return out;
  }

  /**
   * Check policy thresholds for a given channel update.
   * Returns an event object if a policy was triggered, null otherwise.
   *
   * @private
   */
  _checkPolicies(entityId, osKey, channelName, value) {
    const os = getExistentialOS(osKey);
    if (!os || !os.policies) return null;

    for (const [policyKey, threshold] of Object.entries(os.policies)) {
      // Match policy to channel: policies reference channels by partial name
      if (!policyKey.includes(channelName.replace(/_score$/, "").replace(/_index$/, "").replace(/_level$/, ""))) {
        continue;
      }

      const isAbove = policyKey.includes("above") || policyKey.includes("when_");
      const isBelow = policyKey.includes("below");

      if ((isAbove && !isBelow && value > threshold) || (isBelow && value < threshold)) {
        const event = {
          type: "qualia.policy_triggered",
          entityId,
          os: osKey,
          policy: policyKey,
          channel: channelName,
          value,
          threshold,
          timestamp: new Date().toISOString(),
        };

        // Emit to global event system if available (best-effort)
        try {
          if (typeof globalThis.realtimeEmit === "function") {
            globalThis.realtimeEmit("qualia:policy", event);
          }
        } catch (_e) { logger.debug('engine', 'silent', { error: _e?.message }); }

        return event;
      }
    }

    return null;
  }
}
