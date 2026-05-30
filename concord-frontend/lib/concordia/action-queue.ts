// concord-frontend/lib/concordia/action-queue.ts
//
// Part B (B4) — action chaining. Today a second action verb fired while the
// first is still playing hard-cuts the first's follow-through (or snaps to
// idle). This small queue lets a verb COMMIT its core window, then flushes the
// next queued verb — so harvest→plant, or a quick combo of station actions,
// flows instead of clipping. Pure + tested; AvatarSystem3D holds one instance
// and flushes it from the per-frame loop.
//
// Only the ACTION window is protected (windup+action); the follow-through can be
// interrupted by the next queued verb (a short blend), which is the responsive
// sweet spot — you commit the swing but chain smoothly out of the recovery.

export interface QueuedAction {
  detail: unknown; // the original concordia:action-anim detail, replayed verbatim
}

export interface ActionQueueOpts {
  /** Max queued actions (older ones drop). Default 1 — chain, don't buffer a combo. */
  maxQueue?: number;
}

export class ActionQueue {
  private busyUntil = 0;          // wall-clock ms the current action's protected window ends
  private queue: QueuedAction[] = [];
  private readonly maxQueue: number;

  constructor(opts: ActionQueueOpts = {}) {
    this.maxQueue = Math.max(1, opts.maxQueue ?? 1);
  }

  /**
   * Decide whether a verb plays now or is queued. `protectMs` is how long the
   * current action's core (windup+action) commits before the next can flush.
   * Returns true to PLAY NOW (caller starts the clip); false = enqueued.
   */
  request(detail: unknown, now: number, protectMs: number): boolean {
    if (now >= this.busyUntil) {
      this.busyUntil = now + Math.max(0, protectMs);
      return true;
    }
    // Busy — enqueue (drop oldest beyond the cap so we never build a backlog).
    this.queue.push({ detail });
    while (this.queue.length > this.maxQueue) this.queue.shift();
    return false;
  }

  /**
   * If the protected window has elapsed and something is queued, pop it. The
   * caller replays its detail (re-dispatch the event) and then calls `request`
   * again for it (which re-arms busyUntil). Returns the detail or null.
   */
  flush(now: number): unknown | null {
    if (now < this.busyUntil) return null;
    const next = this.queue.shift();
    return next ? next.detail : null;
  }

  get pending(): number { return this.queue.length; }
  clear(): void { this.queue = []; this.busyUntil = 0; }
}
