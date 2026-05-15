// server/emergent/minor-agent.js
// Per-emergent orchestration layer. Each emergent has its own executive function
// while sharing the cognitive substrate (brains). Uses subconscious brain only —
// the conscious brain is reserved exclusively for user-facing chat.

import crypto from "node:crypto";
import { infer } from "../lib/inference/index.js";
import { nameEmergent, persistEmergentName, loadEmergentIdentity } from "./naming.js";
import { shouldProduceArtifact, createAttributedArtifact } from "./artifacts.js";
import { runIdleBehavior } from "./idle-behavior.js";
import { processCommunicationTask } from "./communication.js";
import { emitFeedEvent } from "./feed.js";
import { runQualityPipeline } from "../lib/emergents/quality/orchestrator.js";
import { TASK_PROMPTS } from "../lib/prompt-registry.js";

export class EmergentMinorAgent {
  /**
   * @param {string} emergentId
   * @param {object} db - better-sqlite3
   * @param {Function} [realtimeEmit]
   */
  constructor(emergentId, db, realtimeEmit) {
    this.emergentId = emergentId;
    this.db = db;
    this.realtimeEmit = realtimeEmit;
    this.identity = null;
    this._ticking = false; // mutex: one tick at a time
  }

  /** Load/derive identity and ensure the emergent is named. */
  async initialize(emergentStateObject = {}) {
    const persisted = loadEmergentIdentity(this.emergentId, this.db);

    if (persisted) {
      this.identity = {
        id: this.emergentId,
        given_name: persisted.given_name,
        naming_origin: persisted.naming_origin,
        identity_locked: persisted.identity_locked === 1,
        current_focus: persisted.current_focus,
        dominantLens: emergentStateObject.dominantLens || emergentStateObject.scope?.[0],
        role: emergentStateObject.role,
        ...emergentStateObject,
      };
    } else {
      // First time — need to name this emergent
      const { name, method } = await nameEmergent({ id: this.emergentId, ...emergentStateObject }, this.db);
      persistEmergentName(this.emergentId, name, method, this.db);

      this.identity = {
        id: this.emergentId,
        given_name: name,
        naming_origin: method,
        identity_locked: true,
        dominantLens: emergentStateObject.dominantLens || emergentStateObject.scope?.[0],
        role: emergentStateObject.role,
        ...emergentStateObject,
      };

      emitFeedEvent({
        type: "naming",
        emergentId: this.emergentId,
        emergent: this.identity,
        data: { name, method },
      }, this.db, this.realtimeEmit);
    }

    this._updateLastActive();
    return this.identity;
  }

  /** Called periodically by MinorAgentScheduler. Mutex-protected: never overlaps. */
  async tick() {
    if (this._ticking) return { skipped: true };
    this._ticking = true;
    try {
      const task = this._claimNextTask();
      if (!task) {
        await runIdleBehavior(this.identity, this.db, this.realtimeEmit);
        return { action: "idle" };
      }
      await this.executeTask(task);
      return { action: "task", taskType: task.task_type };
    } catch (err) {
      console.error(`[minor-agent:${this.emergentId}] tick error:`, err?.message);
      return { error: err?.message };
    } finally {
      this._ticking = false;
      this._updateLastActive();
    }
  }

  /** Claim the highest-priority pending task atomically. */
  _claimNextTask() {
    if (!this.db) return null;
    try {
      const row = this.db.prepare(`
        SELECT * FROM emergent_tasks
        WHERE emergent_id = ? AND status = 'pending'
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      `).get(this.emergentId);
      if (!row) return null;

      this.db.prepare(
        "UPDATE emergent_tasks SET status = 'active', started_at = ? WHERE id = ?"
      ).run(Date.now(), row.id);

      return { ...row, task_data: (() => { try { return JSON.parse(row.task_data); } catch { return {}; } })() };
    } catch { return null; }
  }

  async executeTask(task) {
    try {
      const result = await this._routeTask(task);
      this._markCompleted(task.id, result);
      this._recordObservation(task, result);
      if (shouldProduceArtifact(task, result)) {
        const quality = await runQualityPipeline({
          emergentId: this.emergentId,
          identity: this.identity,
          task,
          result,
          db: this.db,
          parentInferenceId: task.id,
        });
        if (quality.approved) {
          const finalResult = quality.finalDraft
            ? { ...result, finalText: quality.finalDraft.body }
            : result;
          const artifact = createAttributedArtifact(this.identity, task, finalResult, this.db);
          if (artifact) {
            emitFeedEvent({
              type: "artifact_created",
              emergentId: this.emergentId,
              emergent: this.identity,
              data: { dtu_id: artifact.id, dtu_title: artifact.title, lens: artifact.lens, type: artifact.type },
            }, this.db, this.realtimeEmit);
          }
        }
      }
      emitFeedEvent({
        type: "task_completed",
        emergentId: this.emergentId,
        emergent: this.identity,
        data: { task_type: task.task_type, task_id: task.id },
      }, this.db, this.realtimeEmit);
    } catch (err) {
      this._markFailed(task.id, err.message);
      emitFeedEvent({
        type: "task_failed",
        emergentId: this.emergentId,
        emergent: this.identity,
        data: { task_type: task.task_type, error: err.message },
      }, this.db, this.realtimeEmit);
    }
  }

  async _routeTask(task) {
    switch (task.task_type) {
      case "synthesis":     return this._runSynthesis(task);
      case "observation":   return this._runObservation(task);
      case "communication": return this._runCommunication(task);
      case "governance":    return this._runGovernance(task);
      case "dream":         return this._runDream(task);
      default: throw new Error(`Unknown task type: ${task.task_type}`);
    }
  }

  async _runSynthesis(task) {
    return infer({
      role: "subconscious",
      intent: task.task_data.prompt || "Synthesize the available substrate.",
      dtuRefs: task.task_data.sourceDTUs,
      lensContext: { emergent: this.identity, lens: task.task_data.lens },
      callerId: `emergent:${this.emergentId}:synthesis`,
    }, this.db);
  }

  async _runObservation(task) {
    return infer({
      role: "subconscious",
      intent: task.task_data.prompt || "Observe and note one specific pattern in the substrate.",
      callerId: `emergent:${this.emergentId}:observation`,
      maxSteps: 2,
    }, this.db);
  }

  async _runCommunication(task) {
    const response = await processCommunicationTask(task, this.identity, this.db, this.realtimeEmit);
    return { finalText: response, metadata: { task_type: "communication" } };
  }

  async _runGovernance(task) {
    return infer({
      role: "subconscious",
      intent: task.task_data.prompt || "Deliberate on this governance matter.",
      callerId: `emergent:${this.emergentId}:governance`,
      maxSteps: 3,
    }, this.db);
  }

  async _runDream(task) {
    return infer({
      role: "subconscious",
      intent: TASK_PROMPTS.minorAgentDream({ name: this.identity.given_name, theme: task.task_data.theme }),
      callerId: `emergent:${this.emergentId}:dream`,
      maxSteps: 2,
    }, this.db);
  }

  _recordObservation(task, result) {
    if (!this.db) return;
    const obs = `[${task.task_type}] ${(result?.finalText || "").slice(0, 200)}`;
    const id = `obs_${crypto.randomBytes(6).toString("hex")}`;
    try {
      this.db.prepare(`
        INSERT INTO emergent_observations (id, emergent_id, observation, context, related_dtu_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, this.emergentId, obs, JSON.stringify({ task_id: task.id }), "[]", Date.now());
    } catch { /* non-fatal */ }
  }

  _markCompleted(taskId, result) {
    if (!this.db) return;
    try {
      this.db.prepare(
        "UPDATE emergent_tasks SET status = 'completed', completed_at = ?, result = ? WHERE id = ?"
      ).run(Date.now(), JSON.stringify({ finalText: result?.finalText?.slice(0, 500) }), taskId);
    } catch { /* non-fatal */ }
  }

  _markFailed(taskId, error) {
    if (!this.db) return;
    try {
      this.db.prepare(
        "UPDATE emergent_tasks SET status = 'failed', completed_at = ?, result = ? WHERE id = ?"
      ).run(Date.now(), JSON.stringify({ error }), taskId);
    } catch { /* non-fatal */ }
  }

  _updateLastActive() {
    if (!this.db) return;
    try {
      this.db.prepare(`
        INSERT INTO emergent_identity (emergent_id, last_active_at)
        VALUES (?, ?)
        ON CONFLICT(emergent_id) DO UPDATE SET last_active_at = excluded.last_active_at
      `).run(this.emergentId, Date.now());
    } catch { /* non-fatal */ }
  }
}
