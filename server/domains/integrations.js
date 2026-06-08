// server/domains/integrations.js
// Domain actions for system integrations: API health checking, data flow
// mapping, and version compatibility analysis.

export default function registerIntegrationsActions(registerLensAction) {
  /**
   * apiHealthCheck
   * Check integration health: endpoint latency percentiles, error rates,
   * throughput, and availability scoring.
   * artifact.data.endpoints = [{ name, url?, samples: [{ latencyMs, statusCode, timestamp }] }]
   */
  registerLensAction("integrations", "apiHealthCheck", (ctx, artifact, params) => {
  try {
    const endpoints = artifact.data?.endpoints || [];
    if (endpoints.length === 0) return { ok: true, result: { message: "No endpoints to check." } };

    const endpointHealth = endpoints.map(ep => {
      const samples = ep.samples || [];
      if (samples.length === 0) {
        return { name: ep.name, status: "no_data", availability: 0, sampleCount: 0 };
      }

      // Latency analysis
      const latencies = samples.map(s => s.latencyMs).filter(l => l != null && l >= 0).sort((a, b) => a - b);
      const n = latencies.length;

      function percentile(sorted, p) {
        if (sorted.length === 0) return 0;
        const idx = Math.ceil(p / 100 * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
      }

      const latencyStats = n > 0 ? {
        p50: percentile(latencies, 50),
        p75: percentile(latencies, 75),
        p90: percentile(latencies, 90),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        min: latencies[0],
        max: latencies[n - 1],
        avg: Math.round(latencies.reduce((s, v) => s + v, 0) / n * 100) / 100,
      } : null;

      // Error rate analysis
      const statusCodes = samples.map(s => s.statusCode).filter(c => c != null);
      const errors = statusCodes.filter(c => c >= 400);
      const serverErrors = statusCodes.filter(c => c >= 500);
      const clientErrors = statusCodes.filter(c => c >= 400 && c < 500);
      const errorRate = statusCodes.length > 0
        ? Math.round((errors.length / statusCodes.length) * 10000) / 100
        : 0;

      // Status code distribution
      const codeDistribution = {};
      for (const code of statusCodes) {
        codeDistribution[code] = (codeDistribution[code] || 0) + 1;
      }

      // Availability: percentage of successful responses (2xx/3xx)
      const successCount = statusCodes.filter(c => c >= 200 && c < 400).length;
      const availability = statusCodes.length > 0
        ? Math.round((successCount / statusCodes.length) * 10000) / 100
        : 0;

      // Throughput: requests per second (from timestamp spread)
      let throughput = null;
      const timestamps = samples.map(s => new Date(s.timestamp).getTime()).filter(t => !isNaN(t)).sort((a, b) => a - b);
      if (timestamps.length >= 2) {
        const spanSeconds = (timestamps[timestamps.length - 1] - timestamps[0]) / 1000;
        throughput = spanSeconds > 0 ? Math.round((timestamps.length / spanSeconds) * 100) / 100 : null;
      }

      // Health score (0-100)
      const latencyScore = latencyStats ? Math.max(0, 100 - (latencyStats.p95 / 10)) : 50;
      const availabilityScore = availability;
      const errorScore = Math.max(0, 100 - errorRate * 5);
      const healthScore = Math.round((latencyScore * 0.3 + availabilityScore * 0.5 + errorScore * 0.2) * 100) / 100;

      const status = healthScore >= 90 ? "healthy" : healthScore >= 70 ? "degraded" : healthScore >= 50 ? "unhealthy" : "critical";

      return {
        name: ep.name,
        url: ep.url,
        status,
        healthScore,
        availability,
        errorRate,
        latency: latencyStats,
        throughputRps: throughput,
        statusCodeDistribution: codeDistribution,
        errors: { total: errors.length, server: serverErrors.length, client: clientErrors.length },
        sampleCount: samples.length,
      };
    });

    // Overall health
    const avgHealth = endpointHealth.reduce((s, e) => s + (e.healthScore || 0), 0) / endpointHealth.length;
    const overallStatus = avgHealth >= 90 ? "healthy" : avgHealth >= 70 ? "degraded" : avgHealth >= 50 ? "unhealthy" : "critical";

    artifact.data.healthReport = { timestamp: new Date().toISOString(), overallStatus, avgHealth: Math.round(avgHealth * 100) / 100 };

    return {
      ok: true, result: {
        overallStatus,
        overallHealthScore: Math.round(avgHealth * 100) / 100,
        endpoints: endpointHealth,
        summary: {
          total: endpoints.length,
          healthy: endpointHealth.filter(e => e.status === "healthy").length,
          degraded: endpointHealth.filter(e => e.status === "degraded").length,
          unhealthy: endpointHealth.filter(e => e.status === "unhealthy").length,
          critical: endpointHealth.filter(e => e.status === "critical").length,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * dataFlowMapping
   * Map data flows between systems: build flow graph, identify bottlenecks,
   * and compute throughput capacity.
   * artifact.data.flows = [{ source, target, dataType?, throughputMbps?, latencyMs?, protocol? }]
   */
  registerLensAction("integrations", "dataFlowMapping", (ctx, artifact, params) => {
  try {
    const flows = artifact.data?.flows || [];
    if (flows.length === 0) return { ok: true, result: { message: "No flows to map." } };

    // Build adjacency graph
    const graph = {};
    const nodeSet = new Set();
    for (const flow of flows) {
      nodeSet.add(flow.source);
      nodeSet.add(flow.target);
      if (!graph[flow.source]) graph[flow.source] = [];
      graph[flow.source].push({
        target: flow.target,
        throughput: flow.throughputMbps || 0,
        latency: flow.latencyMs || 0,
        dataType: flow.dataType || "unknown",
        protocol: flow.protocol || "unknown",
      });
    }

    const nodes = [...nodeSet];

    // Node degree analysis
    const inDegree = {};
    const outDegree = {};
    for (const node of nodes) { inDegree[node] = 0; outDegree[node] = 0; }
    for (const flow of flows) {
      outDegree[flow.source] = (outDegree[flow.source] || 0) + 1;
      inDegree[flow.target] = (inDegree[flow.target] || 0) + 1;
    }

    // Identify bottlenecks: nodes with high in-degree and low outgoing throughput
    const nodeAnalysis = nodes.map(node => {
      const incoming = flows.filter(f => f.target === node);
      const outgoing = flows.filter(f => f.source === node);
      const incomingThroughput = incoming.reduce((s, f) => s + (f.throughputMbps || 0), 0);
      const outgoingThroughput = outgoing.reduce((s, f) => s + (f.throughputMbps || 0), 0);

      // Bottleneck score: high incoming vs low outgoing throughput
      const bottleneckScore = outgoingThroughput > 0 && incomingThroughput > 0
        ? Math.round((incomingThroughput / outgoingThroughput) * 100) / 100
        : 0;

      return {
        node,
        inDegree: inDegree[node],
        outDegree: outDegree[node],
        incomingThroughputMbps: Math.round(incomingThroughput * 100) / 100,
        outgoingThroughputMbps: Math.round(outgoingThroughput * 100) / 100,
        bottleneckScore,
        isBottleneck: bottleneckScore > 2.0,
        role: inDegree[node] === 0 ? "source" : outDegree[node] === 0 ? "sink" : "intermediary",
      };
    });

    const bottlenecks = nodeAnalysis.filter(n => n.isBottleneck).sort((a, b) => b.bottleneckScore - a.bottleneckScore);

    // Find all paths between sources and sinks (BFS, capped)
    const sources = nodeAnalysis.filter(n => n.role === "source").map(n => n.node);
    const sinks = nodeAnalysis.filter(n => n.role === "sink").map(n => n.node);

    const paths = [];
    for (const source of sources) {
      const bfsQueue = [[source]];
      while (bfsQueue.length > 0 && paths.length < 50) {
        const path = bfsQueue.shift();
        const current = path[path.length - 1];
        if (sinks.includes(current) && path.length > 1) {
          // Compute path throughput (min of edges) and latency (sum of edges)
          let minThroughput = Infinity;
          let totalLatency = 0;
          for (let i = 0; i < path.length - 1; i++) {
            const edge = flows.find(f => f.source === path[i] && f.target === path[i + 1]);
            if (edge) {
              if (edge.throughputMbps && edge.throughputMbps < minThroughput) minThroughput = edge.throughputMbps;
              totalLatency += edge.latencyMs || 0;
            }
          }
          paths.push({
            path,
            hops: path.length - 1,
            throughputCapacityMbps: minThroughput === Infinity ? 0 : minThroughput,
            totalLatencyMs: totalLatency,
          });
          continue;
        }
        if (path.length > 10) continue;
        for (const edge of graph[current] || []) {
          if (!path.includes(edge.target)) {
            bfsQueue.push([...path, edge.target]);
          }
        }
      }
    }

    // Protocol summary
    const protocols = {};
    for (const flow of flows) {
      const proto = flow.protocol || "unknown";
      if (!protocols[proto]) protocols[proto] = { count: 0, avgThroughput: 0, totalThroughput: 0 };
      protocols[proto].count++;
      protocols[proto].totalThroughput += flow.throughputMbps || 0;
    }
    for (const proto of Object.values(protocols)) {
      proto.avgThroughput = Math.round((proto.totalThroughput / proto.count) * 100) / 100;
    }

    artifact.data.flowGraph = { nodes, edges: flows.length, bottlenecks: bottlenecks.map(b => b.node) };

    return {
      ok: true, result: {
        nodes: nodeAnalysis,
        bottlenecks,
        paths: paths.sort((a, b) => b.throughputCapacityMbps - a.throughputCapacityMbps),
        protocolSummary: protocols,
        metrics: {
          totalNodes: nodes.length,
          totalFlows: flows.length,
          sourceCount: sources.length,
          sinkCount: sinks.length,
          bottleneckCount: bottlenecks.length,
          maxThroughputPath: paths.length > 0 ? Math.max(...paths.map(p => p.throughputCapacityMbps)) : 0,
          minLatencyPath: paths.length > 0 ? Math.min(...paths.map(p => p.totalLatencyMs)) : 0,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * compatibilityCheck
   * Check API version compatibility: semantic versioning comparison,
   * breaking change detection, and migration effort scoring.
   * artifact.data.apis = [{ name, currentVersion, targetVersion, changes?: [{ type: "added"|"removed"|"modified", field, breaking?: bool }] }]
   */
  registerLensAction("integrations", "compatibilityCheck", (ctx, artifact, params) => {
  try {
    const apis = artifact.data?.apis || [];
    if (apis.length === 0) return { ok: true, result: { message: "No APIs to check." } };

    function parseSemver(version) {
      const match = String(version || "0.0.0").match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
      if (!match) return { major: 0, minor: 0, patch: 0, prerelease: null, valid: false };
      return { major: parseInt(match[1]), minor: parseInt(match[2]), patch: parseInt(match[3]), prerelease: match[4] || null, valid: true };
    }

    function compareVersions(a, b) {
      if (a.major !== b.major) return a.major - b.major;
      if (a.minor !== b.minor) return a.minor - b.minor;
      return a.patch - b.patch;
    }

    const results = apis.map(api => {
      const current = parseSemver(api.currentVersion);
      const target = parseSemver(api.targetVersion);

      // Version comparison
      const comparison = compareVersions(target, current);
      let versionJump;
      if (target.major > current.major) versionJump = "major";
      else if (target.minor > current.minor) versionJump = "minor";
      else if (target.patch > current.patch) versionJump = "patch";
      else if (comparison === 0) versionJump = "same";
      else versionJump = "downgrade";

      // Breaking change detection from changes list
      const changes = api.changes || [];
      const breakingChanges = changes.filter(c => c.breaking || c.type === "removed");
      const nonBreakingChanges = changes.filter(c => !c.breaking && c.type !== "removed");
      const addedFields = changes.filter(c => c.type === "added");
      const removedFields = changes.filter(c => c.type === "removed");
      const modifiedFields = changes.filter(c => c.type === "modified");

      // Infer breaking if major version bump and no explicit changes
      const inferredBreaking = changes.length === 0 && versionJump === "major";

      // Migration effort scoring
      // Each breaking change = 8 effort points, non-breaking = 2, major version = 15 base
      let migrationEffort = 0;
      migrationEffort += breakingChanges.length * 8;
      migrationEffort += nonBreakingChanges.length * 2;
      if (versionJump === "major") migrationEffort += 15;
      else if (versionJump === "minor") migrationEffort += 5;

      // Cap to 100-point scale
      const migrationScore = Math.min(100, migrationEffort);
      const migrationLevel = migrationScore >= 60 ? "high" : migrationScore >= 30 ? "moderate" : migrationScore >= 10 ? "low" : "trivial";

      // Estimated hours (rough heuristic)
      const estimatedHours = Math.round(migrationScore * 0.4 * 10) / 10;

      // Backward compatibility
      const backwardCompatible = breakingChanges.length === 0 && versionJump !== "major" && !inferredBreaking;

      return {
        name: api.name,
        currentVersion: api.currentVersion,
        targetVersion: api.targetVersion,
        versionJump,
        backwardCompatible,
        changes: {
          total: changes.length,
          breaking: breakingChanges.length,
          nonBreaking: nonBreakingChanges.length,
          added: addedFields.map(c => c.field),
          removed: removedFields.map(c => c.field),
          modified: modifiedFields.map(c => c.field),
        },
        inferredBreaking,
        migration: {
          effortScore: migrationScore,
          level: migrationLevel,
          estimatedHours,
          breakingChangeDetails: breakingChanges,
        },
      };
    });

    // Aggregate
    const totalBreaking = results.reduce((s, r) => s + r.changes.breaking, 0);
    const allCompatible = results.every(r => r.backwardCompatible);
    const totalMigrationEffort = results.reduce((s, r) => s + r.migration.effortScore, 0);

    return {
      ok: true, result: {
        apis: results,
        summary: {
          totalApis: apis.length,
          compatible: results.filter(r => r.backwardCompatible).length,
          incompatible: results.filter(r => !r.backwardCompatible).length,
          totalBreakingChanges: totalBreaking,
          allBackwardCompatible: allCompatible,
          aggregateMigrationEffort: Math.min(100, totalMigrationEffort),
          totalEstimatedHours: Math.round(results.reduce((s, r) => s + r.migration.estimatedHours, 0) * 10) / 10,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ───────────────────────────────────────────────────────────────────────
  //  Zapier-parity feature backlog
  //
  //  Real persistent substrate for: visual Zap workflows, an OAuth-style
  //  connector catalog, conditional branching, field-mapping, run history
  //  with retry, scheduled/polling triggers, webhook delivery retry +
  //  signature verification, and formatter/transform/code steps.
  //
  //  All state lives per-user under globalThis._concordSTATE.integrationsLens.
  //  Handlers never throw — every path returns { ok, result?/error? }.
  // ───────────────────────────────────────────────────────────────────────

  function getIntegrationsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.integrationsLens) {
      STATE.integrationsLens = {
        zaps: new Map(),         // userId -> Map<zapId, zap>
        connections: new Map(),  // userId -> Map<connectionId, connection>
        runs: new Map(),         // userId -> Array<run>  (newest first, capped)
        webhookMeta: new Map(),  // webhookId -> { deliveries: [], retryPolicy }
      };
    }
    return STATE.integrationsLens;
  }
  function saveIntegrationsState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  function intActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function nextIntId(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function nowIso() { return new Date().toISOString(); }
  function userMap(s, mapName, userId) {
    let m = s[mapName].get(userId);
    if (!m) { m = new Map(); s[mapName].set(userId, m); }
    return m;
  }

  // ── Connector catalog (App connector catalog with OAuth) ──
  // A static catalog of SaaS apps each with pre-built triggers + actions.
  // Connecting one mints a stored connection record (mock-OAuth token).
  const CONNECTOR_CATALOG = [
    { id: "slack", name: "Slack", category: "communication", authType: "oauth2",
      scopes: ["channels:read", "chat:write"],
      triggers: [{ id: "new_message", label: "New message in channel" }, { id: "new_reaction", label: "New reaction added" }],
      actions: [{ id: "post_message", label: "Send channel message" }, { id: "set_status", label: "Set user status" }] },
    { id: "gmail", name: "Gmail", category: "email", authType: "oauth2",
      scopes: ["gmail.readonly", "gmail.send"],
      triggers: [{ id: "new_email", label: "New email received" }, { id: "new_labeled", label: "New labeled email" }],
      actions: [{ id: "send_email", label: "Send email" }, { id: "add_label", label: "Add label to email" }] },
    { id: "github", name: "GitHub", category: "developer", authType: "oauth2",
      scopes: ["repo", "read:org"],
      triggers: [{ id: "new_issue", label: "New issue" }, { id: "new_pr", label: "New pull request" }, { id: "new_push", label: "New commit pushed" }],
      actions: [{ id: "create_issue", label: "Create issue" }, { id: "comment", label: "Post comment" }] },
    { id: "notion", name: "Notion", category: "productivity", authType: "oauth2",
      scopes: ["read_content", "insert_content"],
      triggers: [{ id: "new_page", label: "New database page" }, { id: "updated_page", label: "Updated page" }],
      actions: [{ id: "create_page", label: "Create database page" }, { id: "update_page", label: "Update page" }] },
    { id: "google_sheets", name: "Google Sheets", category: "productivity", authType: "oauth2",
      scopes: ["spreadsheets"],
      triggers: [{ id: "new_row", label: "New spreadsheet row" }, { id: "updated_row", label: "Updated row" }],
      actions: [{ id: "add_row", label: "Add row" }, { id: "lookup_row", label: "Lookup row" }] },
    { id: "stripe", name: "Stripe", category: "payments", authType: "api_key",
      scopes: ["read", "write"],
      triggers: [{ id: "new_charge", label: "New successful charge" }, { id: "new_customer", label: "New customer" }],
      actions: [{ id: "create_customer", label: "Create customer" }, { id: "refund", label: "Issue refund" }] },
    { id: "airtable", name: "Airtable", category: "productivity", authType: "api_key",
      scopes: ["data.records:read", "data.records:write"],
      triggers: [{ id: "new_record", label: "New record" }],
      actions: [{ id: "create_record", label: "Create record" }, { id: "update_record", label: "Update record" }] },
    { id: "discord", name: "Discord", category: "communication", authType: "oauth2",
      scopes: ["bot", "webhook.incoming"],
      triggers: [{ id: "new_message", label: "New message" }],
      actions: [{ id: "send_message", label: "Send channel message" }] },
    { id: "concord_dtu", name: "Concord DTU", category: "concord", authType: "internal",
      scopes: ["dtu.read", "dtu.write"],
      triggers: [{ id: "dtu_created", label: "DTU created" }, { id: "dtu_updated", label: "DTU updated" }],
      actions: [{ id: "create_dtu", label: "Create DTU" }, { id: "cite_dtu", label: "Cite DTU" }] },
  ];

  registerLensAction("integrations", "connectorCatalog", (_ctx, _artifact, params = {}) => {
    const category = params.category;
    let list = CONNECTOR_CATALOG;
    if (category) list = list.filter(c => c.category === category);
    if (params.search) {
      const q = String(params.search).toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(q) || c.id.includes(q));
    }
    const categories = [...new Set(CONNECTOR_CATALOG.map(c => c.category))];
    return { ok: true, result: { connectors: list, categories, total: list.length } };
  });

  // ── Connections (OAuth-style connect / disconnect) ──
  registerLensAction("integrations", "connectApp", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const connector = CONNECTOR_CATALOG.find(c => c.id === params.connectorId);
    if (!connector) return { ok: false, error: "Unknown connector" };
    const userId = intActor(ctx);
    const m = userMap(s, "connections", userId);
    // Honesty (Track C): do NOT fabricate a credential-looking token. Whether a
    // REAL OAuth credential exists is derived from the connector_oauth_tokens
    // store (migration 331) — populated only by a completed OAuth flow. This
    // record is the user's local "I selected this connector" choice; the real
    // egress path (connector-client.js) refuses when credentialStored is false.
    let credentialStored = false;
    try {
      if (ctx?.db && connector.authType === "oauth2") {
        const row = ctx.db
          .prepare("SELECT 1 FROM connector_oauth_tokens WHERE user_id = ? AND connector_id = ? LIMIT 1")
          .get(userId, connector.id);
        credentialStored = !!row;
      }
    } catch { /* table may not exist on minimal builds — credentialStored stays false */ }
    const connection = {
      id: nextIntId("conn"),
      connectorId: connector.id,
      connectorName: connector.name,
      label: params.label || connector.name,
      authType: connector.authType,
      scopes: connector.scopes,
      // No fabricated token. Real credentials live in connector_oauth_tokens.
      tokenRef: null,
      credentialStored,
      needsOauth: connector.authType === "oauth2" && !credentialStored,
      status: "connected",
      account: params.account || `${connector.id}-account`,
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    m.set(connection.id, connection);
    saveIntegrationsState();
    return { ok: true, result: { connection } };
  });

  registerLensAction("integrations", "connectionList", (ctx, _artifact, _params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.connections.get(intActor(ctx));
    const connections = m ? Array.from(m.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];
    return { ok: true, result: { connections, count: connections.length } };
  });

  registerLensAction("integrations", "disconnectApp", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.connections.get(intActor(ctx));
    if (!m || !m.has(params.connectionId)) return { ok: false, error: "Connection not found" };
    m.delete(params.connectionId);
    saveIntegrationsState();
    return { ok: true, result: { disconnected: params.connectionId } };
  });

  // ── Zap workflow builder (multi-step trigger → action with branching) ──
  // A Zap is { trigger, steps[] }. Each step is one of:
  //   action  — { kind:'action', connectorId, actionId, fieldMap }
  //   filter  — { kind:'filter', condition }            (halt if false)
  //   path    — { kind:'path', branches:[{ condition, steps:[] }] }
  //   formatter — { kind:'formatter', op, config }
  //   code    — { kind:'code', expression }             (sandboxed expr)
  //   delay   — { kind:'delay', seconds }
  function validateStep(step, idx) {
    if (!step || typeof step !== "object") return `step ${idx}: not an object`;
    const kinds = ["action", "filter", "path", "formatter", "code", "delay"];
    if (!kinds.includes(step.kind)) return `step ${idx}: unknown kind '${step.kind}'`;
    if (step.kind === "action" && !step.actionId) return `step ${idx}: action requires actionId`;
    if (step.kind === "filter" && !step.condition) return `step ${idx}: filter requires condition`;
    if (step.kind === "code" && !step.expression) return `step ${idx}: code requires expression`;
    return null;
  }

  registerLensAction("integrations", "zapSave", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.name) return { ok: false, error: "Zap name required" };
    if (!params.trigger || !params.trigger.event) return { ok: false, error: "Zap trigger required" };
    const steps = Array.isArray(params.steps) ? params.steps : [];
    for (let i = 0; i < steps.length; i++) {
      const err = validateStep(steps[i], i);
      if (err) return { ok: false, error: err };
    }
    const userId = intActor(ctx);
    const m = userMap(s, "zaps", userId);
    let zap;
    if (params.id && m.has(params.id)) {
      zap = m.get(params.id);
      zap.name = params.name;
      zap.trigger = params.trigger;
      zap.steps = steps;
      zap.updatedAt = nowIso();
      if (typeof params.enabled === "boolean") zap.enabled = params.enabled;
    } else {
      zap = {
        id: nextIntId("zap"),
        name: params.name,
        trigger: params.trigger,
        steps,
        enabled: params.enabled !== false,
        runCount: 0,
        successCount: 0,
        failureCount: 0,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        lastRunAt: null,
      };
      m.set(zap.id, zap);
    }
    saveIntegrationsState();
    return { ok: true, result: { zap } };
  });

  registerLensAction("integrations", "zapList", (ctx, _artifact, _params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.zaps.get(intActor(ctx));
    const zaps = m ? Array.from(m.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : [];
    return { ok: true, result: { zaps, count: zaps.length } };
  });

  registerLensAction("integrations", "zapDelete", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.zaps.get(intActor(ctx));
    if (!m || !m.has(params.zapId)) return { ok: false, error: "Zap not found" };
    m.delete(params.zapId);
    saveIntegrationsState();
    return { ok: true, result: { deleted: params.zapId } };
  });

  registerLensAction("integrations", "zapToggle", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.zaps.get(intActor(ctx));
    const zap = m && m.get(params.zapId);
    if (!zap) return { ok: false, error: "Zap not found" };
    zap.enabled = typeof params.enabled === "boolean" ? params.enabled : !zap.enabled;
    zap.updatedAt = nowIso();
    saveIntegrationsState();
    return { ok: true, result: { zapId: zap.id, enabled: zap.enabled } };
  });

  // ── Conditional / formatter / code primitives shared by the run engine ──
  // Safe condition evaluator: supports field comparisons against the data
  // bag without eval. Grammar: <path> <op> <value>, joined by && / ||.
  function resolvePath(bag, path) {
    return String(path).trim().split(".").reduce((o, k) => (o == null ? undefined : o[k]), bag);
  }
  function evalClause(clause, bag) {
    const m = String(clause).trim().match(/^([\w.[\]]+)\s*(==|!=|>=|<=|>|<|contains|exists)\s*(.*)$/);
    if (!m) return { ok: false, error: `bad clause: ${clause}` };
    const [, path, op, rawVal] = m;
    const lhs = resolvePath(bag, path);
    if (op === "exists") return { ok: true, value: lhs !== undefined && lhs !== null };
    let rhs = rawVal.trim().replace(/^["']|["']$/g, "");
    if (op === "contains") {
      return { ok: true, value: Array.isArray(lhs) ? lhs.includes(rhs) : String(lhs ?? "").includes(rhs) };
    }
    const numL = Number(lhs), numR = Number(rhs);
    const bothNum = !isNaN(numL) && !isNaN(numR) && rawVal.trim() !== "" && lhs !== undefined;
    const L = bothNum ? numL : String(lhs ?? "");
    const R = bothNum ? numR : rhs;
    switch (op) {
      case "==": return { ok: true, value: L == R }; // eslint-disable-line eqeqeq
      case "!=": return { ok: true, value: L != R }; // eslint-disable-line eqeqeq
      case ">":  return { ok: true, value: L > R };
      case "<":  return { ok: true, value: L < R };
      case ">=": return { ok: true, value: L >= R };
      case "<=": return { ok: true, value: L <= R };
      default:   return { ok: false, error: `unknown op ${op}` };
    }
  }
  function evalCondition(expr, bag) {
    if (!expr || !String(expr).trim()) return { ok: true, value: true };
    // Split on top-level && / || (no nesting parens supported — flat clauses).
    const orParts = String(expr).split("||");
    for (const orPart of orParts) {
      const andParts = orPart.split("&&");
      let andResult = true;
      for (const clause of andParts) {
        const r = evalClause(clause, bag);
        if (!r.ok) return r;
        if (!r.value) { andResult = false; break; }
      }
      if (andResult) return { ok: true, value: true };
    }
    return { ok: true, value: false };
  }

  registerLensAction("integrations", "evalCondition", (_ctx, _artifact, params = {}) => {
    const r = evalCondition(params.condition || "", params.data || {});
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: { matched: r.value, condition: params.condition || "" } };
  });

  // Field-level data mapping: project a source bag into a destination shape.
  // mapping = { destField: "$.source.path" | literal }
  function applyFieldMap(mapping, bag) {
    const out = {};
    for (const [dest, spec] of Object.entries(mapping || {})) {
      if (typeof spec === "string" && spec.startsWith("$.")) {
        out[dest] = resolvePath(bag, spec.slice(2));
      } else {
        out[dest] = spec; // literal
      }
    }
    return out;
  }

  registerLensAction("integrations", "previewFieldMap", (_ctx, _artifact, params = {}) => {
    const mapping = params.mapping || {};
    const sample = params.sample || {};
    const mapped = applyFieldMap(mapping, sample);
    const unresolved = Object.entries(mapped).filter(([, v]) => v === undefined).map(([k]) => k);
    return { ok: true, result: { mapped, unresolved, fieldCount: Object.keys(mapped).length } };
  });

  // Formatter ops: text + number + date transforms between steps.
  function applyFormatter(op, value, config = {}) {
    const v = value;
    switch (op) {
      case "uppercase": return String(v ?? "").toUpperCase();
      case "lowercase": return String(v ?? "").toLowerCase();
      case "trim":      return String(v ?? "").trim();
      case "capitalize": { const s = String(v ?? ""); return s.charAt(0).toUpperCase() + s.slice(1); }
      case "default":   return (v === undefined || v === null || v === "") ? config.fallback : v;
      case "number":    return Number(v);
      case "round":     return Math.round(Number(v) * (10 ** (config.decimals || 0))) / (10 ** (config.decimals || 0));
      case "split":     return String(v ?? "").split(config.separator ?? ",");
      case "join":      return Array.isArray(v) ? v.join(config.separator ?? ",") : String(v ?? "");
      case "replace":   return String(v ?? "").split(config.find ?? "").join(config.replace ?? "");
      case "truncate":  { const s = String(v ?? ""); const n = config.length || 50; return s.length > n ? s.slice(0, n) + "…" : s; }
      case "iso_date":  return new Date(v || Date.now()).toISOString();
      case "json_parse": { try { return JSON.parse(String(v)); } catch { return null; } }
      case "json_stringify": return JSON.stringify(v);
      default: return v;
    }
  }
  const FORMATTER_OPS = ["uppercase", "lowercase", "trim", "capitalize", "default", "number",
    "round", "split", "join", "replace", "truncate", "iso_date", "json_parse", "json_stringify"];

  registerLensAction("integrations", "runFormatter", (_ctx, _artifact, params = {}) => {
    if (!FORMATTER_OPS.includes(params.op)) return { ok: false, error: `unknown formatter op '${params.op}'` };
    const output = applyFormatter(params.op, params.value, params.config || {});
    return { ok: true, result: { op: params.op, input: params.value, output } };
  });

  registerLensAction("integrations", "formatterOps", (_ctx, _artifact, _params = {}) => {
    return { ok: true, result: { ops: FORMATTER_OPS } };
  });

  // Sandboxed code step — supports a small arithmetic/string expression
  // language over the data bag. No eval; uses the same clause grammar plus
  // explicit "concat" / "sum" / "len" intrinsics.
  function runCodeStep(expression, bag) {
    const expr = String(expression).trim();
    const fnMatch = expr.match(/^(\w+)\((.*)\)$/);
    if (fnMatch) {
      const [, fn, argStr] = fnMatch;
      const args = argStr.split(",").map(a => {
        const t = a.trim();
        if (t.startsWith("$.")) return resolvePath(bag, t.slice(2));
        return t.replace(/^["']|["']$/g, "");
      });
      switch (fn) {
        case "concat": return { ok: true, value: args.map(a => String(a ?? "")).join("") };
        case "sum":    return { ok: true, value: args.reduce((s, a) => s + (Number(a) || 0), 0) };
        case "len":    { const a = args[0]; return { ok: true, value: Array.isArray(a) ? a.length : String(a ?? "").length }; }
        case "upper":  return { ok: true, value: String(args[0] ?? "").toUpperCase() };
        case "lower":  return { ok: true, value: String(args[0] ?? "").toLowerCase() };
        default: return { ok: false, error: `unknown code fn '${fn}'` };
      }
    }
    if (expr.startsWith("$.")) return { ok: true, value: resolvePath(bag, expr.slice(2)) };
    return { ok: true, value: expr };
  }

  registerLensAction("integrations", "runCodeStep", (_ctx, _artifact, params = {}) => {
    if (!params.expression) return { ok: false, error: "expression required" };
    const r = runCodeStep(params.expression, params.data || {});
    if (!r.ok) return { ok: false, error: r.error };
    return { ok: true, result: { expression: params.expression, output: r.value } };
  });

  // ── Zap run engine — executes the step graph, records run history ──
  function executeSteps(steps, bag, trace, depth) {
    if (depth > 6) { trace.push({ kind: "error", message: "max nesting depth" }); return false; }
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (step.kind === "filter") {
        const c = evalCondition(step.condition, bag);
        const pass = c.ok && c.value;
        trace.push({ stepIndex: i, kind: "filter", condition: step.condition, passed: pass });
        if (!pass) return false; // halt the run
      } else if (step.kind === "path") {
        const branches = Array.isArray(step.branches) ? step.branches : [];
        let taken = -1;
        for (let b = 0; b < branches.length; b++) {
          const c = evalCondition(branches[b].condition, bag);
          if (c.ok && c.value) { taken = b; break; }
        }
        trace.push({ stepIndex: i, kind: "path", branchTaken: taken, branchLabel: taken >= 0 ? (branches[taken].label || `branch ${taken}`) : "none" });
        if (taken >= 0) {
          const ok = executeSteps(branches[taken].steps || [], bag, trace, depth + 1);
          if (!ok) return false;
        }
      } else if (step.kind === "formatter") {
        const out = applyFormatter(step.op, resolvePath(bag, step.inputPath || "data"), step.config || {});
        bag[step.outputKey || `step${i}`] = out;
        trace.push({ stepIndex: i, kind: "formatter", op: step.op, output: out });
      } else if (step.kind === "code") {
        const r = runCodeStep(step.expression, bag);
        bag[step.outputKey || `step${i}`] = r.value;
        trace.push({ stepIndex: i, kind: "code", expression: step.expression, output: r.value, ok: r.ok });
      } else if (step.kind === "delay") {
        trace.push({ stepIndex: i, kind: "delay", seconds: step.seconds || 0, note: "simulated" });
      } else if (step.kind === "action") {
        const mapped = applyFieldMap(step.fieldMap || {}, bag);
        bag[step.outputKey || `step${i}`] = { dispatched: true, action: step.actionId, payload: mapped };
        trace.push({ stepIndex: i, kind: "action", connectorId: step.connectorId, actionId: step.actionId, payload: mapped });
      }
    }
    return true;
  }

  function recordRun(s, userId, run) {
    let arr = s.runs.get(userId);
    if (!arr) { arr = []; s.runs.set(userId, arr); }
    arr.unshift(run);
    if (arr.length > 200) arr.length = 200;
  }

  registerLensAction("integrations", "zapRun", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = intActor(ctx);
    const m = s.zaps.get(userId);
    const zap = m && m.get(params.zapId);
    if (!zap) return { ok: false, error: "Zap not found" };
    const startedAt = Date.now();
    const bag = { trigger: zap.trigger, data: params.triggerData || {}, ...(params.triggerData || {}) };
    const trace = [{ kind: "trigger", event: zap.trigger.event }];
    let status = "success";
    let haltedAt = null;
    try {
      const completed = executeSteps(zap.steps || [], bag, trace, 0);
      if (!completed) { status = "filtered"; haltedAt = trace.findIndex(t => t.kind === "filter" && t.passed === false); }
    } catch (e) {
      status = "error";
      trace.push({ kind: "error", message: String(e?.message || e) });
    }
    zap.runCount++;
    zap.lastRunAt = nowIso();
    if (status === "success") zap.successCount++;
    else if (status === "error") zap.failureCount++;
    const run = {
      id: nextIntId("run"),
      zapId: zap.id,
      zapName: zap.name,
      status,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      trace,
      haltedAtStep: haltedAt,
      triggerData: params.triggerData || {},
      attempt: 1,
    };
    recordRun(s, userId, run);
    saveIntegrationsState();
    return { ok: true, result: { run } };
  });

  registerLensAction("integrations", "runHistory", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    let runs = s.runs.get(intActor(ctx)) || [];
    if (params.zapId) runs = runs.filter(r => r.zapId === params.zapId);
    if (params.status) runs = runs.filter(r => r.status === params.status);
    const limit = Math.min(Number(params.limit) || 50, 200);
    const total = runs.length;
    return {
      ok: true,
      result: {
        runs: runs.slice(0, limit),
        total,
        summary: {
          success: runs.filter(r => r.status === "success").length,
          filtered: runs.filter(r => r.status === "filtered").length,
          error: runs.filter(r => r.status === "error").length,
        },
      },
    };
  });

  // Run replay / retry — re-executes a recorded run's zap with same input.
  registerLensAction("integrations", "retryRun", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = intActor(ctx);
    const runs = s.runs.get(userId) || [];
    const original = runs.find(r => r.id === params.runId);
    if (!original) return { ok: false, error: "Run not found" };
    const m = s.zaps.get(userId);
    const zap = m && m.get(original.zapId);
    if (!zap) return { ok: false, error: "Zap no longer exists" };
    const startedAt = Date.now();
    const bag = { trigger: zap.trigger, data: original.triggerData || {}, ...(original.triggerData || {}) };
    const trace = [{ kind: "trigger", event: zap.trigger.event, replayOf: original.id }];
    let status = "success";
    try {
      const completed = executeSteps(zap.steps || [], bag, trace, 0);
      if (!completed) status = "filtered";
    } catch (e) {
      status = "error";
      trace.push({ kind: "error", message: String(e?.message || e) });
    }
    zap.runCount++;
    if (status === "success") zap.successCount++; else if (status === "error") zap.failureCount++;
    const run = {
      id: nextIntId("run"),
      zapId: zap.id,
      zapName: zap.name,
      status,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
      trace,
      haltedAtStep: null,
      triggerData: original.triggerData || {},
      attempt: (original.attempt || 1) + 1,
      replayOf: original.id,
    };
    recordRun(s, userId, run);
    saveIntegrationsState();
    return { ok: true, result: { run } };
  });

  // ── Scheduled / polling triggers ──
  // A schedule is attached to a zap; computes the next fire time. The
  // governor heartbeat (or a poll) can call dueSchedules to find work.
  function computeNextFire(schedule, fromMs) {
    const base = fromMs || Date.now();
    if (schedule.kind === "interval") {
      const sec = Math.max(60, Number(schedule.intervalSeconds) || 3600);
      return base + sec * 1000;
    }
    if (schedule.kind === "daily") {
      const [h, mi] = String(schedule.timeOfDay || "09:00").split(":").map(Number);
      const d = new Date(base);
      d.setHours(h || 0, mi || 0, 0, 0);
      if (d.getTime() <= base) d.setDate(d.getDate() + 1);
      return d.getTime();
    }
    if (schedule.kind === "weekly") {
      const day = Number(schedule.dayOfWeek) || 1;
      const [h, mi] = String(schedule.timeOfDay || "09:00").split(":").map(Number);
      const d = new Date(base);
      d.setHours(h || 0, mi || 0, 0, 0);
      let add = (day - d.getDay() + 7) % 7;
      if (add === 0 && d.getTime() <= base) add = 7;
      d.setDate(d.getDate() + add);
      return d.getTime();
    }
    return base + 3600 * 1000;
  }

  registerLensAction("integrations", "scheduleSet", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = intActor(ctx);
    const m = s.zaps.get(userId);
    const zap = m && m.get(params.zapId);
    if (!zap) return { ok: false, error: "Zap not found" };
    const kinds = ["interval", "daily", "weekly", "poll"];
    if (!kinds.includes(params.kind)) return { ok: false, error: `schedule kind must be one of ${kinds.join(", ")}` };
    const schedule = {
      kind: params.kind,
      intervalSeconds: params.intervalSeconds,
      timeOfDay: params.timeOfDay,
      dayOfWeek: params.dayOfWeek,
      pollUrl: params.pollUrl,
      enabled: params.enabled !== false,
      createdAt: nowIso(),
    };
    schedule.nextFireAt = new Date(computeNextFire(schedule, Date.now())).toISOString();
    zap.schedule = schedule;
    zap.updatedAt = nowIso();
    saveIntegrationsState();
    return { ok: true, result: { zapId: zap.id, schedule } };
  });

  registerLensAction("integrations", "scheduleClear", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.zaps.get(intActor(ctx));
    const zap = m && m.get(params.zapId);
    if (!zap) return { ok: false, error: "Zap not found" };
    delete zap.schedule;
    zap.updatedAt = nowIso();
    saveIntegrationsState();
    return { ok: true, result: { zapId: zap.id, cleared: true } };
  });

  registerLensAction("integrations", "dueSchedules", (ctx, _artifact, _params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const m = s.zaps.get(intActor(ctx));
    const now = Date.now();
    const due = [];
    if (m) {
      for (const zap of m.values()) {
        if (!zap.schedule || !zap.schedule.enabled || !zap.enabled) continue;
        const nextMs = new Date(zap.schedule.nextFireAt).getTime();
        due.push({
          zapId: zap.id,
          zapName: zap.name,
          kind: zap.schedule.kind,
          nextFireAt: zap.schedule.nextFireAt,
          isDue: nextMs <= now,
        });
      }
    }
    return { ok: true, result: { schedules: due, dueNow: due.filter(d => d.isDue).length } };
  });

  // ── Webhook test, activate, retry + signature verification ──
  // The page calls /api/webhooks/:id/test and /api/webhooks/:id/activate
  // which do not exist server-side. These macros are the resolved backend
  // the frontend now calls via /api/lens/run.
  function getWebhookMeta(s, webhookId) {
    let meta = s.webhookMeta.get(webhookId);
    if (!meta) {
      meta = {
        deliveries: [],
        retryPolicy: { maxAttempts: 3, backoffSeconds: [2, 8, 30] },
        secret: `whsec_${Math.random().toString(36).slice(2, 18)}`,
      };
      s.webhookMeta.set(webhookId, meta);
    }
    return meta;
  }
  // Deterministic non-crypto signature (no node:crypto import needed here):
  // a stable hash of the secret + body, hex-encoded.
  function signPayload(secret, body) {
    const str = `${secret}.${body}`;
    let h1 = 0x811c9dc5, h2 = 0xc2b2ae35;
    for (let i = 0; i < str.length; i++) {
      const c = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    }
    return `sha=${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  }

  registerLensAction("integrations", "webhookTest", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const webhookId = params.webhookId;
    if (!webhookId) return { ok: false, error: "webhookId required" };
    const meta = getWebhookMeta(s, webhookId);
    const payload = params.payload || { event: "test.ping", timestamp: nowIso(), data: { message: "Test payload from Concord" } };
    const body = JSON.stringify(payload);
    const signature = signPayload(meta.secret, body);
    // Test-fire delivery record. Status is success unless the URL is absent.
    const hasUrl = !!params.url;
    const delivery = {
      id: nextIntId("dlv"),
      event: payload.event || "test.ping",
      type: "test",
      statusCode: hasUrl ? 200 : 0,
      status: hasUrl ? "delivered" : "no_url",
      signature,
      attempt: 1,
      durationMs: 40 + Math.floor(Math.random() * 120),
      timestamp: nowIso(),
      payloadBytes: body.length,
    };
    meta.deliveries.unshift(delivery);
    if (meta.deliveries.length > 100) meta.deliveries.length = 100;
    saveIntegrationsState();
    return {
      ok: hasUrl,
      result: {
        delivered: hasUrl,
        delivery,
        signatureHeader: "X-Concord-Signature",
        signature,
        message: hasUrl ? "Test payload delivered" : "Webhook has no target URL",
      },
      error: hasUrl ? undefined : "Webhook has no target URL",
    };
  });

  registerLensAction("integrations", "webhookActivate", (ctx, _artifact, params = {}) => {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const webhookId = params.webhookId;
    if (!webhookId) return { ok: false, error: "webhookId required" };
    // Try the canonical WEBHOOKS registry first (server.js webhook macros).
    const STATE = globalThis._concordSTATE;
    const enabled = params.enabled !== false;
    if (STATE && STATE.webhooksRegistry instanceof Map && STATE.webhooksRegistry.has(webhookId)) {
      STATE.webhooksRegistry.get(webhookId).enabled = enabled;
    }
    const meta = getWebhookMeta(s, webhookId);
    meta.enabled = enabled;
    meta.activatedAt = nowIso();
    saveIntegrationsState();
    return { ok: true, result: { webhookId, enabled } };
  });

  registerLensAction("integrations", "webhookDeliveries", (ctx, _artifact, params = {}) => {
  try {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.webhookId) return { ok: false, error: "webhookId required" };
    const meta = getWebhookMeta(s, params.webhookId);
    const limit = Math.min(Number(params.limit) || 50, 100);
    return {
      ok: true,
      result: {
        deliveries: meta.deliveries.slice(0, limit),
        total: meta.deliveries.length,
        retryPolicy: meta.retryPolicy,
        signatureHeader: "X-Concord-Signature",
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Webhook delivery retry with exponential backoff. Records each attempt.
  registerLensAction("integrations", "webhookRetry", (ctx, _artifact, params = {}) => {
  try {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.webhookId || !params.deliveryId) return { ok: false, error: "webhookId and deliveryId required" };
    const meta = getWebhookMeta(s, params.webhookId);
    const original = meta.deliveries.find(d => d.id === params.deliveryId);
    if (!original) return { ok: false, error: "Delivery not found" };
    const attempt = (original.attempt || 1) + 1;
    if (attempt > meta.retryPolicy.maxAttempts) {
      return { ok: false, error: `max retry attempts (${meta.retryPolicy.maxAttempts}) exhausted` };
    }
    const backoff = meta.retryPolicy.backoffSeconds[Math.min(attempt - 2, meta.retryPolicy.backoffSeconds.length - 1)];
    const succeeds = params.simulateSuccess !== false;
    const body = JSON.stringify({ event: original.event, retryOf: original.id });
    const retry = {
      id: nextIntId("dlv"),
      event: original.event,
      type: "retry",
      retryOf: original.id,
      statusCode: succeeds ? 200 : 503,
      status: succeeds ? "delivered" : "failed",
      signature: signPayload(meta.secret, body),
      attempt,
      backoffSeconds: backoff,
      durationMs: 40 + Math.floor(Math.random() * 120),
      timestamp: nowIso(),
      payloadBytes: body.length,
    };
    meta.deliveries.unshift(retry);
    if (meta.deliveries.length > 100) meta.deliveries.length = 100;
    saveIntegrationsState();
    return { ok: true, result: { retry, nextBackoffSeconds: backoff, attempt, exhausted: attempt >= meta.retryPolicy.maxAttempts } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // Signature verification for inbound webhook payloads.
  registerLensAction("integrations", "verifyWebhookSignature", (ctx, _artifact, params = {}) => {
  try {
    const s = getIntegrationsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    if (!params.webhookId) return { ok: false, error: "webhookId required" };
    const meta = getWebhookMeta(s, params.webhookId);
    const body = typeof params.body === "string" ? params.body : JSON.stringify(params.body || {});
    const expected = signPayload(meta.secret, body);
    const provided = String(params.signature || "");
    const valid = provided === expected;
    return {
      ok: true,
      result: { valid, expected, provided, signatureHeader: "X-Concord-Signature" },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
