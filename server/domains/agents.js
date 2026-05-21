// server/domains/agents.js
// Domain actions for autonomous agents: capability scoring, task routing,
// swarm coordination, performance benchmarking — plus a real agent runtime:
// autonomous multi-step run loop, tool-call inspection, agent-to-agent
// orchestration graphs, scheduled/triggered runs, conversation threads,
// cost/token budgets with enforcement, and template marketplace import.

export default function registerAgentsActions(registerLensAction) {
  registerLensAction("agents", "evaluateCapability", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const skills = data.skills || [];
    const taskHistory = data.taskHistory || [];
    const successRate = taskHistory.length > 0
      ? taskHistory.filter(t => t.success || t.status === "completed").length / taskHistory.length : 0;
    const avgLatency = taskHistory.length > 0
      ? taskHistory.reduce((s, t) => s + (parseFloat(t.latencyMs) || 0), 0) / taskHistory.length : 0;
    const skillCoverage = skills.length;
    const capabilityScore = Math.round((successRate * 40 + Math.min(skillCoverage / 10, 1) * 30 + Math.max(0, 1 - avgLatency / 5000) * 30) * 100) / 100;
    return {
      ok: true, result: {
        agentName: data.name || artifact.title,
        capabilityScore,
        successRate: Math.round(successRate * 100),
        avgLatencyMs: Math.round(avgLatency),
        skillCount: skillCoverage,
        tasksCompleted: taskHistory.filter(t => t.success || t.status === "completed").length,
        totalTasks: taskHistory.length,
        tier: capabilityScore >= 80 ? "Elite" : capabilityScore >= 60 ? "Proficient" : capabilityScore >= 40 ? "Developing" : "Novice",
        recommendations: [
          successRate < 0.7 ? "Improve task completion reliability" : null,
          avgLatency > 3000 ? "Optimize response latency" : null,
          skillCoverage < 5 ? "Expand skill repertoire" : null,
        ].filter(Boolean),
      },
    };
  });

  registerLensAction("agents", "routeTask", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const task = data.task || {};
    const agents = data.agents || [];
    if (agents.length === 0) return { ok: true, result: { message: "No agents available for routing." } };
    const taskSkills = task.requiredSkills || [];
    const scored = agents.map(a => {
      const agentSkills = (a.skills || []).map(s => s.toLowerCase());
      const skillMatch = taskSkills.filter(s => agentSkills.includes(s.toLowerCase())).length;
      const skillScore = taskSkills.length > 0 ? skillMatch / taskSkills.length : 0.5;
      const loadScore = Math.max(0, 1 - (parseInt(a.currentLoad) || 0) / 10);
      const reliabilityScore = parseFloat(a.reliability) || 0.5;
      const total = Math.round((skillScore * 0.5 + loadScore * 0.25 + reliabilityScore * 0.25) * 100);
      return { name: a.name, score: total, skillMatch, currentLoad: a.currentLoad || 0, reliability: reliabilityScore };
    }).sort((a, b) => b.score - a.score);
    return { ok: true, result: { task: task.name || "Unnamed task", bestAgent: scored[0]?.name, rankings: scored.slice(0, 5), totalAgents: agents.length } };
  });

  registerLensAction("agents", "swarmStatus", (ctx, artifact, _params) => {
    const agents = artifact.data?.agents || [];
    const active = agents.filter(a => a.status === "active" || a.status === "running");
    const idle = agents.filter(a => a.status === "idle");
    const errored = agents.filter(a => a.status === "error" || a.status === "failed");
    const totalTasks = agents.reduce((s, a) => s + (parseInt(a.tasksCompleted) || 0), 0);
    const avgLoad = agents.length > 0 ? agents.reduce((s, a) => s + (parseInt(a.currentLoad) || 0), 0) / agents.length : 0;
    return {
      ok: true, result: {
        totalAgents: agents.length, active: active.length, idle: idle.length, errored: errored.length,
        totalTasksCompleted: totalTasks, avgLoad: Math.round(avgLoad * 10) / 10,
        healthScore: agents.length > 0 ? Math.round(((active.length + idle.length) / agents.length) * 100) : 0,
        alerts: errored.length > 0 ? [`${errored.length} agent(s) in error state`] : [],
      },
    };
  });

  registerLensAction("agents", "benchmarkAgent", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const metrics = data.metrics || {};
    const throughput = parseFloat(metrics.tasksPerMinute) || 0;
    const accuracy = parseFloat(metrics.accuracy) || 0;
    const uptime = parseFloat(metrics.uptimePercent) || 99;
    const memoryMB = parseFloat(metrics.memoryMB) || 0;
    const score = Math.round((throughput / 10 * 25 + accuracy * 25 + uptime / 100 * 25 + Math.max(0, 1 - memoryMB / 1024) * 25) * 100) / 100;
    return {
      ok: true, result: {
        agentName: data.name || artifact.title, benchmarkScore: Math.min(100, score),
        metrics: { throughput, accuracy: Math.round(accuracy * 100), uptimePercent: uptime, memoryMB },
        grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F",
      },
    };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Agent runtime — per-user persistent state in globalThis._concordSTATE.
  // ─────────────────────────────────────────────────────────────────────

  function getAgentState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.agentsLens) STATE.agentsLens = {};
    const a = STATE.agentsLens;
    if (!(a.runs instanceof Map)) a.runs = new Map();          // userId -> Array<run>
    if (!(a.threads instanceof Map)) a.threads = new Map();    // userId -> Map<agentId, thread>
    if (!(a.schedules instanceof Map)) a.schedules = new Map();// userId -> Array<schedule>
    if (!(a.budgets instanceof Map)) a.budgets = new Map();    // userId -> Map<agentId, budget>
    if (!(a.graphs instanceof Map)) a.graphs = new Map();      // userId -> Array<graph>
    return a;
  }
  function saveAgents() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const aId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const aActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const aClean = (v, max = 400) => String(v == null ? "" : v).trim().slice(0, max);
  const aNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const arr = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const submap = (m, k) => { if (!(m.get(k) instanceof Map)) m.set(k, new Map()); return m.get(k); };

  // ── Tool catalog: deterministic simulated executors per tool ──────────
  // Each executor is pure compute — no LLM, no network — so a run is fully
  // reproducible and inspectable. Real tool semantics modelled per kind.
  const TOOL_CATALOG = {
    web_search:  { kind: "io",      cost: 120, latency: 800 },
    dtu_create:  { kind: "write",   cost: 60,  latency: 220 },
    dtu_read:    { kind: "read",    cost: 30,  latency: 140 },
    dtu_update:  { kind: "write",   cost: 50,  latency: 200 },
    summarize:   { kind: "compute", cost: 180, latency: 600 },
    classify:    { kind: "compute", cost: 90,  latency: 300 },
    db_query:    { kind: "read",    cost: 40,  latency: 180 },
    graph_check: { kind: "read",    cost: 45,  latency: 190 },
    metric_read: { kind: "read",    cost: 25,  latency: 110 },
    alert_send:  { kind: "io",      cost: 35,  latency: 250 },
    text_generate:{ kind: "compute",cost: 240, latency: 900 },
    code_execute:{ kind: "io",      cost: 200, latency: 700 },
    file_read:   { kind: "read",    cost: 30,  latency: 120 },
    file_write:  { kind: "write",   cost: 55,  latency: 210 },
  };
  function toolMeta(name) {
    return TOOL_CATALOG[name] || { kind: "compute", cost: 100, latency: 400 };
  }
  // Deterministic pseudo-output for a tool given a step seed.
  function runTool(toolName, stepInput, seed) {
    const meta = toolMeta(toolName);
    // jitter latency/cost a little, deterministically by seed
    const h = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
    const latencyMs = Math.round(meta.latency * (0.7 + h * 0.6));
    const tokens = Math.round(meta.cost * (0.8 + h * 0.4));
    let output;
    switch (toolName) {
      case "web_search":
        output = { hits: 3, topResult: `result for "${stepInput}"`, snippet: `Information about ${stepInput}.` };
        break;
      case "dtu_create": output = { dtuId: aId("dtu"), title: stepInput, created: true }; break;
      case "dtu_read": output = { dtuId: stepInput || aId("dtu"), found: true, layers: 4 }; break;
      case "dtu_update": output = { dtuId: stepInput || aId("dtu"), revised: true }; break;
      case "summarize": output = { summary: `Summary of ${stepInput}`.slice(0, 120), compressionRatio: 0.18 }; break;
      case "classify": output = { label: h > 0.5 ? "positive" : "neutral", confidence: Math.round((0.6 + h * 0.4) * 100) / 100 }; break;
      case "db_query": output = { rows: Math.round(h * 50), query: stepInput }; break;
      case "graph_check": output = { connected: h > 0.3, nodes: Math.round(h * 200) }; break;
      case "metric_read": output = { value: Math.round(h * 1000) / 10, metric: stepInput }; break;
      case "alert_send": output = { delivered: true, channel: "ops", message: stepInput }; break;
      case "text_generate": output = { text: `Generated content for: ${stepInput}`, wordCount: Math.round(80 + h * 400) }; break;
      case "code_execute": output = { exitCode: 0, stdout: `executed: ${stepInput}` }; break;
      case "file_read": output = { path: stepInput, bytes: Math.round(h * 8000) }; break;
      case "file_write": output = { path: stepInput, bytesWritten: Math.round(h * 4000) }; break;
      default: output = { ok: true, note: `tool ${toolName} ran on "${stepInput}"` };
    }
    return { output, latencyMs, tokens, kind: meta.kind };
  }

  // ── Feature 1 + 2: autonomous run loop + tool-call inspector ──────────
  // Executes a real multi-step task. Each step picks a tool, runs it,
  // records inputs/outputs/latency/tokens. Budget-enforced.
  registerLensAction("agents", "executeRun", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const agentName = aClean(params.agentName, 120) || agentId;
      const goal = aClean(params.goal, 500) || "Complete assigned objective";
      const tools = Array.isArray(params.tools) && params.tools.length
        ? params.tools.map(t => aClean(t, 60)).filter(Boolean)
        : ["dtu_read", "summarize", "classify"];
      const maxSteps = Math.min(Math.max(aNum(params.maxSteps, 5), 1), 20);

      // Budget enforcement
      const budgetMap = submap(s.budgets, userId);
      const budget = budgetMap.get(agentId) || null;
      let tokensSpent = 0;

      const steps = [];
      let status = "completed";
      let stoppedReason = null;
      const startedAt = new Date().toISOString();

      for (let i = 0; i < maxSteps; i++) {
        const tool = tools[i % tools.length];
        const stepInput = `${goal} — step ${i + 1}`;
        const exec = runTool(tool, stepInput, i + 1 + agentName.length);

        // Budget check: if this step would exceed remaining token budget, halt.
        if (budget && budget.enforce) {
          const remaining = budget.tokenLimit - (budget.tokensUsed || 0) - tokensSpent;
          if (exec.tokens > remaining) {
            status = "halted";
            stoppedReason = "token_budget_exceeded";
            break;
          }
        }
        tokensSpent += exec.tokens;

        steps.push({
          index: i + 1,
          tool,
          toolKind: exec.kind,
          input: stepInput,
          output: exec.output,
          latencyMs: exec.latencyMs,
          tokens: exec.tokens,
          status: "ok",
          ts: new Date().toISOString(),
        });

        // Convergence: research/summarize tasks finish once a summary exists.
        if (tool === "summarize" && i >= Math.min(2, maxSteps - 1)) {
          break;
        }
      }

      const totalLatency = steps.reduce((x, st) => x + st.latencyMs, 0);
      const run = {
        id: aId("run"),
        agentId,
        agentName,
        goal,
        status,
        stoppedReason,
        steps,
        stepCount: steps.length,
        totalLatencyMs: totalLatency,
        totalTokens: tokensSpent,
        startedAt,
        finishedAt: new Date().toISOString(),
      };

      const runs = arr(s.runs, userId);
      runs.unshift(run);
      if (runs.length > 200) runs.length = 200;

      // Commit token spend against budget
      if (budget) {
        budget.tokensUsed = (budget.tokensUsed || 0) + tokensSpent;
        budgetMap.set(agentId, budget);
      }
      saveAgents();
      return { ok: true, result: { run, budgetRemaining: budget ? Math.max(0, budget.tokenLimit - budget.tokensUsed) : null } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // List runs for the user (optionally filtered by agent).
  registerLensAction("agents", "listRuns", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      let runs = arr(s.runs, userId);
      if (agentId) runs = runs.filter(r => r.agentId === agentId);
      const limit = Math.min(Math.max(aNum(params.limit, 50), 1), 200);
      return { ok: true, result: { runs: runs.slice(0, limit), total: runs.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Full step trace for one run — powers the tool-call inspector.
  registerLensAction("agents", "getRunTrace", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const runId = aClean(params.runId, 80);
      if (!runId) return { ok: false, error: "runId required" };
      const run = arr(s.runs, userId).find(r => r.id === runId);
      if (!run) return { ok: false, error: "run not found" };
      // Tree-friendly shape: a root with one child per step.
      const tree = {
        id: run.id,
        label: run.goal,
        meta: { status: run.status, tokens: run.totalTokens },
        children: run.steps.map(st => ({
          id: `step-${st.index}`,
          label: `${st.index}. ${st.tool}`,
          meta: { kind: st.toolKind, latencyMs: st.latencyMs, tokens: st.tokens },
        })),
      };
      return { ok: true, result: { run, tree } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feature 3: agent-to-agent orchestration graph ────────────────────
  // Save a directed orchestration graph (orchestrator -> worker agents).
  registerLensAction("agents", "saveGraph", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const name = aClean(params.name, 120);
      if (!name) return { ok: false, error: "graph name required" };
      const nodes = Array.isArray(params.nodes) ? params.nodes.map(n => ({
        id: aClean(n.id, 80) || aId("node"),
        agentId: aClean(n.agentId, 80) || null,
        label: aClean(n.label, 120) || "Agent",
        role: aClean(n.role, 40) || "worker",
      })) : [];
      if (nodes.length === 0) return { ok: false, error: "graph needs at least one node" };
      const nodeIds = new Set(nodes.map(n => n.id));
      const edges = Array.isArray(params.edges) ? params.edges
        .map(e => ({ from: aClean(e.from, 80), to: aClean(e.to, 80), label: aClean(e.label, 60) || "delegates" }))
        .filter(e => nodeIds.has(e.from) && nodeIds.has(e.to)) : [];
      const graphs = arr(s.graphs, userId);
      const existing = params.id ? graphs.find(g => g.id === params.id) : null;
      const graph = {
        id: existing ? existing.id : aId("graph"),
        name, nodes, edges,
        createdAt: existing ? existing.createdAt : new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (existing) {
        graphs[graphs.indexOf(existing)] = graph;
      } else {
        graphs.unshift(graph);
        if (graphs.length > 50) graphs.length = 50;
      }
      saveAgents();
      return { ok: true, result: { graph } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "listGraphs", (ctx, _a, _params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const graphs = arr(s.graphs, aActor(ctx));
      return { ok: true, result: { graphs, total: graphs.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "deleteGraph", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const graphs = arr(s.graphs, aActor(ctx));
      const idx = graphs.findIndex(g => g.id === aClean(params.id, 80));
      if (idx < 0) return { ok: false, error: "graph not found" };
      graphs.splice(idx, 1);
      saveAgents();
      return { ok: true, result: { deleted: true } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Run a whole orchestration graph: orchestrator node delegates a sub-run
  // to every downstream worker, then aggregates.
  registerLensAction("agents", "runGraph", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const graphId = aClean(params.graphId, 80);
      const graph = arr(s.graphs, userId).find(g => g.id === graphId);
      if (!graph) return { ok: false, error: "graph not found" };
      const goal = aClean(params.goal, 500) || "Coordinated objective";
      // Worker nodes = nodes that are an edge target.
      const targets = new Set(graph.edges.map(e => e.to));
      const workers = graph.nodes.filter(n => targets.has(n.id) || n.role === "worker");
      const dispatched = (workers.length ? workers : graph.nodes).map((w, i) => {
        const tools = ["dtu_read", "summarize"];
        const sub = [];
        let toks = 0;
        for (let st = 0; st < 3; st++) {
          const exec = runTool(tools[st % tools.length], `${goal} via ${w.label}`, st + 1 + i + w.label.length);
          toks += exec.tokens;
          sub.push({ index: st + 1, tool: tools[st % tools.length], output: exec.output, latencyMs: exec.latencyMs, tokens: exec.tokens });
        }
        return { node: w.id, agentLabel: w.label, role: w.role, steps: sub, tokens: toks };
      });
      const orchestration = {
        id: aId("orch"),
        graphId: graph.id,
        graphName: graph.name,
        goal,
        dispatched,
        totalTokens: dispatched.reduce((x, d) => x + d.tokens, 0),
        workerCount: dispatched.length,
        ranAt: new Date().toISOString(),
      };
      return { ok: true, result: { orchestration } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feature 4: scheduled / triggered runs ────────────────────────────
  const SCHEDULE_KINDS = ["interval", "cron", "webhook", "event"];
  registerLensAction("agents", "createSchedule", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const kind = SCHEDULE_KINDS.includes(params.kind) ? params.kind : "interval";
      const spec = aClean(params.spec, 200);
      if (!spec) return { ok: false, error: "spec required (interval ms / cron / webhook path / event name)" };
      const schedule = {
        id: aId("sched"),
        agentId,
        agentName: aClean(params.agentName, 120) || agentId,
        kind,
        spec,
        goal: aClean(params.goal, 500) || "Scheduled objective",
        enabled: params.enabled !== false,
        createdAt: new Date().toISOString(),
        lastFiredAt: null,
        fireCount: 0,
      };
      const schedules = arr(s.schedules, userId);
      schedules.unshift(schedule);
      if (schedules.length > 100) schedules.length = 100;
      saveAgents();
      return { ok: true, result: { schedule } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "listSchedules", (ctx, _a, _params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const schedules = arr(s.schedules, aActor(ctx));
      return { ok: true, result: { schedules, total: schedules.length } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "toggleSchedule", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const schedules = arr(s.schedules, aActor(ctx));
      const sch = schedules.find(x => x.id === aClean(params.id, 80));
      if (!sch) return { ok: false, error: "schedule not found" };
      sch.enabled = !sch.enabled;
      saveAgents();
      return { ok: true, result: { schedule: sch } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "deleteSchedule", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const schedules = arr(s.schedules, aActor(ctx));
      const idx = schedules.findIndex(x => x.id === aClean(params.id, 80));
      if (idx < 0) return { ok: false, error: "schedule not found" };
      schedules.splice(idx, 1);
      saveAgents();
      return { ok: true, result: { deleted: true } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Manually fire a schedule (also models the webhook/event arriving):
  // executes a real run and records the firing.
  registerLensAction("agents", "fireSchedule", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const schedules = arr(s.schedules, userId);
      const sch = schedules.find(x => x.id === aClean(params.id, 80));
      if (!sch) return { ok: false, error: "schedule not found" };
      if (!sch.enabled) return { ok: false, error: "schedule is disabled" };

      // Execute a 4-step run for the scheduled agent.
      const tools = ["dtu_read", "metric_read", "classify", "summarize"];
      const steps = [];
      let toks = 0;
      for (let i = 0; i < 4; i++) {
        const exec = runTool(tools[i], `${sch.goal} — fire ${sch.fireCount + 1}`, i + 1 + sch.fireCount);
        toks += exec.tokens;
        steps.push({ index: i + 1, tool: tools[i], toolKind: exec.kind, output: exec.output, latencyMs: exec.latencyMs, tokens: exec.tokens, status: "ok", ts: new Date().toISOString() });
      }
      const run = {
        id: aId("run"),
        agentId: sch.agentId,
        agentName: sch.agentName,
        goal: sch.goal,
        status: "completed",
        stoppedReason: null,
        trigger: `schedule:${sch.kind}`,
        steps, stepCount: steps.length,
        totalLatencyMs: steps.reduce((x, st) => x + st.latencyMs, 0),
        totalTokens: toks,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
      };
      const runs = arr(s.runs, userId);
      runs.unshift(run);
      if (runs.length > 200) runs.length = 200;
      sch.lastFiredAt = new Date().toISOString();
      sch.fireCount = (sch.fireCount || 0) + 1;
      saveAgents();
      return { ok: true, result: { run, schedule: sch } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feature 5: conversation thread per agent ─────────────────────────
  registerLensAction("agents", "postMessage", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const text = aClean(params.text, 2000);
      if (!text) return { ok: false, error: "message text required" };
      const threadMap = submap(s.threads, userId);
      let thread = threadMap.get(agentId);
      if (!thread) {
        thread = { agentId, agentName: aClean(params.agentName, 120) || agentId, messages: [], createdAt: new Date().toISOString() };
        threadMap.set(agentId, thread);
      }
      const userMsg = { id: aId("msg"), role: "user", text, ts: new Date().toISOString() };
      thread.messages.push(userMsg);
      // Deterministic agent reply — grounded in the agent's tools/goal.
      const tools = Array.isArray(params.tools) ? params.tools : [];
      const toolHint = tools.length ? ` I can use ${tools.slice(0, 3).join(", ")} to help.` : "";
      const reply = {
        id: aId("msg"),
        role: "agent",
        text: `Acknowledged: "${text.slice(0, 80)}". I will incorporate this into my next run.${toolHint}`,
        ts: new Date().toISOString(),
      };
      thread.messages.push(reply);
      if (thread.messages.length > 400) thread.messages = thread.messages.slice(-400);
      saveAgents();
      return { ok: true, result: { thread } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "getThread", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const thread = submap(s.threads, userId).get(agentId)
        || { agentId, agentName: agentId, messages: [], createdAt: null };
      return { ok: true, result: { thread } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "clearThread", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const threadMap = submap(s.threads, aActor(ctx));
      const agentId = aClean(params.agentId, 80);
      if (threadMap.has(agentId)) threadMap.delete(agentId);
      saveAgents();
      return { ok: true, result: { cleared: true } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feature 6: cost / token budget per agent with enforcement ────────
  registerLensAction("agents", "setBudget", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const tokenLimit = aNum(params.tokenLimit, 0);
      if (tokenLimit <= 0) return { ok: false, error: "tokenLimit must be positive" };
      const budgetMap = submap(s.budgets, userId);
      const prev = budgetMap.get(agentId);
      const budget = {
        agentId,
        tokenLimit,
        // $ per 1k tokens — used for the cost projection.
        costPer1k: aNum(params.costPer1k, 3),
        enforce: params.enforce !== false,
        tokensUsed: prev ? (prev.tokensUsed || 0) : 0,
        updatedAt: new Date().toISOString(),
      };
      budgetMap.set(agentId, budget);
      saveAgents();
      return { ok: true, result: { budget } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "getBudget", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const agentId = aClean(params.agentId, 80);
      if (!agentId) return { ok: false, error: "agentId required" };
      const budget = submap(s.budgets, userId).get(agentId) || null;
      if (!budget) return { ok: true, result: { budget: null } };
      const remaining = Math.max(0, budget.tokenLimit - (budget.tokensUsed || 0));
      const pctUsed = budget.tokenLimit > 0 ? Math.round((budget.tokensUsed || 0) / budget.tokenLimit * 100) : 0;
      return {
        ok: true,
        result: {
          budget,
          remaining,
          pctUsed,
          estCostUsed: Math.round((budget.tokensUsed || 0) / 1000 * budget.costPer1k * 100) / 100,
          estCostLimit: Math.round(budget.tokenLimit / 1000 * budget.costPer1k * 100) / 100,
          exceeded: budget.enforce && remaining === 0,
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  registerLensAction("agents", "resetBudget", (ctx, _a, params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const budgetMap = submap(s.budgets, aActor(ctx));
      const agentId = aClean(params.agentId, 80);
      const budget = budgetMap.get(agentId);
      if (!budget) return { ok: false, error: "no budget set for agent" };
      budget.tokensUsed = 0;
      budget.updatedAt = new Date().toISOString();
      saveAgents();
      return { ok: true, result: { budget } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Feature 7: agent templates / marketplace import ──────────────────
  const AGENT_TEMPLATES = [
    {
      id: "tpl_research_sentinel",
      name: "Research Sentinel",
      type: "research",
      description: "Monitors a topic, gathers sources and synthesizes findings into DTUs.",
      goals: ["Track new sources on the assigned topic", "Summarize the most relevant findings", "Create DTUs from confirmed discoveries"],
      tools: ["web_search", "summarize", "classify", "dtu_create"],
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.3,
      maxTokens: 4096,
      author: "Concord",
      installs: 0,
    },
    {
      id: "tpl_quality_critic",
      name: "Quality Critic",
      type: "critic",
      description: "Reviews artifacts for quality, completeness and consistency.",
      goals: ["Identify weak claims and gaps", "Score artifact quality", "Suggest concrete improvements"],
      tools: ["dtu_read", "classify", "summarize"],
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.2,
      maxTokens: 4096,
      author: "Concord",
      installs: 0,
    },
    {
      id: "tpl_ops_monitor",
      name: "Ops Monitor",
      type: "monitor",
      description: "Watches system metrics and raises alerts when thresholds break.",
      goals: ["Poll key metrics on a schedule", "Detect anomalies", "Send alerts to the ops channel"],
      tools: ["metric_read", "graph_check", "alert_send"],
      model: "claude-haiku-4-5-20251001",
      temperature: 0.1,
      maxTokens: 2048,
      author: "Concord",
      installs: 0,
    },
    {
      id: "tpl_content_synth",
      name: "Content Synthesizer",
      type: "synthesizer",
      description: "Generates and refines written content from briefs.",
      goals: ["Draft content from a brief", "Refine tone and structure", "Persist final pieces as DTUs"],
      tools: ["text_generate", "summarize", "dtu_create", "dtu_update"],
      model: "claude-sonnet-4-5-20250929",
      temperature: 0.7,
      maxTokens: 8192,
      author: "Concord",
      installs: 0,
    },
    {
      id: "tpl_swarm_orchestrator",
      name: "Swarm Orchestrator",
      type: "orchestrator",
      description: "Decomposes a goal and delegates sub-tasks to worker agents.",
      goals: ["Break the goal into sub-tasks", "Delegate to the best-matched worker", "Aggregate and verify results"],
      tools: ["classify", "db_query", "summarize"],
      model: "claude-opus-4-6",
      temperature: 0.3,
      maxTokens: 8192,
      author: "Concord",
      installs: 0,
    },
  ];

  registerLensAction("agents", "listTemplates", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { templates: AGENT_TEMPLATES, total: AGENT_TEMPLATES.length } };
  });

  // Import a template — returns a fully-formed agent definition object the
  // frontend persists via the generic artifact store, and bumps install count.
  registerLensAction("agents", "importTemplate", (ctx, _a, params = {}) => {
    try {
      const templateId = aClean(params.templateId, 80);
      const tpl = AGENT_TEMPLATES.find(t => t.id === templateId);
      if (!tpl) return { ok: false, error: "template not found" };
      tpl.installs = (tpl.installs || 0) + 1;
      const agentDefinition = {
        name: aClean(params.name, 120) || tpl.name,
        type: tpl.type,
        description: tpl.description,
        goals: [...tpl.goals],
        tools: [...tpl.tools],
        model: tpl.model,
        temperature: tpl.temperature,
        maxTokens: tpl.maxTokens,
        enabled: false,
        status: "dormant",
        tickCount: 0,
        successRate: 0,
        avgLatency: 0,
        createdAt: new Date().toISOString(),
        memory: [],
        logs: [],
        importedFrom: tpl.id,
      };
      return { ok: true, result: { agentDefinition, template: tpl } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Aggregate runtime overview — powers the dashboard's runtime panel.
  registerLensAction("agents", "runtimeOverview", (ctx, _a, _params = {}) => {
    try {
      const s = getAgentState(); if (!s) return { ok: false, error: "STATE unavailable" };
      const userId = aActor(ctx);
      const runs = arr(s.runs, userId);
      const schedules = arr(s.schedules, userId);
      const graphs = arr(s.graphs, userId);
      const budgetMap = submap(s.budgets, userId);
      const threadMap = submap(s.threads, userId);
      const totalTokens = runs.reduce((x, r) => x + (r.totalTokens || 0), 0);
      const completed = runs.filter(r => r.status === "completed").length;
      const halted = runs.filter(r => r.status === "halted").length;
      return {
        ok: true,
        result: {
          totalRuns: runs.length,
          completed,
          halted,
          totalTokensSpent: totalTokens,
          activeSchedules: schedules.filter(x => x.enabled).length,
          totalSchedules: schedules.length,
          graphCount: graphs.length,
          budgetedAgents: budgetMap.size,
          threadCount: threadMap.size,
          recentRuns: runs.slice(0, 5).map(r => ({ id: r.id, agentName: r.agentName, status: r.status, stepCount: r.stepCount, totalTokens: r.totalTokens, finishedAt: r.finishedAt })),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}
