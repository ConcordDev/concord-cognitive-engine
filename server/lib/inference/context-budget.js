// server/lib/inference/context-budget.js
// Tracks token consumption per inference step and signals when to crystallize.

/**
 * Per-brain effective token budgets. Crystallization triggers at 75% to leave
 * room for the continuation prompt and subconscious summary call.
 */
export const BRAIN_CAPACITIES = {
  'concord-conscious:latest': { contextWindow: 32768, effectiveBudget: 24576 },
  'qwen2.5:14b':  { contextWindow: 32768, effectiveBudget: 24576 },
  'qwen2.5:7b':   { contextWindow: 32768, effectiveBudget: 24576 },
  'qwen2.5:3b':   { contextWindow: 32768, effectiveBudget: 24576 },
  'qwen2.5:1.5b': { contextWindow: 32768, effectiveBudget: 24576 },
  'llava:7b':     { contextWindow: 32768, effectiveBudget: 22528 },
};

/**
 * Resolve effective budget for a model name (partial match).
 * @param {string} modelName
 * @returns {number}
 */
export function getBrainBudget(modelName) {
  if (!modelName) return 24576;
  const lower = modelName.toLowerCase();
  for (const [key, val] of Object.entries(BRAIN_CAPACITIES)) {
    if (lower.includes(key.toLowerCase())) return val.effectiveBudget;
  }
  return 24576;
}

export class ContextBudgetTracker {
  /**
   * @param {number} capacity - Effective token budget for this reasoning session
   */
  constructor(capacity) {
    this.capacity = capacity;
    this.consumed = 0;
    this.crystallizationThreshold = 0.75;
    this.warningThreshold = 0.65;
    this.crystallizationCount = 0;
  }

  /**
   * Record tokens from one inference step.
   * @param {{ tokensIn?: number, tokensOut?: number }} step
   * @returns {{ remaining: number, utilization: number, shouldCrystallize: boolean, shouldWarn: boolean }}
   */
  trackStep(step) {
    this.consumed += (step.tokensIn || 0) + (step.tokensOut || 0);
    const utilization = this.capacity > 0 ? this.consumed / this.capacity : 0;
    return {
      remaining: this.capacity - this.consumed,
      utilization,
      shouldCrystallize: utilization >= this.crystallizationThreshold,
      shouldWarn: utilization >= this.warningThreshold,
    };
  }

  /** Reset consumption counter after crystallization. */
  reset() {
    this.consumed = 0;
    this.crystallizationCount++;
  }

  get totalCrystallizations() {
    return this.crystallizationCount;
  }
}
