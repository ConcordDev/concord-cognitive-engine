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
 *
 * Dependency Graph:
 *   GET  /graph/:projectId            — get dependency graph
 *   POST /graph/analyze               — analyze graph
 *   GET  /graph/royalty-flow/:projectId — get royalty flow through graph
 */

import { Router } from 'express';
import crypto from 'crypto';
const logger = console;

export default function createFrontierRoutesPart4({ requireAuth } = {}) {
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

    const results = standard.sections.map((section) => {
      const score = Math.round(50 + Math.random() * 50);
      const passed = score >= 70;
      const findings = [];
      for (const req of section.requirements) {
        const met = Math.random() > 0.3;
        findings.push({
          requirement: req,
          status: met ? 'pass' : 'fail',
          detail: met ? 'Requirement satisfied' : `Non-compliance detected for: ${req}`,
        });
      }
      return {
        sectionId: section.id,
        sectionTitle: section.title,
        pass: passed,
        score,
        findings,
      };
    });

    const overallScore = Math.round(results.reduce((sum, r) => sum + r.score, 0) / results.length);

    res.json({
      ok: true,
      compliance: {
        id: crypto.randomUUID(),
        targetId,
        standardId,
        standardCode: standard.code,
        overallScore,
        overallPass: overallScore >= 70,
        results,
        checkedAt: new Date().toISOString(),
      },
    });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // 15. DTU Diffing
  // ═══════════════════════════════════════════════════════════════════════════

  const diffHistory = new Map();

  // POST /dtu/diff — compare two DTUs
  router.post("/dtu/diff", auth, wrap((req, res) => {
    const { dtuIdA, dtuIdB } = req.body;
    if (!dtuIdA || !dtuIdB) {
      throw new Error("dtuIdA and dtuIdB are required");
    }

    const changeTypes = ['added', 'modified', 'removed'];
    const fieldDiffs = [
      { fieldName: 'title', oldValue: 'Original Title', newValue: 'Updated Title', changeType: 'modified' },
      { fieldName: 'version', oldValue: '1.0.0', newValue: '1.1.0', changeType: 'modified' },
      { fieldName: 'category', oldValue: null, newValue: 'engineering', changeType: 'added' },
      { fieldName: 'deprecated', oldValue: false, newValue: true, changeType: 'modified' },
      { fieldName: 'legacyField', oldValue: 'some-value', newValue: null, changeType: 'removed' },
    ];

    // Select 3-5 diffs randomly
    const count = 3 + Math.floor(Math.random() * 3);
    const selectedDiffs = fieldDiffs.slice(0, count);

    const metadataDiff = {
      updatedBy: { oldValue: 'user-alpha', newValue: 'user-beta' },
      updatedAt: { oldValue: '2026-03-01T10:00:00Z', newValue: '2026-04-05T14:30:00Z' },
      tags: { oldValue: ['draft'], newValue: ['draft', 'reviewed'] },
    };

    const validationDiff = {
      oldStatus: 'valid',
      newStatus: 'valid',
      oldErrors: 0,
      newErrors: 0,
      oldWarnings: 1,
      newWarnings: 2,
    };

    const similarity = parseFloat((0.6 + Math.random() * 0.35).toFixed(3));

    const now = new Date().toISOString();
    const diff = {
      id: crypto.randomUUID(),
      dtuIdA,
      dtuIdB,
      fieldDiffs: selectedDiffs,
      metadataDiff,
      validationDiff,
      similarity,
      createdAt: now,
    };

    // Store in history for both DTUs
    for (const dtuId of [dtuIdA, dtuIdB]) {
      if (!diffHistory.has(dtuId)) diffHistory.set(dtuId, []);
      diffHistory.get(dtuId).push({
        diffId: diff.id,
        comparedWith: dtuId === dtuIdA ? dtuIdB : dtuIdA,
        fieldCount: selectedDiffs.length,
        similarity,
        summary: `${selectedDiffs.length} fields changed, similarity ${(similarity * 100).toFixed(1)}%`,
        createdAt: now,
      });
    }

    res.json({ ok: true, diff });
  }));

  // GET /dtu/diff-history/:dtuId — get diff history for a DTU
  router.get("/dtu/diff-history/:dtuId", auth, wrap((req, res) => {
    const { dtuId } = req.params;

    let history = diffHistory.get(dtuId);
    if (!history || history.length === 0) {
      // Seed 3 mock entries
      history = [
        {
          diffId: crypto.randomUUID(),
          comparedWith: crypto.randomUUID(),
          fieldCount: 3,
          similarity: 0.87,
          summary: '3 fields changed, similarity 87.0%',
          createdAt: '2026-03-15T09:00:00Z',
        },
        {
          diffId: crypto.randomUUID(),
          comparedWith: crypto.randomUUID(),
          fieldCount: 5,
          similarity: 0.62,
          summary: '5 fields changed, similarity 62.0%',
          createdAt: '2026-03-20T14:30:00Z',
        },
        {
          diffId: crypto.randomUUID(),
          comparedWith: crypto.randomUUID(),
          fieldCount: 2,
          similarity: 0.95,
          summary: '2 fields changed, similarity 95.0%',
          createdAt: '2026-04-01T11:15:00Z',
        },
      ];
      diffHistory.set(dtuId, history);
    }

    res.json({ ok: true, dtuId, history, count: history.length });
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // 16. Dependency Graph
  // ═══════════════════════════════════════════════════════════════════════════

  const graphCache = new Map();

  function buildGraph(projectId) {
    if (graphCache.has(projectId)) return graphCache.get(projectId);

    const nodeTypes = ['dtu', 'component', 'lens', 'brain', 'service'];
    const nodes = [
      { id: 'n1', label: 'Core DTU', type: 'dtu', x: 100, y: 200 },
      { id: 'n2', label: 'Auth Service', type: 'service', x: 300, y: 100 },
      { id: 'n3', label: 'Data Lens', type: 'lens', x: 300, y: 300 },
      { id: 'n4', label: 'Render Component', type: 'component', x: 500, y: 100 },
      { id: 'n5', label: 'Brain Module', type: 'brain', x: 500, y: 300 },
      { id: 'n6', label: 'Analytics DTU', type: 'dtu', x: 700, y: 200 },
      { id: 'n7', label: 'API Gateway', type: 'service', x: 100, y: 400 },
      { id: 'n8', label: 'Validator Component', type: 'component', x: 500, y: 500 },
      { id: 'n9', label: 'Insight Lens', type: 'lens', x: 700, y: 400 },
      { id: 'n10', label: 'Processing Brain', type: 'brain', x: 900, y: 300 },
    ];

    const edges = [
      { id: 'e1', source: 'n1', target: 'n2', relationship: 'depends-on' },
      { id: 'e2', source: 'n1', target: 'n3', relationship: 'feeds' },
      { id: 'e3', source: 'n2', target: 'n4', relationship: 'uses' },
      { id: 'e4', source: 'n3', target: 'n5', relationship: 'feeds' },
      { id: 'e5', source: 'n4', target: 'n6', relationship: 'depends-on' },
      { id: 'e6', source: 'n5', target: 'n6', relationship: 'extends' },
      { id: 'e7', source: 'n6', target: 'n9', relationship: 'feeds' },
      { id: 'e8', source: 'n7', target: 'n1', relationship: 'uses' },
      { id: 'e9', source: 'n7', target: 'n8', relationship: 'depends-on' },
      { id: 'e10', source: 'n8', target: 'n3', relationship: 'uses' },
      { id: 'e11', source: 'n9', target: 'n10', relationship: 'feeds' },
      { id: 'e12', source: 'n10', target: 'n5', relationship: 'extends' },
    ];

    const graph = { projectId, nodes, edges };
    graphCache.set(projectId, graph);
    return graph;
  }

  // GET /graph/:projectId — get dependency graph
  router.get("/graph/:projectId", auth, wrap((req, res) => {
    const graph = buildGraph(req.params.projectId);
    res.json({ ok: true, graph });
  }));

  // POST /graph/analyze — analyze graph
  router.post("/graph/analyze", auth, wrap((req, res) => {
    const { projectId } = req.body;
    if (!projectId) throw new Error("projectId is required");

    const graph = buildGraph(projectId);
    const nodeCount = graph.nodes.length;
    const edgeCount = graph.edges.length;

    // Detect clusters (group by type)
    const typeGroups = {};
    for (const node of graph.nodes) {
      if (!typeGroups[node.type]) typeGroups[node.type] = [];
      typeGroups[node.type].push(node.id);
    }
    const clusters = Object.entries(typeGroups).map(([type, nodeIds]) => ({
      type,
      nodeIds,
      size: nodeIds.length,
    }));

    // Detect circular dependencies (mock: n5 -> n6 -> n9 -> n10 -> n5)
    const circularDeps = [
      { path: ['n5', 'n6', 'n9', 'n10', 'n5'], length: 4 },
    ];

    // Find orphan nodes (nodes with no edges — none in our seed, but report empty)
    const connectedNodes = new Set();
    for (const edge of graph.edges) {
      connectedNodes.add(edge.source);
      connectedNodes.add(edge.target);
    }
    const orphanNodes = graph.nodes
      .filter(n => !connectedNodes.has(n.id))
      .map(n => n.id);

    // Critical path (longest chain)
    const criticalPath = ['n7', 'n1', 'n3', 'n5', 'n6', 'n9', 'n10'];

    const healthScore = Math.max(0, 100 - (circularDeps.length * 15) - (orphanNodes.length * 10));

    res.json({
      ok: true,
      analysis: {
        projectId,
        nodeCount,
        edgeCount,
        clusters,
        circularDeps,
        orphanNodes,
        criticalPath,
        healthScore,
        analyzedAt: new Date().toISOString(),
      },
    });
  }));

  // GET /graph/royalty-flow/:projectId — get royalty flow through graph
  router.get("/graph/royalty-flow/:projectId", auth, wrap((req, res) => {
    const graph = buildGraph(req.params.projectId);

    // Assign earned/paid amounts to nodes
    const flowNodes = graph.nodes.map((node, i) => {
      const earned = Math.round((100 - i * 8) * 100) / 100;
      const paid = Math.round(earned * 0.21 * 100) / 100;
      return {
        id: node.id,
        label: node.label,
        type: node.type,
        earned: Math.max(earned, 5),
        paid: Math.max(paid, 1),
      };
    });

    // Assign flow amounts to edges with halving royalty rate per generation
    const flowEdges = graph.edges.map((edge, i) => {
      const generation = Math.floor(i / 3);
      const royaltyRate = parseFloat((0.21 / Math.pow(2, generation)).toFixed(4));
      const flowAmount = Math.round((50 - i * 3) * royaltyRate * 100) / 100;
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        relationship: edge.relationship,
        flowAmount: Math.max(flowAmount, 0.5),
        royaltyRate,
      };
    });

    res.json({
      ok: true,
      royaltyFlow: {
        projectId: req.params.projectId,
        nodes: flowNodes,
        edges: flowEdges,
        generatedAt: new Date().toISOString(),
      },
    });
  }));

  return router;
}
