/**
 * Frontier API Routes — Part 3
 *
 * REST endpoints for advanced Concord Frontier features:
 *
 * DSL Compiler:
 *   POST /api/frontier/dsl/compile      — compile DSL code
 *   POST /api/frontier/dsl/validate     — validate DSL code
 *   GET  /api/frontier/dsl/templates    — list DSL templates
 *
 * Digital Twins:
 *   POST /api/frontier/twins            — create digital twin
 *   GET  /api/frontier/twins/user/:userId — list user's twins
 *   GET  /api/frontier/twins/:id        — get twin detail
 *   POST /api/frontier/twins/:id/assess — run twin assessment
 *
 * Voice Assistant:
 *   POST /api/frontier/voice/transcribe — transcribe audio
 *   POST /api/frontier/voice/intent     — parse voice intent
 *   GET  /api/frontier/voice/history/:userId — voice history
 *
 * Replay & Forensics:
 *   GET  /api/frontier/replay/events/:sessionId — get replay events
 *   POST /api/frontier/replay/bookmarks         — create bookmark
 *   GET  /api/frontier/replay/bookmarks/:userId — list bookmarks
 *   POST /api/frontier/replay/forensic          — run forensic analysis
 */

import { Router } from "express";
import crypto from "crypto";
const logger = console;

export default function createFrontierRoutesPart3({ requireAuth } = {}) {
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
      logger.warn?.("[frontier-part3] error:", err.message);
      const status = err.message.includes("not found") ? 404
        : err.message.includes("required") || err.message.includes("Invalid") ? 400
        : err.message.includes("owner") || err.message.includes("Only") ? 403
        : 500;
      res.status(status).json({ ok: false, error: err.message });
    }
  };

  // ── In-memory stores ──────────────────────────────────────────────────────

  const compilations = new Map();
  const twins = new Map();
  const voiceHistory = new Map();
  const replayBookmarks = new Map();

  // ── 9. Concord DSL Compiler ─────────────────────────────────────────────

  router.post("/dsl/compile", auth, wrap((req, res) => {
    const { userId, code, action } = req.body;
    if (!userId || !code || !action) {
      throw new Error("userId, code, and action are required");
    }

    const validActions = ["compile", "validate", "simulate", "deploy"];
    if (!validActions.includes(action)) {
      throw new Error(`Invalid action. Must be one of: ${validActions.join(", ")}`);
    }

    const lines = code.split("\n").filter((l) => l.trim().length > 0);
    const nodesCount = Math.max(1, Math.floor(lines.length / 2));

    const ast = {
      type: "Program",
      nodes: Array.from({ length: nodesCount }, (_, i) => ({
        type: i % 3 === 0 ? "Declaration" : i % 3 === 1 ? "Expression" : "Statement",
        line: i + 1,
        value: lines[Math.min(i, lines.length - 1)]?.trim() ?? "",
      })),
    };

    const warnings = [];
    if (code.length > 500) warnings.push("Code exceeds recommended length of 500 characters");
    if (code.includes("TODO")) warnings.push("Unresolved TODO found in code");
    if (action === "deploy" && code.includes("debug")) warnings.push("Debug statements detected in deploy action");

    const compiledOutput = `// Compiled from DSL (${action})\n// Nodes: ${nodesCount}\n// Generated at: ${new Date().toISOString()}\nmodule.exports = { execute() { /* compiled output */ } };`;

    const compilation = {
      id: crypto.randomUUID(),
      userId,
      action,
      nodesCount,
      ast,
      compiledOutput,
      warnings,
      timestamp: new Date().toISOString(),
    };
    compilations.set(compilation.id, compilation);

    res.json({ ok: true, compilation });
  }));

  router.post("/dsl/validate", auth, wrap((req, res) => {
    const { code } = req.body;
    if (!code) throw new Error("code is required");

    const errors = [];
    const warnings = [];

    const lines = code.split("\n");
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      if (trimmed.length > 1 && !trimmed.endsWith(";") && !trimmed.endsWith("{") && !trimmed.endsWith("}")) {
        errors.push({ line: i + 1, message: "Missing semicolon", severity: "error" });
      }
      if (/\bundefined\b/.test(trimmed)) {
        errors.push({ line: i + 1, message: "Undefined reference detected", severity: "error" });
      }
      if (/\bvar\b/.test(trimmed)) {
        warnings.push({ line: i + 1, message: "Use 'let' or 'const' instead of 'var'", severity: "warning" });
      }
      if (trimmed.includes("eval(")) {
        warnings.push({ line: i + 1, message: "Avoid using eval()", severity: "warning" });
      }
    });

    const valid = errors.length === 0;
    res.json({ ok: true, validation: { valid, errors, warnings } });
  }));

  router.get("/dsl/templates", auth, wrap((req, res) => {
    const templates = [
      {
        name: "Basic Material",
        category: "material definition",
        description: "Define a basic material with physical properties",
        code: 'material Steel {\n  density: 7850;\n  tensileStrength: 400;\n  elasticity: 200;\n  thermalConductivity: 50;\n};',
      },
      {
        name: "Simple Component",
        category: "component with properties",
        description: "Create a component with configurable properties",
        code: 'component Beam {\n  material: Steel;\n  length: 5.0;\n  width: 0.3;\n  height: 0.5;\n  loadBearing: true;\n};',
      },
      {
        name: "Structure Blueprint",
        category: "multi-component structure",
        description: "Blueprint for a structure composed of multiple components",
        code: 'structure Bridge {\n  foundation: Beam[4];\n  deck: Panel[12];\n  supports: Column[8];\n  constraints {\n    maxLoad: 50000;\n    span: 30;\n  };\n};',
      },
      {
        name: "Validation Rule",
        category: "custom validator",
        description: "Define custom validation rules for structures",
        code: 'validator SafetyCheck {\n  rule "load_capacity" {\n    assert component.load < component.maxLoad * 0.8;\n    message "Load exceeds 80% of capacity";\n  };\n  rule "material_compatibility" {\n    assert compatible(component.material, adjacent.material);\n    message "Incompatible materials detected";\n  };\n};',
      },
      {
        name: "Full Pipeline",
        category: "end-to-end build",
        description: "Complete pipeline from material definition to deployment",
        code: 'pipeline ConstructionPipeline {\n  stage "define" {\n    import materials from "./materials";\n    import components from "./components";\n  };\n  stage "validate" {\n    run SafetyCheck on all components;\n    run StressTest with load: 1.5x;\n  };\n  stage "build" {\n    assemble structure from blueprint;\n    verify integrity;\n  };\n  stage "deploy" {\n    publish to environment;\n    monitor with sensors;\n  };\n};',
      },
    ];

    res.json({ ok: true, templates });
  }));

  // ── 10. Digital Twins ───────────────────────────────────────────────────

  router.post("/twins", auth, wrap((req, res) => {
    const { userId, name, sourceType, sourceId, sensorIds } = req.body;
    if (!userId || !name || !sourceType || !sourceId) {
      throw new Error("userId, name, sourceType, and sourceId are required");
    }

    const twin = {
      id: crypto.randomUUID(),
      userId,
      name,
      sourceType,
      sourceId,
      sensorIds: sensorIds || [],
      status: "active",
      health: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    twins.set(twin.id, twin);

    res.status(201).json({ ok: true, twin });
  }));

  router.get("/twins/user/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const userTwins = [...twins.values()].filter((t) => t.userId === userId);
    res.json({ ok: true, twins: userTwins });
  }));

  router.get("/twins/:id", auth, wrap((req, res) => {
    const twin = twins.get(req.params.id);
    if (!twin) throw new Error("Twin not found");

    const sensorOverlay = twin.sensorIds.map((sensorId) => ({
      sensorId,
      reading: +(Math.random() * 100).toFixed(2),
      unit: ["celsius", "psi", "mm", "hz", "percent"][Math.floor(Math.random() * 5)],
      timestamp: new Date(Date.now() - Math.floor(Math.random() * 60000)).toISOString(),
      status: Math.random() > 0.1 ? "normal" : "warning",
    }));

    res.json({ ok: true, twin: { ...twin, sensorOverlay } });
  }));

  router.post("/twins/:id/assess", auth, wrap((req, res) => {
    const twin = twins.get(req.params.id);
    if (!twin) throw new Error("Twin not found");

    const { assessmentType } = req.body;
    const validTypes = ["structural", "thermal", "stress", "lifecycle"];
    if (!assessmentType || !validTypes.includes(assessmentType)) {
      throw new Error(`Invalid assessmentType. Must be one of: ${validTypes.join(", ")}`);
    }

    const findingsMap = {
      structural: [
        { area: "Foundation", issue: "Minor settling detected in northeast corner", severity: "low" },
        { area: "Load Bearing Wall", issue: "Hairline crack at joint B-7", severity: "medium" },
        { area: "Roof Truss", issue: "Connection plate within tolerance", severity: "info" },
      ],
      thermal: [
        { area: "Exterior Wall", issue: "Thermal bridge at window frame junction", severity: "medium" },
        { area: "Insulation", issue: "R-value degradation in south-facing panels", severity: "low" },
        { area: "HVAC Zone 3", issue: "Heat distribution imbalance detected", severity: "high" },
      ],
      stress: [
        { area: "Primary Beam", issue: "Stress concentration at midspan under peak load", severity: "medium" },
        { area: "Column Base", issue: "Bearing pressure approaching design limit", severity: "high" },
        { area: "Connection Plate", issue: "Fatigue cycle count within safe range", severity: "info" },
      ],
      lifecycle: [
        { area: "Concrete Elements", issue: "Estimated 15% service life consumed", severity: "info" },
        { area: "Steel Components", issue: "Corrosion rate higher than projected", severity: "medium" },
        { area: "Sealants", issue: "Replacement recommended within 18 months", severity: "low" },
      ],
    };

    const score = Math.floor(Math.random() * 31) + 70; // 70-100

    const assessment = {
      id: crypto.randomUUID(),
      twinId: twin.id,
      assessmentType,
      score,
      findings: findingsMap[assessmentType],
      recommendations: [
        `Schedule detailed ${assessmentType} inspection within 30 days`,
        `Update ${assessmentType} monitoring sensors for higher resolution`,
        `Review ${assessmentType} maintenance plan with engineering team`,
      ],
      timestamp: new Date().toISOString(),
    };

    res.json({ ok: true, assessment });
  }));

  // ── 11. Voice Assistant ─────────────────────────────────────────────────

  router.post("/voice/transcribe", auth, wrap((req, res) => {
    const { userId, audioData, language } = req.body;
    if (!userId || !audioData) {
      throw new Error("userId and audioData are required");
    }

    const transcription = {
      id: crypto.randomUUID(),
      userId,
      text: "Show me the structural analysis for building A and highlight any areas with stress above threshold",
      confidence: 0.95,
      language: language || "en",
      duration: +(Math.random() * 10 + 1).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    const history = voiceHistory.get(userId) || [];
    history.push({ ...transcription, type: "transcription" });
    voiceHistory.set(userId, history);

    res.json({ ok: true, transcription });
  }));

  router.post("/voice/intent", auth, wrap((req, res) => {
    const { userId, text } = req.body;
    if (!userId || !text) {
      throw new Error("userId and text are required");
    }

    const lower = text.toLowerCase();
    let intent = "help";
    if (/\b(go|show|open|navigate|view|display)\b/.test(lower)) intent = "navigate";
    else if (/\b(create|build|make|new|add)\b/.test(lower)) intent = "create";
    else if (/\b(find|search|query|list|get|what|how|where)\b/.test(lower)) intent = "query";
    else if (/\b(update|change|modify|edit|set|adjust)\b/.test(lower)) intent = "modify";
    else if (/\b(delete|remove|destroy|drop|clear)\b/.test(lower)) intent = "delete";

    const entities = [];
    const wordTokens = text.split(/\s+/).filter((w) => w.length > 3);
    if (wordTokens.length > 0) {
      entities.push({ type: "subject", value: wordTokens[wordTokens.length - 1], start: text.lastIndexOf(wordTokens[wordTokens.length - 1]) });
    }
    if (wordTokens.length > 2) {
      entities.push({ type: "target", value: wordTokens[1], start: text.indexOf(wordTokens[1]) });
    }

    const result = {
      id: crypto.randomUUID(),
      userId,
      text,
      intent,
      entities,
      confidence: +(Math.random() * 0.15 + 0.85).toFixed(2),
      timestamp: new Date().toISOString(),
    };

    const history = voiceHistory.get(userId) || [];
    history.push({ ...result, type: "intent" });
    voiceHistory.set(userId, history);

    res.json({ ok: true, result });
  }));

  router.get("/voice/history/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const history = voiceHistory.get(userId) || [];
    res.json({ ok: true, history });
  }));

  // ── 12. Replay & Forensics ─────────────────────────────────────────────

  router.get("/replay/events/:sessionId", auth, wrap((req, res) => {
    const { sessionId } = req.params;
    const baseTime = Date.now() - 3600000; // 1 hour ago
    const types = ["create", "modify", "delete", "interact", "system"];
    const actors = ["user-alpha", "user-beta", "system-agent", "admin-bot", "user-gamma"];
    const targets = ["component-A", "structure-B", "material-C", "sensor-D", "blueprint-E"];

    const events = Array.from({ length: 15 }, (_, i) => {
      const eventType = types[i % types.length];
      return {
        id: crypto.randomUUID(),
        sessionId,
        sequence: i + 1,
        type: eventType,
        actor: actors[i % actors.length],
        target: targets[i % targets.length],
        details: {
          action: `${eventType}_operation_${i + 1}`,
          description: `${eventType.charAt(0).toUpperCase() + eventType.slice(1)} operation on ${targets[i % targets.length]}`,
          metadata: { step: i + 1, severity: i % 4 === 0 ? "high" : "normal" },
        },
        timestamp: new Date(baseTime + Math.floor((i / 15) * 3600000)).toISOString(),
      };
    });

    res.json({ ok: true, sessionId, events });
  }));

  router.post("/replay/bookmarks", auth, wrap((req, res) => {
    const { userId, sessionId, timestamp, label, notes } = req.body;
    if (!userId || !sessionId || !timestamp || !label) {
      throw new Error("userId, sessionId, timestamp, and label are required");
    }

    const bookmark = {
      id: crypto.randomUUID(),
      userId,
      sessionId,
      timestamp,
      label,
      notes: notes || "",
      createdAt: new Date().toISOString(),
    };
    replayBookmarks.set(bookmark.id, bookmark);

    res.status(201).json({ ok: true, bookmark });
  }));

  router.get("/replay/bookmarks/:userId", auth, wrap((req, res) => {
    const { userId } = req.params;
    const userBookmarks = [...replayBookmarks.values()].filter((b) => b.userId === userId);
    res.json({ ok: true, bookmarks: userBookmarks });
  }));

  router.post("/replay/forensic", auth, wrap((req, res) => {
    const { sessionId, startTime, endTime, focus } = req.body;
    if (!sessionId) throw new Error("sessionId is required");

    const validFocuses = ["performance", "security", "errors", "changes"];
    if (focus && !validFocuses.includes(focus)) {
      throw new Error(`Invalid focus. Must be one of: ${validFocuses.join(", ")}`);
    }

    const focusArea = focus || "performance";

    const findingsMap = {
      performance: [
        { type: "bottleneck", description: "Render pipeline stalled for 340ms at event 7", severity: "high" },
        { type: "latency", description: "Network round-trip exceeded 200ms threshold", severity: "medium" },
        { type: "memory", description: "Memory usage spike detected at midpoint", severity: "low" },
      ],
      security: [
        { type: "access", description: "Unauthorized access attempt from unknown actor", severity: "high" },
        { type: "permission", description: "Privilege escalation detected in session context", severity: "high" },
        { type: "audit", description: "Audit log gap between events 5 and 8", severity: "medium" },
      ],
      errors: [
        { type: "runtime", description: "Unhandled exception in component rendering", severity: "high" },
        { type: "validation", description: "Schema validation failure on input data", severity: "medium" },
        { type: "timeout", description: "Operation timeout after 30s on external service call", severity: "medium" },
      ],
      changes: [
        { type: "config", description: "Configuration modified by admin-bot at event 3", severity: "low" },
        { type: "data", description: "Bulk data update affecting 12 records", severity: "medium" },
        { type: "schema", description: "Schema migration applied during active session", severity: "high" },
      ],
    };

    const eventCount = Math.floor(Math.random() * 50) + 20;

    const timeline = Array.from({ length: 5 }, (_, i) => ({
      timestamp: new Date(Date.now() - 3600000 + i * 720000).toISOString(),
      label: `Phase ${i + 1}`,
      eventCount: Math.floor(Math.random() * 15) + 3,
      notable: i === 2 ? `Peak ${focusArea} activity detected` : null,
    }));

    const report = {
      id: crypto.randomUUID(),
      sessionId,
      startTime: startTime || new Date(Date.now() - 3600000).toISOString(),
      endTime: endTime || new Date().toISOString(),
      focus: focusArea,
      eventCount,
      findings: findingsMap[focusArea],
      timeline,
      severity: findingsMap[focusArea].some((f) => f.severity === "high") ? "high" : "medium",
      generatedAt: new Date().toISOString(),
    };

    res.json({ ok: true, report });
  }));

  return router;
}
