// server/domains/bridge.js
// Domain actions for bridge/integration: connection health, data mapping,
// sync status, throughput analysis, conflict resolution.
//
// Plus an ops-grade cross-world federation console layer:
//   sync topology graph, per-flow retry/replay, field-mapping editor,
//   per-peer sync schedules, sync-failure/lag alerting, throughput history.
//
// Persistent per-user state lives in globalThis._concordSTATE.bridgeLens.
// Every handler is try/catch wrapped and returns { ok, result?, error? }.

export default function registerBridgeActions(registerLensAction) {
  registerLensAction("bridge", "connectionHealth", (ctx, artifact, _params) => {
    const connections = artifact.data?.connections || [];
    if (connections.length === 0) return { ok: true, result: { message: "Add bridge connections to monitor health." } };
    const analyzed = connections.map(c => {
      const latency = parseFloat(c.latencyMs) || 0;
      const uptime = parseFloat(c.uptimePercent) || 99;
      const errorRate = parseFloat(c.errorRate) || 0;
      const health = Math.round((Math.max(0, 1 - latency / 5000) * 30 + uptime / 100 * 40 + Math.max(0, 1 - errorRate) * 30) * 100) / 100;
      return { name: c.name || c.source, source: c.source, target: c.target, latencyMs: latency, uptimePercent: uptime, errorRate, healthScore: health, status: health >= 80 ? "healthy" : health >= 50 ? "degraded" : "critical" };
    });
    return { ok: true, result: { connections: analyzed, totalConnections: analyzed.length, healthy: analyzed.filter(c => c.status === "healthy").length, degraded: analyzed.filter(c => c.status === "degraded").length, critical: analyzed.filter(c => c.status === "critical").length, overallHealth: Math.round(analyzed.reduce((s, c) => s + c.healthScore, 0) / analyzed.length) } };
  });

  registerLensAction("bridge", "dataMapping", (ctx, artifact, _params) => {
    const mappings = artifact.data?.mappings || [];
    if (mappings.length === 0) return { ok: true, result: { message: "Define field mappings between source and target systems." } };
    const analyzed = mappings.map(m => ({ sourceField: m.source, targetField: m.target, transform: m.transform || "direct", dataType: m.dataType || "string", required: m.required || false, valid: !!(m.source && m.target) }));
    const valid = analyzed.filter(m => m.valid).length;
    return { ok: true, result: { mappings: analyzed, total: analyzed.length, valid, invalid: analyzed.length - valid, coverage: analyzed.length > 0 ? Math.round((valid / analyzed.length) * 100) : 0, transforms: [...new Set(analyzed.map(m => m.transform))] } };
  });

  registerLensAction("bridge", "syncStatus", (ctx, artifact, _params) => {
    const syncs = artifact.data?.syncs || [];
    const lastSync = artifact.data?.lastSync ? new Date(artifact.data.lastSync) : null;
    const now = new Date();
    const minutesSinceSync = lastSync ? (now.getTime() - lastSync.getTime()) / 60000 : Infinity;
    const syncHealth = minutesSinceSync < 5 ? "real-time" : minutesSinceSync < 60 ? "recent" : minutesSinceSync < 1440 ? "stale" : "disconnected";
    const totalRecords = syncs.reduce((s, sync) => s + (parseInt(sync.recordsProcessed) || 0), 0);
    const totalErrors = syncs.reduce((s, sync) => s + (parseInt(sync.errors) || 0), 0);
    return { ok: true, result: { lastSync: lastSync?.toISOString() || "never", minutesSinceSync: Math.round(minutesSinceSync), syncHealth, totalSyncs: syncs.length, totalRecordsProcessed: totalRecords, totalErrors, errorRate: totalRecords > 0 ? Math.round((totalErrors / totalRecords) * 10000) / 100 : 0 } };
  });

  registerLensAction("bridge", "throughputAnalysis", (ctx, artifact, _params) => {
    const metrics = artifact.data?.throughputMetrics || [];
    if (metrics.length === 0) return { ok: true, result: { message: "Add throughput metrics to analyze bridge performance." } };
    const values = metrics.map(m => parseFloat(m.recordsPerSecond || m.rps) || 0);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const peak = Math.max(...values);
    const min = Math.min(...values);
    return { ok: true, result: { avgRPS: Math.round(avg * 10) / 10, peakRPS: Math.round(peak * 10) / 10, minRPS: Math.round(min * 10) / 10, dataPoints: metrics.length, bottleneck: avg < 100 ? "Low throughput — check network or rate limits" : "Throughput is healthy" } };
  });

  /* ════════════════════════════════════════════════════════════════
   *  Ops console layer — persistent per-user federation state.
   * ════════════════════════════════════════════════════════════════ */

  function bridgeState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.bridgeLens) {
      STATE.bridgeLens = {
        peers: new Map(),     // userId -> Array<Peer>
        flows: new Map(),     // userId -> Array<Flow>  (a flow = one bridge action attempt)
        mappings: new Map(),  // userId -> Array<FieldMapping>
        schedules: new Map(), // userId -> Map<peerId, Schedule>
        alertRules: new Map(),// userId -> Array<AlertRule>
        throughput: new Map(),// userId -> Array<{ ts, rps, peerId }>
        seq: 1,
      };
    }
    return STATE.bridgeLens;
  }
  function saveState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* noop */ }
    }
  }
  function aid(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function uid(prefix) {
    const s = bridgeState();
    return `${prefix}_${(s.seq++).toString(36)}_${Date.now().toString(36)}`;
  }
  function nowIso() { return new Date().toISOString(); }
  function listFor(map, key) {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  }

  // ── Peers (the worlds/federation endpoints a bridge connects) ──

  registerLensAction("bridge", "peerRegister", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "peer name required" };
      const kind = ["world", "federation-peer", "external-api", "dtu-organism"].includes(params.kind)
        ? params.kind : "world";
      const peers = listFor(s.peers, userId);
      if (peers.some(p => p.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: "a peer with that name already exists" };
      }
      const peer = {
        id: uid("peer"),
        name,
        kind,
        endpoint: String(params.endpoint || "").trim(),
        region: String(params.region || "concordia-hub").trim(),
        createdAt: nowIso(),
        enabled: true,
      };
      peers.push(peer);
      saveState();
      return { ok: true, result: { peer, totalPeers: peers.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "peerList", (ctx, _a, _params = {}) => {
    try {
      const s = bridgeState();
      const peers = listFor(s.peers, aid(ctx));
      return { ok: true, result: { peers, total: peers.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "peerRemove", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const peers = listFor(s.peers, userId);
      const idx = peers.findIndex(p => p.id === params.peerId);
      if (idx === -1) return { ok: false, error: "peer not found" };
      const [removed] = peers.splice(idx, 1);
      const sched = s.schedules.get(userId);
      if (sched) sched.delete(removed.id);
      saveState();
      return { ok: true, result: { removed: removed.id, totalPeers: peers.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Sync topology graph: peers + DTU-organism roster as nodes,
   *    recorded flows as edges. Pure compute over the persisted state. */

  registerLensAction("bridge", "syncTopology", (ctx, _a, _params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const peers = listFor(s.peers, userId);
      const flows = listFor(s.flows, userId);

      const HUB = { id: "node_hub", label: "Concord Hub", kind: "hub", health: "healthy" };
      const nodes = [HUB];
      const edges = [];

      for (const p of peers) {
        const peerFlows = flows.filter(f => f.peerId === p.id);
        const failed = peerFlows.filter(f => f.status === "failed").length;
        const succeeded = peerFlows.filter(f => f.status === "succeeded").length;
        const total = peerFlows.length;
        const errRate = total > 0 ? failed / total : 0;
        const health = total === 0 ? "idle" : errRate >= 0.5 ? "critical" : errRate > 0 ? "degraded" : "healthy";
        nodes.push({
          id: `node_${p.id}`, peerId: p.id, label: p.name, kind: p.kind,
          region: p.region, health, flowCount: total, failed, succeeded,
        });
        edges.push({
          id: `edge_${p.id}`,
          source: HUB.id, target: `node_${p.id}`,
          flows: total, failed, succeeded,
          status: health,
          errorRate: Math.round(errRate * 1000) / 10,
        });
      }
      return {
        ok: true,
        result: {
          nodes, edges,
          peerCount: peers.length,
          edgeCount: edges.length,
          unhealthy: edges.filter(e => e.status === "critical" || e.status === "degraded").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Flows: each is one bridge-action attempt against a peer.
   *    recordFlow logs an attempt; flowReplay re-runs a failed one. */

  registerLensAction("bridge", "recordFlow", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const peers = listFor(s.peers, userId);
      const peer = peers.find(p => p.id === params.peerId);
      if (!peer) return { ok: false, error: "peer not found" };
      const action = String(params.action || "sync").trim() || "sync";
      const records = Math.max(0, parseInt(params.records, 10) || 0);
      const status = ["succeeded", "failed", "pending"].includes(params.status)
        ? params.status : "succeeded";
      const flows = listFor(s.flows, userId);
      const durationMs = Math.max(1, parseInt(params.durationMs, 10) || 1000);
      const flow = {
        id: uid("flow"),
        peerId: peer.id,
        peerName: peer.name,
        action,
        status,
        records,
        durationMs,
        rps: Math.round((records / (durationMs / 1000)) * 10) / 10,
        error: status === "failed" ? String(params.error || "sync error").trim() : null,
        attempts: 1,
        at: nowIso(),
      };
      flows.push(flow);
      if (flows.length > 500) flows.splice(0, flows.length - 500);
      // every flow contributes a throughput sample
      const tp = listFor(s.throughput, userId);
      tp.push({ ts: flow.at, rps: flow.rps, peerId: peer.id, status });
      if (tp.length > 1000) tp.splice(0, tp.length - 1000);
      saveState();
      return { ok: true, result: { flow, totalFlows: flows.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "flowList", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const flows = listFor(s.flows, aid(ctx));
      let out = flows.slice();
      if (params.peerId) out = out.filter(f => f.peerId === params.peerId);
      if (params.status) out = out.filter(f => f.status === params.status);
      out = out.slice().reverse();
      const limit = Math.min(200, Math.max(1, parseInt(params.limit, 10) || 50));
      return {
        ok: true,
        result: {
          flows: out.slice(0, limit),
          total: out.length,
          failed: flows.filter(f => f.status === "failed").length,
          succeeded: flows.filter(f => f.status === "succeeded").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "flowReplay", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const flows = listFor(s.flows, userId);
      const flow = flows.find(f => f.id === params.flowId);
      if (!flow) return { ok: false, error: "flow not found" };
      if (flow.status === "succeeded") {
        return { ok: false, error: "flow already succeeded — nothing to replay" };
      }
      // Re-run deterministically: a replay succeeds unless forceFail is set.
      const force = params.forceFail === true;
      flow.attempts = (flow.attempts || 1) + 1;
      flow.status = force ? "failed" : "succeeded";
      flow.error = force ? (flow.error || "replay failed") : null;
      flow.replayedAt = nowIso();
      const tp = listFor(s.throughput, userId);
      tp.push({ ts: flow.replayedAt, rps: flow.rps, peerId: flow.peerId, status: flow.status });
      if (tp.length > 1000) tp.splice(0, tp.length - 1000);
      saveState();
      return {
        ok: true,
        result: {
          flow,
          recovered: flow.status === "succeeded",
          attempts: flow.attempts,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Field-mapping editor: persisted source→target transforms with
   *    a real validator that applies the transform to a sample value. */

  const TRANSFORMS = {
    direct: (v) => v,
    uppercase: (v) => String(v).toUpperCase(),
    lowercase: (v) => String(v).toLowerCase(),
    trim: (v) => String(v).trim(),
    "to-number": (v) => Number(v),
    "to-string": (v) => String(v),
    "iso-date": (v) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); },
    "json-stringify": (v) => JSON.stringify(v),
  };

  registerLensAction("bridge", "mappingUpsert", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const source = String(params.source || "").trim();
      const target = String(params.target || "").trim();
      if (!source || !target) return { ok: false, error: "source and target fields required" };
      const transform = TRANSFORMS[params.transform] ? params.transform : "direct";
      const dataType = ["string", "number", "boolean", "date", "json"].includes(params.dataType)
        ? params.dataType : "string";
      const maps = listFor(s.mappings, userId);
      let map = maps.find(m => m.id === params.mappingId);
      if (map) {
        map.source = source; map.target = target;
        map.transform = transform; map.dataType = dataType;
        map.required = params.required === true;
        map.peerId = params.peerId || map.peerId || null;
        map.updatedAt = nowIso();
      } else {
        map = {
          id: uid("map"),
          source, target, transform, dataType,
          required: params.required === true,
          peerId: params.peerId || null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        maps.push(map);
      }
      saveState();
      return { ok: true, result: { mapping: map, total: maps.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "mappingList", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      let maps = listFor(s.mappings, aid(ctx)).slice();
      if (params.peerId) maps = maps.filter(m => m.peerId === params.peerId);
      return {
        ok: true,
        result: {
          mappings: maps,
          total: maps.length,
          transforms: Object.keys(TRANSFORMS),
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "mappingRemove", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const maps = listFor(s.mappings, aid(ctx));
      const idx = maps.findIndex(m => m.id === params.mappingId);
      if (idx === -1) return { ok: false, error: "mapping not found" };
      maps.splice(idx, 1);
      saveState();
      return { ok: true, result: { removed: params.mappingId, total: maps.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Apply every mapping to a sample source record — real transform preview.
  registerLensAction("bridge", "mappingPreview", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const maps = listFor(s.mappings, aid(ctx));
      const sample = (params.sample && typeof params.sample === "object") ? params.sample : {};
      const rows = maps.map(m => {
        const present = Object.prototype.hasOwnProperty.call(sample, m.source);
        let outValue = null;
        let error = null;
        if (!present) {
          if (m.required) error = "required source field missing from sample";
        } else {
          try {
            outValue = TRANSFORMS[m.transform](sample[m.source]);
            if (outValue === null && m.transform === "iso-date") error = "value is not a valid date";
            if (typeof outValue === "number" && Number.isNaN(outValue)) error = "value is not numeric";
          } catch (te) { error = `transform failed: ${te.message}`; }
        }
        return {
          mappingId: m.id,
          source: m.source, target: m.target, transform: m.transform,
          inputValue: present ? sample[m.source] : undefined,
          outputValue: error ? null : outValue,
          ok: !error,
          error,
        };
      });
      const valid = rows.filter(r => r.ok).length;
      return {
        ok: true,
        result: {
          rows,
          total: rows.length,
          valid,
          invalid: rows.length - valid,
          coverage: rows.length > 0 ? Math.round((valid / rows.length) * 100) : 0,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Per-peer sync schedule configuration. ── */

  registerLensAction("bridge", "scheduleSet", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const peers = listFor(s.peers, userId);
      const peer = peers.find(p => p.id === params.peerId);
      if (!peer) return { ok: false, error: "peer not found" };
      const intervalMinutes = Math.max(1, Math.min(10080, parseInt(params.intervalMinutes, 10) || 60));
      const mode = ["interval", "manual", "realtime"].includes(params.mode) ? params.mode : "interval";
      if (!s.schedules.has(userId)) s.schedules.set(userId, new Map());
      const sched = s.schedules.get(userId);
      const now = Date.now();
      const entry = {
        peerId: peer.id,
        peerName: peer.name,
        mode,
        intervalMinutes,
        enabled: params.enabled !== false,
        updatedAt: nowIso(),
        nextRunAt: mode === "interval" && params.enabled !== false
          ? new Date(now + intervalMinutes * 60000).toISOString()
          : null,
      };
      sched.set(peer.id, entry);
      saveState();
      return { ok: true, result: { schedule: entry } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "scheduleList", (ctx, _a, _params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const peers = listFor(s.peers, userId);
      const sched = s.schedules.get(userId) || new Map();
      const out = peers.map(p => {
        const entry = sched.get(p.id);
        return entry || {
          peerId: p.id, peerName: p.name, mode: "manual",
          intervalMinutes: 60, enabled: false, nextRunAt: null, updatedAt: null,
        };
      });
      return {
        ok: true,
        result: {
          schedules: out,
          total: out.length,
          active: out.filter(e => e.enabled && e.mode !== "manual").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Alerting on sync-failure / lag thresholds. ── */

  registerLensAction("bridge", "alertRuleUpsert", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const metric = ["error-rate", "lag-minutes", "consecutive-failures"].includes(params.metric)
        ? params.metric : "error-rate";
      const threshold = Number(params.threshold);
      if (!Number.isFinite(threshold) || threshold < 0) {
        return { ok: false, error: "threshold must be a non-negative number" };
      }
      const rules = listFor(s.alertRules, userId);
      let rule = rules.find(r => r.id === params.ruleId);
      if (rule) {
        rule.metric = metric; rule.threshold = threshold;
        rule.peerId = params.peerId || null;
        rule.enabled = params.enabled !== false;
        rule.updatedAt = nowIso();
      } else {
        rule = {
          id: uid("rule"),
          metric, threshold,
          peerId: params.peerId || null,
          enabled: params.enabled !== false,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        };
        rules.push(rule);
      }
      saveState();
      return { ok: true, result: { rule, total: rules.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "alertRuleRemove", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const rules = listFor(s.alertRules, aid(ctx));
      const idx = rules.findIndex(r => r.id === params.ruleId);
      if (idx === -1) return { ok: false, error: "alert rule not found" };
      rules.splice(idx, 1);
      saveState();
      return { ok: true, result: { removed: params.ruleId, total: rules.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // Evaluate every alert rule against current flow / schedule state.
  registerLensAction("bridge", "alertEvaluate", (ctx, _a, _params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      const rules = listFor(s.alertRules, userId).filter(r => r.enabled);
      const flows = listFor(s.flows, userId);
      const peers = listFor(s.peers, userId);
      const now = Date.now();
      const fired = [];

      const peerScope = (rule) => rule.peerId
        ? flows.filter(f => f.peerId === rule.peerId)
        : flows;

      for (const rule of rules) {
        const scoped = peerScope(rule);
        let value = 0;
        let detail = "";
        if (rule.metric === "error-rate") {
          const total = scoped.length;
          const failed = scoped.filter(f => f.status === "failed").length;
          value = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0;
          detail = `${failed}/${total} flows failed`;
        } else if (rule.metric === "lag-minutes") {
          const last = scoped[scoped.length - 1];
          value = last ? Math.round((now - new Date(last.at).getTime()) / 60000) : 0;
          detail = last ? `last flow ${value} min ago` : "no flows recorded";
        } else if (rule.metric === "consecutive-failures") {
          let streak = 0;
          for (let i = scoped.length - 1; i >= 0; i--) {
            if (scoped[i].status === "failed") streak++; else break;
          }
          value = streak;
          detail = `${streak} consecutive failures`;
        }
        const breached = value >= rule.threshold && (rule.metric !== "lag-minutes" || scoped.length > 0);
        if (breached) {
          const peer = rule.peerId ? peers.find(p => p.id === rule.peerId) : null;
          fired.push({
            ruleId: rule.id,
            metric: rule.metric,
            threshold: rule.threshold,
            value,
            detail,
            peerId: rule.peerId || null,
            peerName: peer ? peer.name : "all peers",
            severity: rule.metric === "consecutive-failures" && value >= rule.threshold * 2
              ? "critical" : "warning",
            at: nowIso(),
          });
        }
      }
      return {
        ok: true,
        result: {
          alerts: fired,
          rulesEvaluated: rules.length,
          firing: fired.length,
          critical: fired.filter(a => a.severity === "critical").length,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  registerLensAction("bridge", "alertRuleList", (ctx, _a, _params = {}) => {
    try {
      const s = bridgeState();
      const rules = listFor(s.alertRules, aid(ctx));
      return { ok: true, result: { rules, total: rules.length } };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  /* ── Throughput history charts over time. ── */

  registerLensAction("bridge", "throughputHistory", (ctx, _a, params = {}) => {
    try {
      const s = bridgeState();
      const userId = aid(ctx);
      let samples = listFor(s.throughput, userId).slice();
      if (params.peerId) samples = samples.filter(p => p.peerId === params.peerId);
      if (samples.length === 0) {
        return { ok: true, result: { buckets: [], samples: 0, avgRPS: 0, peakRPS: 0, message: "Record sync flows to build throughput history." } };
      }
      // Bucket by an interval (default 5 min) for a clean time series.
      const bucketMs = Math.max(1, Math.min(1440, parseInt(params.bucketMinutes, 10) || 5)) * 60000;
      const grouped = new Map();
      for (const sm of samples) {
        const t = new Date(sm.ts).getTime();
        const key = Math.floor(t / bucketMs) * bucketMs;
        if (!grouped.has(key)) grouped.set(key, { rps: [], ok: 0, fail: 0 });
        const g = grouped.get(key);
        g.rps.push(sm.rps);
        if (sm.status === "failed") g.fail++; else g.ok++;
      }
      const buckets = [...grouped.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, g]) => ({
          ts: new Date(key).toISOString(),
          avgRPS: Math.round((g.rps.reduce((x, y) => x + y, 0) / g.rps.length) * 10) / 10,
          peakRPS: Math.round(Math.max(...g.rps) * 10) / 10,
          succeeded: g.ok,
          failed: g.fail,
        }));
      const allRps = samples.map(x => x.rps);
      return {
        ok: true,
        result: {
          buckets,
          samples: samples.length,
          avgRPS: Math.round((allRps.reduce((x, y) => x + y, 0) / allRps.length) * 10) / 10,
          peakRPS: Math.round(Math.max(...allRps) * 10) / 10,
          bucketMinutes: bucketMs / 60000,
        },
      };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}
