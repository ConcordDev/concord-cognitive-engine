/**
 * Concord Observe — Observability SDK
 *
 * Distributed tracing, error tracking, metrics collection, health monitoring,
 * and simulated auto-repair for the Concord platform. Provides a unified
 * interface for instrumenting services and diagnosing production issues.
 *
 * Features:
 *   - Distributed tracing with parent/child spans
 *   - Structured error capture with context (user, DTU, district)
 *   - Custom metric recording and time-series queries
 *   - Service health checks and uptime reporting
 *   - Auto-repair brain: pattern-matched diagnostics with fix suggestions
 */

'use strict';

const crypto = require('crypto');

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = 'obs') {
  return `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
}

function nowISO() {
  return new Date().toISOString();
}

// ── Known Error Patterns (Auto-Repair Brain) ────────────────────────────────

const KNOWN_ERROR_PATTERNS = [
  {
    pattern: /ECONNREFUSED/i,
    diagnosis: 'Connection refused — target service is down or unreachable.',
    hasFix: true,
    confidence: 0.85,
    risk: 'low',
    fix: 'restart_service',
    explanation: 'The target service is not accepting connections. Restarting the service typically resolves this.',
  },
  {
    pattern: /ENOMEM|out of memory/i,
    diagnosis: 'Memory exhaustion — process exceeded available memory.',
    hasFix: true,
    confidence: 0.72,
    risk: 'medium',
    fix: 'scale_memory',
    explanation: 'The service ran out of memory. Increasing the memory limit or restarting with GC pressure relief should help.',
  },
  {
    pattern: /ETIMEOUT|timeout|timed out/i,
    diagnosis: 'Request timeout — upstream dependency is too slow.',
    hasFix: true,
    confidence: 0.68,
    risk: 'low',
    fix: 'increase_timeout_and_retry',
    explanation: 'An upstream call exceeded the timeout window. Increasing timeout or adding retry logic can resolve this.',
  },
  {
    pattern: /ENOSPC|no space left/i,
    diagnosis: 'Disk full — storage volume is at capacity.',
    hasFix: true,
    confidence: 0.92,
    risk: 'medium',
    fix: 'cleanup_disk',
    explanation: 'The disk is full. Running garbage collection on old logs and temp files will free space.',
  },
  {
    pattern: /SQLITE_BUSY|database is locked/i,
    diagnosis: 'Database lock contention — concurrent write conflict.',
    hasFix: true,
    confidence: 0.78,
    risk: 'low',
    fix: 'enable_wal_mode',
    explanation: 'SQLite is in journal mode and cannot handle concurrent writes. Switching to WAL mode resolves contention.',
  },
  {
    pattern: /rate.?limit|429/i,
    diagnosis: 'Rate limit exceeded on external API.',
    hasFix: true,
    confidence: 0.90,
    risk: 'low',
    fix: 'enable_backoff',
    explanation: 'The external API rate limit was hit. Enabling exponential backoff with jitter will self-regulate request flow.',
  },
  {
    pattern: /certificate|SSL|TLS/i,
    diagnosis: 'TLS/SSL certificate error — expired or misconfigured certificate.',
    hasFix: false,
    confidence: 0.65,
    risk: 'high',
    fix: null,
    explanation: 'Certificate issues require manual renewal or configuration. Auto-repair cannot safely modify TLS settings.',
  },
];

// ── Default Services ────────────────────────────────────────────────────────

const DEFAULT_SERVICES = [
  'api-gateway',
  'brain-router',
  'dtu-store',
  'city-engine',
  'chat-pipeline',
  'lens-renderer',
  'mesh-transport',
  'shield-scanner',
];

// ── ConcordObserve ──────────────────────────────────────────────────────────

class ConcordObserve {
  constructor() {
    this.config = null;
    this.traces = new Map();
    this.errors = [];
    this.metrics = new Map();
    this.serviceHealth = new Map();
    this._initialized = false;
  }

  /**
   * Initialize the observability SDK.
   * @param {object} config
   * @returns {object}
   */
  init(config = {}) {
    this.config = {
      serviceName: config.serviceName || 'concord-default',
      endpoint: config.endpoint || 'http://localhost:4318',
      apiKey: config.apiKey || null,
      enableTracing: config.enableTracing !== false,
      enableErrors: config.enableErrors !== false,
      enableMetrics: config.enableMetrics !== false,
      enableAutoRepair: config.enableAutoRepair || false,
    };
    this._initialized = true;

    // Seed health status for default services
    for (const svc of DEFAULT_SERVICES) {
      this.serviceHealth.set(svc, {
        service: svc,
        status: 'healthy',
        lastCheck: nowISO(),
        uptime: 0.999,
        responseTimeMs: Math.floor(Math.random() * 80) + 10,
      });
    }

    return { ok: true, config: this.config };
  }

  /**
   * Start a new trace span.
   * @param {string} operationName
   * @param {string} [parentSpanId]
   * @returns {object} span object with setAttributes, recordError, end methods
   */
  startSpan(operationName, parentSpanId) {
    const spanId = uid('span');
    const traceId = parentSpanId
      ? (this.traces.get(parentSpanId)?.traceId || uid('trace'))
      : uid('trace');

    const span = {
      spanId,
      traceId,
      parentSpanId: parentSpanId || null,
      operationName,
      service: this.config?.serviceName || 'unknown',
      startTime: nowISO(),
      endTime: null,
      durationMs: null,
      status: 'in_progress',
      attributes: {},
      errors: [],

      setAttributes: (attrs) => {
        Object.assign(span.attributes, attrs);
        return span;
      },

      recordError: (error) => {
        span.errors.push({
          message: error?.message || String(error),
          stack: error?.stack || null,
          timestamp: nowISO(),
        });
        span.status = 'error';
        return span;
      },

      end: () => {
        span.endTime = nowISO();
        span.durationMs = new Date(span.endTime) - new Date(span.startTime);
        if (span.status === 'in_progress') span.status = 'ok';
        return span;
      },
    };

    this.traces.set(spanId, span);
    return span;
  }

  /**
   * Capture an error with context.
   * @param {Error|string} error
   * @param {object} context — user, action, dtu, district, recentActions
   * @returns {object}
   */
  captureError(error, context = {}) {
    const record = {
      id: uid('err'),
      message: error?.message || String(error),
      stack: error?.stack || null,
      severity: context.severity || 'error',
      service: this.config?.serviceName || 'unknown',
      timestamp: nowISO(),
      context: {
        user: context.user || null,
        action: context.action || null,
        dtu: context.dtu || null,
        district: context.district || null,
        recentActions: context.recentActions || [],
      },
      resolved: false,
    };

    this.errors.push(record);

    // Auto-repair diagnosis if enabled
    if (this.config?.enableAutoRepair) {
      record.diagnosis = this.diagnoseError(error, context);
    }

    return record;
  }

  /**
   * Record a custom metric data point.
   * @param {string} name
   * @param {number} value
   * @param {object} tags
   * @returns {object}
   */
  metric(name, value, tags = {}) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const point = {
      timestamp: nowISO(),
      value: Number(value) || 0,
      tags: { service: this.config?.serviceName || 'unknown', ...tags },
    };

    this.metrics.get(name).push(point);
    return point;
  }

  /**
   * Query traces by filter criteria.
   * @param {object} filter — service, timeRange { from, to }, status
   * @returns {object[]}
   */
  getTraces(filter = {}) {
    let results = Array.from(this.traces.values());

    if (filter.service) {
      results = results.filter(s => s.service === filter.service);
    }
    if (filter.status) {
      results = results.filter(s => s.status === filter.status);
    }
    if (filter.timeRange) {
      const from = filter.timeRange.from ? new Date(filter.timeRange.from).getTime() : 0;
      const to = filter.timeRange.to ? new Date(filter.timeRange.to).getTime() : Date.now();
      results = results.filter(s => {
        const t = new Date(s.startTime).getTime();
        return t >= from && t <= to;
      });
    }

    return results.sort((a, b) => b.startTime.localeCompare(a.startTime));
  }

  /**
   * Query errors by filter criteria.
   * @param {object} filter — severity, timeRange { from, to }
   * @returns {object[]}
   */
  getErrors(filter = {}) {
    let results = [...this.errors];

    if (filter.severity) {
      results = results.filter(e => e.severity === filter.severity);
    }
    if (filter.timeRange) {
      const from = filter.timeRange.from ? new Date(filter.timeRange.from).getTime() : 0;
      const to = filter.timeRange.to ? new Date(filter.timeRange.to).getTime() : Date.now();
      results = results.filter(e => {
        const t = new Date(e.timestamp).getTime();
        return t >= from && t <= to;
      });
    }

    return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  /**
   * Query metric time series by name and optional time range.
   * @param {string} name
   * @param {object} timeRange — { from, to }
   * @returns {object}
   */
  getMetrics(name, timeRange) {
    const series = this.metrics.get(name);
    if (!series) return { name, points: [], count: 0 };

    let points = [...series];
    if (timeRange) {
      const from = timeRange.from ? new Date(timeRange.from).getTime() : 0;
      const to = timeRange.to ? new Date(timeRange.to).getTime() : Date.now();
      points = points.filter(p => {
        const t = new Date(p.timestamp).getTime();
        return t >= from && t <= to;
      });
    }

    return { name, points, count: points.length };
  }

  /**
   * Check health of specified services.
   * @param {string[]} services
   * @returns {object}
   */
  healthCheck(services) {
    const targets = services || DEFAULT_SERVICES;
    const results = {};

    for (const svc of targets) {
      const existing = this.serviceHealth.get(svc);
      if (existing) {
        existing.lastCheck = nowISO();
        existing.responseTimeMs = Math.floor(Math.random() * 80) + 10;
        results[svc] = { ...existing };
      } else {
        results[svc] = {
          service: svc,
          status: 'unknown',
          lastCheck: nowISO(),
          uptime: null,
          responseTimeMs: null,
        };
      }
    }

    const allHealthy = Object.values(results).every(r => r.status === 'healthy');
    return { ok: allHealthy, services: results, checkedAt: nowISO() };
  }

  /**
   * Simulate the repair brain analyzing an error and returning a diagnosis.
   * @param {Error|string} error
   * @param {object} context
   * @returns {object}
   */
  diagnoseError(error, context = {}) {
    const message = error?.message || String(error);

    for (const pattern of KNOWN_ERROR_PATTERNS) {
      if (pattern.pattern.test(message)) {
        return {
          matched: true,
          diagnosis: pattern.diagnosis,
          hasFix: pattern.hasFix,
          confidence: pattern.confidence,
          risk: pattern.risk,
          fix: pattern.fix,
          explanation: pattern.explanation,
          service: context.service || this.config?.serviceName || 'unknown',
          analyzedAt: nowISO(),
        };
      }
    }

    return {
      matched: false,
      diagnosis: 'Unknown error pattern — no automated diagnosis available.',
      hasFix: false,
      confidence: 0,
      risk: 'unknown',
      fix: null,
      explanation: 'This error does not match any known patterns. Manual investigation is required.',
      service: context.service || this.config?.serviceName || 'unknown',
      analyzedAt: nowISO(),
    };
  }

  /**
   * Return a health dashboard for all tracked services.
   * @returns {object}
   */
  getHealthDashboard() {
    const services = {};
    for (const [name, health] of this.serviceHealth) {
      services[name] = { ...health };
    }

    const healthy = Object.values(services).filter(s => s.status === 'healthy').length;
    const total = Object.values(services).length;

    return {
      overallStatus: healthy === total ? 'healthy' : healthy > total / 2 ? 'degraded' : 'critical',
      healthyCount: healthy,
      totalCount: total,
      services,
      errorCount: this.errors.length,
      activeSpans: Array.from(this.traces.values()).filter(s => s.status === 'in_progress').length,
      metricSeriesCount: this.metrics.size,
      generatedAt: nowISO(),
    };
  }

  /**
   * Generate an uptime report for a given period.
   * @param {string} period — 'day', 'week', 'month'
   * @returns {object}
   */
  getUptimeReport(period = 'week') {
    const periodLabels = { day: '24 hours', week: '7 days', month: '30 days' };
    const report = {};

    for (const [name, health] of this.serviceHealth) {
      // Simulated uptime with slight variance per service
      const baseUptime = health.uptime || 0.999;
      const variance = (Math.random() - 0.5) * 0.005;
      const uptime = Math.min(1, Math.max(0.95, baseUptime + variance));

      report[name] = {
        service: name,
        period: periodLabels[period] || periodLabels.week,
        uptimePercent: parseFloat((uptime * 100).toFixed(3)),
        downtimeMinutes: parseFloat(((1 - uptime) * (period === 'day' ? 1440 : period === 'month' ? 43200 : 10080)).toFixed(1)),
        incidents: Math.floor(Math.random() * 3),
      };
    }

    return {
      period: periodLabels[period] || periodLabels.week,
      services: report,
      generatedAt: nowISO(),
    };
  }
}

module.exports = ConcordObserve;
