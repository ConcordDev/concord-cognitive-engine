/**
 * Frontier API Routes — Part 4
 *
 * Agents:
 *   POST /agents                       — create agent
 *   GET  /agents/user/:userId          — list user's agents
 *   GET  /agents/:id                   — get agent details
 *   POST /agents/:id/start             — start agent
 *   POST /agents/:id/stop              — stop agent
 *
 * Standards Library:
 *   GET  /standards                    — list standards
 *   GET  /standards/:id               — get standard with sections
 *   POST /standards/check             — check compliance
 *
 * DTU Diffing:
 *   POST /dtu/diff                    — compare two DTUs
 *   GET  /dtu/diff-history/:dtuId     — get diff history for a DTU
 */

import { Router } from 'express';
import crypto from 'crypto';
import registerStandardsActions from '../domains/standards.js';

// The standards domain registers its handlers through a registrar; capture
// them so the route evaluates with the SAME coded rules the lens uses.
const _standardsActions = new Map();
registerStandardsActions((domain, name, handler) => { _standardsActions.set(`${domain}.${name}`, handler); });
const logger = console;

export default function createFrontierRoutesPart4({ requireAuth, db = null } = {}) {
  const router = Router();

  function _userId(req) {
     
    // eslint-disable-next-line no-restricted-syntax
    return req.user?.userId ?? req.actor?.userId ?? req.body?.userId ?? null; // safe: target-identifier
  }

  const auth = (req, res, next) => {
    if (requireAuth) return requireAuth(req, res, next);
    next();
  };

  const wrap = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      logger.warn?.("[frontier-part4] error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("required") || err.message.includes("Invalid") ? 400
        : err.message.includes("owner") || err.message.includes("Only") ? 403
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // 13. Agents
  // ═══════════════════════════════════════════════════════════════════════════

  const agents = new Map();
  const VALID_AGENT_TYPES = [
    'monitor', 'builder', 'researcher', 'optimizer',
    'guardian', 'trader', 'explorer', 'teacher'
  ];

  // POST /agents — create agent
  router.post("/agents", auth, wrap((req, res) => {
    const { userId, name, type, config } = req.body;
    if (!userId || !name || !type) {
      throw new Error("userId, name, and type are required");
    }
    if (!VALID_AGENT_TYPES.includes(type)) {
      throw new Error(`Invalid agent type. Must be one of: ${VALID_AGENT_TYPES.join(', ')}`);
    }

    const now = new Date().toISOString();
    const agent = {
      id: crypto.randomUUID(),
      userId,
      name,
      type,
      config: config || {},
      status: 'idle',
      logs: [],
      createdAt: now,
      updatedAt: now,
    };
    agents.set(agent.id, agent);
    logger.log(`[agents] Created agent ${agent.id} (${type}) for user ${userId}`);
    res.status(201).json({ ok: true, agent });
  }));

  // GET /agents/user/:userId — list user's agents
  router.get("/agents/user/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const userAgents = [...agents.values()].filter(a => a.userId === userId);
    res.json({ ok: true, agents: userAgents, count: userAgents.length });
  }));

  // GET /agents/:id — get agent details with recent logs
  router.get("/agents/:id", auth, wrap((req, res) => {
    const agent = agents.get(req.params.id);
    if (!agent) throw new Error("Agent not found");
    const recentLogs = agent.logs.slice(-50);
    res.json({ ok: true, agent: { ...agent, logs: recentLogs } });
  }));

  // POST /agents/:id/start — start agent
  router.post("/agents/:id/start", auth, wrap((req, res) => {
    const agent = agents.get(req.params.id);
    if (!agent) throw new Error("Agent not found");

    const now = new Date().toISOString();
    agent.status = 'running';
    agent.logs.push({ timestamp: now, message: 'Agent started' });
    agent.updatedAt = now;

    logger.log(`[agents] Agent ${agent.id} started`);
    res.json({ ok: true, agent });
  }));

  // POST /agents/:id/stop — stop agent
  router.post("/agents/:id/stop", auth, wrap((req, res) => {
    const agent = agents.get(req.params.id);
    if (!agent) throw new Error("Agent not found");

    const now = new Date().toISOString();
    agent.status = 'idle';
    agent.logs.push({ timestamp: now, message: 'Agent stopped' });
    agent.updatedAt = now;

    logger.log(`[agents] Agent ${agent.id} stopped`);
    res.json({ ok: true, agent });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // 14. Standards Library
  // ═══════════════════════════════════════════════════════════════════════════

  const standards = new Map();

  function seedStandards() {
    const defs = [
      {
        code: 'ASTM E8',
        category: 'materials-testing',
        title: 'Standard Test Methods for Tension Testing of Metallic Materials',
        description: 'Tensile testing methods for metallic materials to determine mechanical properties.',
        sections: [
          { id: 's1', title: 'Scope', description: 'Covers tension testing of metallic materials in various forms at room temperature.', requirements: ['Specimen must be metallic', 'Testing at room temperature', 'Proper grip alignment', 'Calibrated equipment'] },
          { id: 's2', title: 'Specimen Preparation', description: 'Requirements for preparing test specimens.', requirements: ['Correct gauge length', 'Surface finish standards', 'Dimensional tolerances', 'Specimen marking'] },
          { id: 's3', title: 'Test Procedure', description: 'Step-by-step testing procedure.', requirements: ['Constant strain rate', 'Extensometer attachment', 'Load recording', 'Failure documentation', 'Data logging'] },
          { id: 's4', title: 'Calculations', description: 'Methods for calculating results from test data.', requirements: ['Yield strength calculation', 'Ultimate tensile strength', 'Elongation percentage', 'Reduction of area'] },
          { id: 's5', title: 'Reporting', description: 'Requirements for test reports.', requirements: ['Material identification', 'Test conditions', 'Results summary', 'Deviation notes', 'Operator certification'] },
        ],
      },
      {
        code: 'ISO 9001',
        category: 'quality-management',
        title: 'Quality Management Systems — Requirements',
        description: 'International standard for quality management systems.',
        sections: [
          { id: 's1', title: 'Context of the Organization', description: 'Understanding the organization and its context.', requirements: ['Stakeholder identification', 'Scope definition', 'Process approach', 'Risk-based thinking'] },
          { id: 's2', title: 'Leadership', description: 'Leadership commitment and policy.', requirements: ['Management commitment', 'Quality policy', 'Roles and responsibilities', 'Customer focus'] },
          { id: 's3', title: 'Planning', description: 'Planning for the QMS.', requirements: ['Risk assessment', 'Quality objectives', 'Change management', 'Resource planning'] },
          { id: 's4', title: 'Support', description: 'Resources, competence, and communication.', requirements: ['Resource allocation', 'Competence verification', 'Awareness training', 'Documentation control', 'Communication plan'] },
          { id: 's5', title: 'Operation', description: 'Operational planning and control.', requirements: ['Process controls', 'Design and development', 'External provision control', 'Production controls'] },
          { id: 's6', title: 'Performance Evaluation', description: 'Monitoring, measurement, analysis, and evaluation.', requirements: ['Internal audits', 'Management review', 'Customer satisfaction monitoring', 'Data analysis'] },
        ],
      },
      {
        code: 'ASCE 7',
        category: 'structural-loads',
        title: 'Minimum Design Loads and Associated Criteria for Buildings',
        description: 'Minimum design loads for buildings and other structures.',
        sections: [
          { id: 's1', title: 'Dead Loads', description: 'Permanent structural loads.', requirements: ['Material weight calculation', 'Fixed equipment loads', 'Partition allowances', 'Floor finish loads'] },
          { id: 's2', title: 'Live Loads', description: 'Variable occupancy and use loads.', requirements: ['Occupancy classification', 'Minimum floor loads', 'Roof live loads', 'Reduction factors'] },
          { id: 's3', title: 'Wind Loads', description: 'Wind pressure and force calculations.', requirements: ['Basic wind speed', 'Exposure category', 'Pressure coefficients', 'Gust factors', 'Directional factors'] },
          { id: 's4', title: 'Seismic Loads', description: 'Earthquake design criteria.', requirements: ['Seismic design category', 'Site classification', 'Response spectrum', 'Base shear calculation', 'Drift limits'] },
        ],
      },
      {
        code: 'IEEE 802.11',
        category: 'wireless',
        title: 'Wireless LAN Medium Access Control and Physical Layer Specifications',
        description: 'WiFi standards for wireless local area networks.',
        sections: [
          { id: 's1', title: 'MAC Layer', description: 'Medium access control protocols.', requirements: ['CSMA/CA implementation', 'Frame format compliance', 'Association procedures', 'Authentication mechanisms'] },
          { id: 's2', title: 'PHY Layer', description: 'Physical layer specifications.', requirements: ['Frequency band compliance', 'Modulation schemes', 'Channel bandwidth', 'Transmit power limits', 'Receiver sensitivity'] },
          { id: 's3', title: 'Security', description: 'Wireless security protocols.', requirements: ['WPA3 support', 'Key management', 'Encryption standards', 'Protected management frames'] },
          { id: 's4', title: 'QoS', description: 'Quality of service mechanisms.', requirements: ['Traffic classification', 'Priority queuing', 'Admission control', 'EDCA parameters'] },
          { id: 's5', title: 'Roaming', description: 'Mobility and handoff procedures.', requirements: ['Fast BSS transition', 'Pre-authentication', 'Neighbor reports', 'Beacon management'] },
        ],
      },
      {
        code: 'OSHA 1910',
        category: 'safety',
        title: 'Occupational Safety and Health Standards — General Industry',
        description: 'General industry safety and health standards.',
        sections: [
          { id: 's1', title: 'Walking-Working Surfaces', description: 'Floor and wall openings, stairs, ladders.', requirements: ['Guard rails', 'Floor load ratings', 'Ladder safety', 'Stairway standards'] },
          { id: 's2', title: 'Hazard Communication', description: 'Chemical hazard information and training.', requirements: ['Safety data sheets', 'Labeling requirements', 'Employee training', 'Written program', 'Chemical inventory'] },
          { id: 's3', title: 'PPE', description: 'Personal protective equipment requirements.', requirements: ['Hazard assessment', 'PPE selection', 'Training requirements', 'Maintenance standards'] },
          { id: 's4', title: 'Electrical Safety', description: 'Electrical installations and work practices.', requirements: ['Grounding requirements', 'Lockout/tagout', 'Clearance distances', 'Qualified personnel'] },
          { id: 's5', title: 'Fire Protection', description: 'Fire prevention and suppression.', requirements: ['Extinguisher placement', 'Sprinkler maintenance', 'Evacuation plans', 'Fire brigade training', 'Hot work permits'] },
          { id: 's6', title: 'Machine Guarding', description: 'Safeguards for machinery and equipment.', requirements: ['Point of operation guards', 'Power transmission guarding', 'Anchoring requirements', 'Maintenance lockout'] },
        ],
      },
      {
        code: 'NIST SP 800-53',
        category: 'security',
        title: 'Security and Privacy Controls for Information Systems',
        description: 'Comprehensive catalog of security and privacy controls.',
        sections: [
          { id: 's1', title: 'Access Control', description: 'Policies and mechanisms for controlling access.', requirements: ['Least privilege', 'Account management', 'Session controls', 'Remote access policies', 'Separation of duties'] },
          { id: 's2', title: 'Audit and Accountability', description: 'Audit logging and review.', requirements: ['Audit event logging', 'Log retention', 'Audit review', 'Timestamp accuracy'] },
          { id: 's3', title: 'Incident Response', description: 'Incident handling procedures.', requirements: ['Incident response plan', 'Detection mechanisms', 'Reporting procedures', 'Lessons learned'] },
          { id: 's4', title: 'Risk Assessment', description: 'Risk identification and mitigation.', requirements: ['Threat identification', 'Vulnerability scanning', 'Risk determination', 'Risk mitigation', 'Continuous monitoring'] },
          { id: 's5', title: 'System Integrity', description: 'System and information integrity.', requirements: ['Flaw remediation', 'Malware protection', 'Security alerts', 'Software verification'] },
        ],
      },
    ];

    for (const def of defs) {
      const id = crypto.randomUUID();
      standards.set(id, { id, ...def, createdAt: new Date().toISOString() });
    }
  }

  seedStandards();

  // GET /standards — list standards
  router.get("/standards", wrap((req, res) => {
    const list = [...standards.values()].map(({ sections, ...rest }) => rest);
    res.json({ ok: true, standards: list, count: list.length });
  }));

  // GET /standards/:id — get standard with sections
  router.get("/standards/:id", wrap((req, res) => {
    const standard = standards.get(req.params.id);
    if (!standard) throw new Error("Standard not found");
    res.json({ ok: true, standard });
  }));

  // POST /standards/check — check compliance
  router.post("/standards/check", auth, wrap((req, res) => {
    const { targetId, standardId, data } = req.body;
    if (!targetId || !standardId) {
      throw new Error("targetId and standardId are required");
    }

    const standard = standards.get(standardId);
    if (!standard) throw new Error("Standard not found");

    // Map this catalog row to the domain checker's catalog (ids like "ASCE7").
    const domainId = String(standard.code || "").replace(/\s+/g, "").toUpperCase();
    const getStd = _standardsActions.get("standards.standard-get");
    const check = _standardsActions.get("standards.compliance-check");
    const def = getStd?.({}, null, { id: domainId });
    const rules = def?.ok ? def.result.standard.rules : [];
    if (!def?.ok || !def.result.standard.checkable || !check) {
      return res.status(501).json({
        ok: false,
        error: "unavailable",
        reason: "compliance_not_measured",
        standardId,
        standardCode: standard.code,
        missing: `No coded compliance rules exist for ${standard.code}; the checker covers only standards with rules in domains/standards.js.`,
        message: "Compliance is not measured. No section score was invented.",
      });
    }

    const supplied = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    // A value counts as measured only if it is a finite number or a boolean.
    const measured = {};
    for (const r of rules) {
      const v = supplied[r.field];
      if ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean") measured[r.field] = v;
    }
    const out = check({ actor: { userId: _callerId(req) } }, null, { standardId: domainId, values: measured });
    if (!out?.ok) {
      return res.status(500).json({ ok: false, error: out?.error || "check_failed" });
    }
    const byCheck = new Map(rules.map((r) => [r.check, r]));
    const results = out.result.results.map((r) => {
      const field = byCheck.get(r.check)?.field;
      if (!(field in measured)) {
        return {
          check: r.check, section: r.section, title: r.title, field,
          status: "not_measured", passed: null, expected: r.expected, actual: null,
          details: `${field} not provided`,
        };
      }
      return { check: r.check, section: r.section, title: r.title, field, status: r.status, passed: r.passed, expected: r.expected, actual: r.actual };
    });
    const failed = results.filter((r) => r.status === "fail").length;
    const passed = results.filter((r) => r.status === "pass").length;
    const notMeasured = results.filter((r) => r.status === "not_measured").length;
    res.json({
      ok: true,
      targetId,
      standardId,
      standardCode: standard.code,
      rulesChecked: results.length,
      passedCount: passed,
      failedCount: failed,
      notMeasuredCount: notMeasured,
      verdict: failed > 0 ? "non-compliant" : notMeasured > 0 ? "incomplete" : "compliant",
      results,
    });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. DTU Diffing
  // ═══════════════════════════════════════════════════════════════════════════

  // Diffs this process computed, keyed `${callerId}::${dtuId}` so a caller only
  // reads back their own comparisons. Bounded per key; not persisted.
  const diffHistory = new Map();
  const HISTORY_PER_KEY = 50;
  const MAX_VALUE_CHARS = 2000;
  // Bookkeeping columns, not DTU content.
  // Internal provenance columns are not DTU content and are never diffed.
  const SKIP_COLUMNS = new Set([
    "id", "embedding", "created_at", "updated_at", "content_hash",
    "production_brain_interaction_id", "minted_by_model", "minted_by_provider",
    "origin_peer_id", "ongoing_reasoning_session", "reasoning_continues", "shadow_generation",
  ]);
  const JSON_COLUMNS = new Set(["data", "body_json", "tags_json", "content_json", "meta_json"]);

  function _callerId(req) {
    return req.user?.id ?? req.user?.userId ?? req.actor?.userId ?? null;
  }

  // Same gate as searchDtus / sim-live dtuHidden: the owner always sees; others
  // are blocked from personal-scope bodies and private/internal visibility.
  //
  // This route returns full field content, so the non-owner rule is stricter
  // than a title-only read: only visibility "public" (or "published") rows,
  // never marketplace (paid content), shadow-tier, quarantined, or
  // personal-scope rows.
  function _hidden(row, callerId) {
    const owners = [row.creator_id, row.owner_user_id].filter(Boolean);
    if (callerId && owners.includes(callerId)) return false;
    for (const col of ["data", "body_json", "content"]) {
      if (typeof row[col] === "string" && row[col].includes('"scope":"personal"')) return true;
    }
    if (row.tier === "shadow") return true;
    if (typeof row.status === "string" && row.status.startsWith("quarantine")) return true;
    return !(row.visibility === "public" || row.visibility === "published");
  }

  function _loadDtu(id) {
    return db.prepare("SELECT * FROM dtus WHERE id = ?").get(id) || null;
  }

  function _tryParse(v) {
    if (typeof v !== "string") return v;
    const t = v.trim();
    if (!(t.startsWith("{") || t.startsWith("["))) return v;
    try { return JSON.parse(t); } catch { return v; }
  }

  // Flatten a row to { "column" | "column.path": value }; JSON columns expand.
  function _flatten(row) {
    const out = {};
    const walk = (prefix, val) => {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        const keys = Object.keys(val);
        if (keys.length === 0) { out[prefix] = {}; return; }
        for (const k of keys) walk(`${prefix}.${k}`, val[k]);
      } else {
        out[prefix] = val;
      }
    };
    for (const [col, raw] of Object.entries(row)) {
      if (SKIP_COLUMNS.has(col) || Buffer.isBuffer(raw)) continue;
      walk(col, JSON_COLUMNS.has(col) ? _tryParse(raw) : raw);
    }
    return out;
  }

  function _clip(v) {
    if (typeof v === "string" && v.length > MAX_VALUE_CHARS) {
      return { value: v.slice(0, MAX_VALUE_CHARS), truncated: true };
    }
    return { value: v === undefined ? null : v, truncated: false };
  }

  function _computeDiff(rowA, rowB) {
    const a = _flatten(rowA);
    const b = _flatten(rowB);
    const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    const changes = [];
    let unchanged = 0;
    for (const f of fields) {
      const inA = f in a;
      const inB = f in b;
      if (inA && inB && JSON.stringify(a[f]) === JSON.stringify(b[f])) { unchanged += 1; continue; }
      const ca = _clip(a[f]);
      const cb = _clip(b[f]);
      changes.push({
        field: f,
        change: !inA ? "added" : !inB ? "removed" : "modified",
        a: ca.value,
        b: cb.value,
        ...(ca.truncated || cb.truncated ? { truncated: true } : {}),
      });
    }
    return {
      fieldsCompared: fields.length,
      fieldsUnchanged: unchanged,
      fieldsChanged: changes.length,
      // similarity = unchanged fields / all compared fields, where fields are
      // the union of column names and JSON-column paths of both DTUs.
      similarity: fields.length ? Math.round((unchanged / fields.length) * 1000) / 1000 : null,
      changes,
    };
  }

  // POST /dtu/diff — field-level diff of two stored DTUs the caller may see.
  // The `db` dependency is read-only here; without it the route is an honest 501.
  router.post("/dtu/diff", auth, wrap((req, res) => {
    const { dtuIdA, dtuIdB } = req.body || {};
    if (!dtuIdA || !dtuIdB) {
      throw new Error("dtuIdA and dtuIdB are required");
    }

    if (!db) {
      return res.status(501).json({
        ok: false,
        error: "unavailable",
        reason: "not_wired",
        missing: "DTU store (dtus table) not passed to this route factory",
        message: "DTU diffing needs a read-only DTU store; none is wired here.",
      });
    }

    const callerId = _callerId(req);
    const ids = [String(dtuIdA), String(dtuIdB)];
    const rows = {};
    for (const id of ids) {
      let row;
      try {
        row = _loadDtu(id);
      } catch (e) {
        return res.status(503).json({ ok: false, error: "unavailable", reason: "dtu_store_unreadable", message: e.message });
      }
      // A hidden DTU is indistinguishable from a missing one: no existence leak.
      if (!row || _hidden(row, callerId)) {
        return res.status(404).json({ ok: false, error: "dtu_not_found", dtuId: id });
      }
      rows[id] = row;
    }

    const diff = _computeDiff(rows[ids[0]], rows[ids[1]]);
    const entry = {
      id: crypto.randomUUID(),
      dtuIdA: ids[0],
      dtuIdB: ids[1],
      computedAt: new Date().toISOString(),
      fieldsChanged: diff.fieldsChanged,
      similarity: diff.similarity,
    };
    if (callerId) {
      for (const id of new Set(ids)) {
        const key = `${callerId}::${id}`;
        const list = diffHistory.get(key) || [];
        list.push(entry);
        if (list.length > HISTORY_PER_KEY) list.shift();
        diffHistory.set(key, list);
      }
    }
    res.json({ ok: true, dtuIdA: ids[0], dtuIdB: ids[1], identical: diff.fieldsChanged === 0, ...diff });
  }));

  // GET /dtu/diff-history/:dtuId — get diff history for a DTU
  //
  // Only ever reflects diffs this process has actually computed (see the
  // honesty note on POST /dtu/diff above) — never fabricated/seeded mock
  // history.
  router.get("/dtu/diff-history/:dtuId", auth, wrap((req, res) => {
    const { dtuId } = req.params;
    // Per-caller: only diffs this caller ran in this process. Not persisted.
    const callerId = _callerId(req);
    const history = callerId ? (diffHistory.get(`${callerId}::${dtuId}`) || []) : [];
    res.json({ ok: true, dtuId, history, count: history.length });
  }));

  // 16. Dependency Graph — removed. GET /graph/:projectId, POST /graph/analyze
  // and GET /graph/royalty-flow/:projectId returned a hardcoded ten-node graph
  // with made-up analysis and royalty numbers. Mounted at /api before the real
  // graph routes, /graph/:projectId also captured GET /api/graph/force and
  // /api/graph/visual, so the Graph lens drew that fixture instead of the DTU
  // lattice. Nothing in the frontend called these routes. Pinned by
  // tests/graph-routes-not-shadowed.test.js.

  return router;
}
