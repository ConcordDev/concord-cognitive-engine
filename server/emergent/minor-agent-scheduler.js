// server/emergent/minor-agent-scheduler.js
// Schedules per-emergent minor agents. Each agent ticks independently.
// One tick at a time per agent (mutex inside EmergentMinorAgent).
// Scheduler failures are isolated — one agent failing doesn't stop others.

import { EmergentMinorAgent } from "./minor-agent.js";

export class MinorAgentScheduler {
  /**
   * @param {object} db - better-sqlite3
   * @param {Function} [realtimeEmit]
   * @param {number} [tickIntervalMs]
   */
  constructor(db, realtimeEmit, tickIntervalMs = 60000) {
    this.db = db;
    this.realtimeEmit = realtimeEmit;
    this.tickIntervalMs = tickIntervalMs;
    this.agents = new Map(); // emergentId → EmergentMinorAgent
    this._timer = null;
    // Bumped 5 → 32 for 32GB / RTX PRO 4500 deployments. The previous
    // 5-concurrent default left agents queueing behind each other even
    // though the GPU and CPU cores were idle. Override via env if you
    // run on smaller hardware.
    this._maxConcurrent = Number(process.env.CONCORD_AGENT_TICK_CONCURRENT) || 32;
  }

  /**
   * Initialize agents for all emergents already in STATE.
   * @param {Map} emergentsMap - STATE.__emergent.emergents
   */
  async initialize(emergentsMap) {
    if (!emergentsMap) return;
    for (const [id, emergentObj] of emergentsMap) {
      await this.addEmergent(id, emergentObj).catch(err =>
        console.error(`[scheduler] init failed for ${id}:`, err?.message)
      );
    }
  }

  /** Register a new emergent with its own minor agent. */
  async addEmergent(emergentId, emergentStateObject = {}) {
    if (this.agents.has(emergentId)) return this.agents.get(emergentId);
    const agent = new EmergentMinorAgent(emergentId, this.db, this.realtimeEmit);
    await agent.initialize(emergentStateObject);
    this.agents.set(emergentId, agent);
    return agent;
  }

  /** Remove an emergent's minor agent (retirement). */
  removeEmergent(emergentId) {
    this.agents.delete(emergentId);
  }

  /** Tick all agents in batches to avoid GPU/CPU pile-up. */
  async tickAll() {
    const entries = [...this.agents.entries()];
    for (let i = 0; i < entries.length; i += this._maxConcurrent) {
      const batch = entries.slice(i, i + this._maxConcurrent);
      await Promise.allSettled(
        batch.map(([id, agent]) =>
          agent.tick().catch(err =>
            console.error(`[scheduler] agent ${id} tick threw:`, err?.message)
          )
        )
      );
    }
  }

  /** Start the periodic tick loop. Timer is unreferenced to allow process exit in tests. */
  start() {
    if (this._timer) return;
    this._timer = setInterval(() => this.tickAll(), this.tickIntervalMs);
    this._timer.unref?.();
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  /** Number of active agents. */
  get size() { return this.agents.size; }

  /** Get agent by emergent ID. */
  getAgent(emergentId) { return this.agents.get(emergentId) || null; }
}

// Singleton — created once at server startup and imported by server.js
export const minorAgentScheduler = new MinorAgentScheduler(null, null);
