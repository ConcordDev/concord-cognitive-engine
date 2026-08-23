// lib/adaptive-brain-router.js
// Dynamically adjusts brain configurations based on system load

import { systemMonitor } from './brain-config.js';
import { BRAIN_CONFIG } from './brain-config.js';
import { SYSTEM_TO_BRAIN, BRAIN_PRIORITY } from './brain-config.js';

class AdaptiveBrainRouter {
  constructor() {
    this.baseConfig = BRAIN_CONFIG;
    this.currentSettings = null;
    this.lastAdjustment = Date.now();
    this.adjustmentCooldown = 30000; // 30 seconds between adjustments
    this.requestQueue = new Map(); // brain -> queue
    this.inflight = new Map(); // brain -> count
  }

  getActiveConfig() {
    if (!systemMonitor.metrics.memory.total) {
      // Fallback to default config if monitor hasn't run yet
      return this.baseConfig;
    }

    const settings = systemMonitor.getRecommendedSettings();
    const stress = systemMonitor.getSystemStressLevel();
    const stressScore = stress.score;

    // Only adjust every cooldown period
    const now = Date.now();
    if (!this.currentSettings || now - this.lastAdjustment > this.adjustmentCooldown) {
      this.currentSettings = this.calculateScaledConfig(settings);
      this.lastAdjustment = now;
    }

    return this.currentSettings || this.baseConfig;
  }

  calculateScaledConfig(settings) {
    const base = this.baseConfig;
    const { contextScale, concurrentLimit, timeoutScale } = settings;
    const stress = systemMonitor.getSystemStressLevel();
    const levels = stress.levels;

    const scaled = {};

    for (const [brainName, cfg] of Object.entries(base)) {
      // Critical brain (repair) always gets priority
      if (brainName === 'repair' && stress.score < 80) {
        scaled[brainName] = { ...cfg, active: true };
        continue;
      }

      // Critical brain under extreme stress
      if (brainName === 'repair' && stress.score >= 80) {
        scaled[brainName] = {
          ...cfg,
          active: true,
          contextWindow: Math.floor(2048 * contextScale),
          maxConcurrent: Math.max(2, Math.floor(cfg.maxConcurrent * concurrentLimit)),
          timeout: Math.floor(cfg.timeout * timeoutScale)
        };
        continue;
      }

      // Conscious brain (user-facing) - preserve but scale
      if (brainName === 'conscious') {
        const active = stress.score < 90; // Keep alive up to critical
        scaled[brainName] = {
          ...cfg,
          active,
          contextWindow: Math.floor(cfg.contextWindow * Math.max(0.5, contextScale)),
          maxConcurrent: Math.max(4, Math.floor(cfg.maxConcurrent * Math.max(0.5, concurrentLimit))),
          timeout: Math.floor(cfg.timeout * timeoutScale)
        };
        continue;
      }

      // Utility brain (most frequent) - scale aggressively
      if (brainName === 'utility') {
        const active = stress.score < 85;
        scaled[brainName] = {
          ...cfg,
          active,
          // Utility can be scaled down significantly since it handles support tasks
          contextWindow: Math.floor(cfg.contextWindow * Math.max(0.25, contextScale)),
          maxConcurrent: Math.max(2, Math.floor(cfg.maxConcurrent * Math.max(0.25, concurrentLimit))),
          timeout: Math.floor(cfg.timeout * timeoutScale)
        };
        continue;
      }

      // Subconscious brain (background) - scale heavily
      if (brainName === 'subconscious') {
        const active = stress.score < 70; // Deactivate under moderate load
        scaled[brainName] = {
          ...cfg,
          active,
          contextWindow: Math.floor(cfg.contextWindow * Math.max(0.25, contextScale)),
          maxConcurrent: Math.max(2, Math.floor(cfg.maxConcurrent * Math.max(0.25, concurrentLimit))),
          timeout: Math.floor(cfg.timeout * timeoutScale)
        };
        continue;
      }

      // Multimodal brain - preserve if GPU available
      if (brainName === 'multimodal') {
        const gpuAvailable = levels.gpuUtilization < 80;
        const active = stress.score < 75 && gpuAvailable;
        scaled[brainName] = {
          ...cfg,
          active,
          contextWindow: Math.floor(cfg.contextWindow * Math.max(0.5, contextScale)),
          maxConcurrent: Math.max(2, Math.floor(cfg.maxConcurrent * Math.max(0.5, concurrentLimit))),
          timeout: Math.floor(cfg.timeout * timeoutScale)
        };
        continue;
      }

      scaled[brainName] = { ...cfg, active: stress.score < 80 };
    }

    return Object.freeze(scaled);
  }

  getBrainAssignment(systemOrFunction) {
    // Check if the system/brain is currently available
    const config = this.getActiveConfig();
    const brainName = SYSTEM_TO_BRAIN[systemOrFunction] || systemOrFunction;

    if (!config[brainName] || !config[brainName].active) {
      // Fallback logic
      const fallback = this.getFallbackBrain(systemOrFunction);
      return { brain: fallback, available: false, fallback: brainName !== fallback };
    }

    return { brain: brainName, available: true, fallback: false };
  }

  getFallbackBrain(systemOrFunction) {
    const original = SYSTEM_TO_BRAIN[systemOrFunction];

    if (original === 'conscious') return 'conscious'; // Never fallback from conscious
    if (original === 'utility') return 'utility'; // Critical support

    if (original === 'subconscious' || original === 'autogen') {
      return 'utility'; // Background tasks can use utility
    }

    if (original === 'multimodal') {
      return 'conscious'; // Vision can use conscious if multimodal is down
    }

    if (original === 'repair') {
      return 'repair'; // Never deprioritize repair
    }

    return 'utility'; // Default fallback
  }

  // Queue management for brain requests
  canMakeRequest(brainName) {
    const config = this.getActiveConfig();
    const brainCfg = config[brainName];

    if (!brainCfg || !brainCfg.active) return false;

    const inflight = this.inflight.get(brainName) || 0;
    const queue = this.requestQueue.get(brainName) || [];

    return inflight + queue.length < brainCfg.maxConcurrent;
  }

  queueRequest(brainName, requestFn) {
    if (!this.requestQueue.has(brainName)) {
      this.requestQueue.set(brainName, []);
    }

    return new Promise((resolve, reject) => {
      const entry = {
        fn: requestFn,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.requestQueue.get(brainName).push(entry);

      // Set timeout for queued request (max 10 seconds in queue)
      const timeout = setTimeout(() => {
        const queue = this.requestQueue.get(brainName) || [];
        const index = queue.indexOf(entry);
        if (index !== -1) {
          queue.splice(index, 1);
          reject(new Error('Request timed out in queue'));
        }
      }, 10000);

      entry.timeout = timeout;
    });
  }

  async executeRequest(brainName, requestFn, priority = 5) {
    // Check if brain is available
    const config = this.getActiveConfig();
    const brainCfg = config[brainName];

    if (!brainCfg || !brainCfg.active) {
      const fallback = this.getFallbackBrain(brainName);
      if (fallback !== brainName && this.canMakeRequest(fallback)) {
        return requestFn(fallback); // Execute with fallback
      }
      throw new Error(`Brain ${brainName} is currently unavailable`);
    }

    // If we can make the request immediately, do so
    if (this.canMakeRequest(brainName)) {
      const inflightCount = this.inflight.get(brainName) || 0;
      this.inflight.set(brainName, inflightCount + 1);

      try {
        return await requestFn(brainName);
      } finally {
        this.inflight.set(brainName, Math.max(0, inflightCount - 1));
        this.processQueue(brainName);
      }
    }

    // Queue the request
    return this.queueRequest(brainName, requestFn);
  }

  processQueue(brainName) {
    const queue = this.requestQueue.get(brainName) || [];
    if (queue.length === 0) return;

    const config = this.getActiveConfig();
    const brainCfg = config[brainName];
    if (!brainCfg || !brainCfg.active) return;

    const inflight = this.inflight.get(brainName) || 0;
    if (inflight >= brainCfg.maxConcurrent) return;

    // Sort queue by priority (lower number = higher priority)
    queue.sort((a, b) => (a.priority || 5) - (b.priority || 5));

    const next = queue.shift();
    clearTimeout(next.timeout);

    this.inflight.set(brainName, inflight + 1);

    Promise.resolve()
      .then(() => next.fn())
      .then(result => {
        next.resolve(result);
        this.inflight.set(brainName, Math.max(0, inflight - 1));
        this.processQueue(brainName);
      })
      .catch(err => {
        next.reject(err);
        this.inflight.set(brainName, Math.max(0, inflight - 1));
        this.processQueue(brainName);
      });
  }

  getHealthStatus() {
    const config = this.getActiveConfig();
    const stress = systemMonitor.getSystemStressLevel();

    return {
      system: {
        stressScore: stress.score,
        levels: stress.levels
      },
      brains: Object.entries(config).reduce((acc, [name, cfg]) => {
        acc[name] = {
          active: cfg.active,
          contextWindow: cfg.contextWindow,
          maxConcurrent: cfg.maxConcurrent,
          priority: cfg.priority,
          inflight: this.inflight.get(name) || 0,
          queued: (this.requestQueue.get(name) || []).length
        };
        return acc;
      }, {}),
      recommendations: systemMonitor.getRecommendedSettings()
    };
  }
}

const adaptiveRouter = new AdaptiveBrainRouter();

// Update inflight tracking when requests start/finish
export function trackRequestStart(brainName) {
  const count = adaptiveRouter.inflight.get(brainName) || 0;
  adaptiveRouter.inflight.set(brainName, count + 1);
}

export function trackRequestComplete(brainName) {
  const count = adaptiveRouter.inflight.get(brainName) || 0;
  adaptiveRouter.inflight.set(brainName, Math.max(0, count - 1));
  adaptiveRouter.processQueue(brainName);
}

export { adaptiveRouter, AdaptiveBrainRouter };
