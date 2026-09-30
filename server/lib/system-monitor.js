// lib/system-monitor.js
// Adaptive system resource monitoring for intelligent brain scaling

import { readFileSync } from 'fs';
import { performance } from 'perf_hooks';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

class SystemMonitor {
  constructor() {
    this.metrics = {
      loadAvg: [0, 0, 0],
      cpuUsage: 0,
      memory: { total: 0, used: 0, available: 0 },
      eventLoopLag: 0,
      gpu: { utilization: 0, memory: { total: 0, used: 0 } }
    };
    this.baseline = null;
    this.lastCheck = Date.now();
    this.checkInterval = 5000; // 5 seconds
  }

  readProcStat() {
    try {
      const stat = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
      return {
        user: stat[0],
        nice: stat[1],
        system: stat[2],
        idle: stat[3],
        iowait: stat[4],
        irq: stat[5],
        softirq: stat[6],
        steal: stat[7]
      };
    } catch {
      return null;
    }
  }

  readMemInfo() {
    try {
      const meminfo = readFileSync('/proc/meminfo', 'utf8');
      const lines = meminfo.split('\n');
      const values = {};
      lines.forEach(line => {
        const [key, value] = line.split(':');
        if (key && value) {
          values[key.trim()] = parseInt(value.trim().split(/\s+/)[0]);
        }
      });
      return {
        total: values.MemTotal || 0,
        available: values.MemAvailable || 0,
        used: (values.MemTotal || 0) - (values.MemAvailable || 0)
      };
    } catch {
      return { total: 0, available: 0, used: 0 };
    }
  }

  checkLoadAverage() {
    try {
      const loadavg = readFileSync('/proc/loadavg', 'utf8');
      const [one, five, fifteen] = loadavg.split(/\s+/).map(Number);
      return [one, five, fifteen];
    } catch {
      return [0, 0, 0];
    }
  }

  calculateCpuUsage() {
    const current = this.readProcStat();
    if (!current) return 50; // default middle value

    if (!this.baseline) {
      this.baseline = current;
      return 0;
    }

    const prev = this.baseline;
    const idleDelta = (current.idle + current.iowait) - (prev.idle + prev.iowait);
    const totalDelta = (current.user + current.nice + current.system + current.idle + current.iowait + current.irq + current.softirq + current.steal) -
      (prev.user + prev.nice + prev.system + prev.idle + prev.iowait + prev.irq + prev.softirq + prev.steal);

    if (totalDelta <= 0) return 0;

    this.baseline = current;
    const usage = 100 - (idleDelta * 100 / totalDelta);
    return Math.max(0, Math.min(100, usage));
  }

  measureEventLoopLag() {
    return new Promise((resolve) => {
      const start = performance.now();
      setTimeout(() => {
        const lag = performance.now() - start - 1000; // Expected 1000ms
        resolve(Math.max(0, lag));
      }, 1000);
    });
  }

  async readGPUMetrics() {
    try {
      // execFile (async, no shell), not execSync — this runs from a
      // setInterval firing every 5s (startBackgroundMonitoring below);
      // execSync blocks the ENTIRE event loop for however long nvidia-smi
      // takes to spawn+run, every single time. Real production bug (found
      // 2026-08-23 via a live CPU profile investigating auth-request lag):
      // this alone accounted for ~3.3s of blocked main-thread time in a
      // 2-minute sample window, unrelated to any actual game/request logic.
      const { stdout } = await execFileAsync(
        'nvidia-smi',
        ['--query-gpu=utilization.gpu,memory.total,memory.used', '--format=csv,noHeader,nounits'],
        { timeout: 2000 },
      );
      const [util, total, used] = stdout.trim().split(',').map(Number);
      return { utilization: util, memory: { total: total * 1024 * 1024, used: used * 1024 * 1024 } };
    } catch {
      return { utilization: 0, memory: { total: 0, used: 0 } };
    }
  }

  async collect() {
    this.metrics.loadAvg = this.checkLoadAverage();
    this.metrics.cpuUsage = this.calculateCpuUsage();
    this.metrics.memory = this.readMemInfo();
    this.metrics.eventLoopLag = await this.measureEventLoopLag();
    this.metrics.gpu = await this.readGPUMetrics();
    this.lastCheck = Date.now();
    return this.metrics;
  }

  getSystemStressLevel() {
    const cpuLoad = this.metrics.loadAvg[0] || 0;
    const cpuUsage = this.metrics.cpuUsage || 0;
    const memUsage = this.metrics.memory.total > 0 ?
      (this.metrics.memory.used / this.metrics.memory.total) * 100 : 0;
    const eventLag = this.metrics.eventLoopLag || 0;
    const gpuLoad = this.metrics.gpu?.utilization || 0;

    // Calculate weighted stress score (0-100)
    const cpuStress = Math.min(100, (cpuLoad / 32) * 100); // Normalize against 32 cores
    const memStress = Math.min(100, memUsage);
    const lagStress = Math.min(100, eventLag / 100); // 100ms lag = 100 stress
    const gpuStress = Math.min(100, gpuLoad);

    return {
      score: (cpuStress * 0.3 + memStress * 0.2 + lagStress * 0.3 + gpuStress * 0.2),
      levels: {
        cpuLoad,
        cpuUsage,
        memoryUsage: memUsage,
        eventLoopLag: eventLag,
        gpuUtilization: gpuLoad,
        cpuPressure: cpuStress,
        memoryPressure: memStress,
        lagPressure: lagStress
      }
    };
  }

  getRecommendedSettings() {
    const stress = this.getSystemStressLevel();
    const score = stress.score;

    if (score < 30) {
      return {
        tier: 'high',
        contextScale: 1.0,
        concurrentLimit: 1.0,
        timeoutScale: 1.0,
        description: 'Optimal performance - full specifications'
      };
    } else if (score < 60) {
      return {
        tier: 'medium',
        contextScale: 0.75,
        concurrentLimit: 0.75,
        timeoutScale: 1.2,
        description: 'Moderate load - reduced context windows'
      };
    } else if (score < 85) {
      return {
        tier: 'high_load',
        contextScale: 0.5,
        concurrentLimit: 0.5,
        timeoutScale: 1.5,
        description: 'High load - aggressive scaling'
      };
    } else {
      return {
        tier: 'critical',
        contextScale: 0.25,
        concurrentLimit: 0.3,
        timeoutScale: 2.0,
        description: 'Critical load - minimal resources, preserve critical functions'
      };
    }
  }
}

// Singleton instance
const systemMonitor = new SystemMonitor();

// Start background monitoring
let monitorInterval = null;

function startBackgroundMonitoring() {
  if (monitorInterval) return;
  monitorInterval = setInterval(async () => {
    try {
      await systemMonitor.collect();
    } catch (err) {
      // Silent fail in monitoring
    }
  }, 5000);
  monitorInterval.unref(); // Don't block shutdown
}

// Stop background monitoring — was previously impossible from outside this
// module (startBackgroundMonitoring wasn't exported and there was no
// clearInterval anywhere in the file, a real leaked-handle finding from the
// resource-leak detector). The .unref() above already keeps the timer from
// blocking process exit on its own, but repeated in-process boot/teardown
// (e.g. tests that boot the server multiple times without a fresh process)
// had no way to actually stop the previous instance's timer.
function stopBackgroundMonitoring() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

// Initialize background monitoring
startBackgroundMonitoring();

export { systemMonitor, SystemMonitor, startBackgroundMonitoring, stopBackgroundMonitoring };
