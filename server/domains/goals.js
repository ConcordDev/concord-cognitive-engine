// server/domains/goals.js
// Domain actions for goal tracking and OKR management: OKR scoring,
// goal decomposition, and progress forecasting.

export default function registerGoalsActions(registerLensAction) {
  /**
   * okrScoring
   * Score OKR progress with weighted key result completion, confidence-adjusted
   * projections, and red/yellow/green status determination.
   * artifact.data.objectives = [{
   *   id, title, weight?,
   *   keyResults: [{ id, title, target, current, unit?, weight?, confidence?, startValue? }]
   * }]
   * params.periodEndDate (optional), params.periodStartDate (optional)
   */
  registerLensAction("goals", "okrScoring", (ctx, artifact, params) => {
  try {
    const objectives = artifact.data?.objectives || [];
    if (objectives.length === 0) {
      return { ok: true, result: { message: "No objectives provided." } };
    }

    const periodStart = params.periodStartDate ? new Date(params.periodStartDate).getTime() : null;
    const periodEnd = params.periodEndDate ? new Date(params.periodEndDate).getTime() : null;
    const now = Date.now();
    const periodProgress = periodStart && periodEnd && periodEnd > periodStart
      ? Math.min(1, Math.max(0, (now - periodStart) / (periodEnd - periodStart)))
      : null;

    const objectiveResults = [];
    let overallWeightedScore = 0;
    let overallWeightTotal = 0;

    for (const obj of objectives) {
      const keyResults = obj.keyResults || [];
      const objWeight = obj.weight || 1;

      let krWeightedScore = 0;
      let krWeightTotal = 0;
      const krResults = [];

      for (const kr of keyResults) {
        const target = kr.target ?? 100;
        const current = kr.current ?? 0;
        const startValue = kr.startValue ?? 0;
        const weight = kr.weight || 1;
        const confidence = kr.confidence != null ? Math.max(0, Math.min(1, kr.confidence)) : 1;

        // Calculate raw progress (handle both increasing and decreasing targets)
        const range = target - startValue;
        const rawProgress = range !== 0 ? (current - startValue) / range : (current >= target ? 1 : 0);
        const progress = Math.max(0, Math.min(1.5, rawProgress)); // cap at 150%

        // Confidence-adjusted score
        const adjustedScore = progress * confidence;

        // Determine status
        let status;
        if (periodProgress !== null) {
          const expectedProgress = periodProgress;
          const ratio = expectedProgress > 0 ? progress / expectedProgress : (progress > 0 ? 1.5 : 0.5);
          if (ratio >= 0.8) status = "green";
          else if (ratio >= 0.5) status = "yellow";
          else status = "red";
        } else {
          if (progress >= 0.7) status = "green";
          else if (progress >= 0.4) status = "yellow";
          else status = "red";
        }

        // Projected completion
        let projectedCompletion = null;
        if (periodProgress !== null && periodProgress > 0.05 && progress > 0) {
          const projectedFinalProgress = progress / periodProgress;
          projectedCompletion = Math.round(Math.min(2, projectedFinalProgress) * 10000) / 100;
        }

        krResults.push({
          id: kr.id,
          title: kr.title,
          target,
          current,
          unit: kr.unit,
          progress: Math.round(progress * 10000) / 100,
          confidence,
          adjustedScore: Math.round(adjustedScore * 10000) / 100,
          status,
          projectedCompletion,
          onTrack: status === "green",
        });

        krWeightedScore += adjustedScore * weight;
        krWeightTotal += weight;
      }

      const objectiveScore = krWeightTotal > 0
        ? krWeightedScore / krWeightTotal
        : 0;

      const objectiveStatus =
        objectiveScore >= 0.7 ? "green" :
        objectiveScore >= 0.4 ? "yellow" : "red";

      objectiveResults.push({
        id: obj.id,
        title: obj.title,
        weight: objWeight,
        score: Math.round(objectiveScore * 10000) / 100,
        status: objectiveStatus,
        keyResults: krResults,
        krCount: krResults.length,
        krOnTrack: krResults.filter(kr => kr.onTrack).length,
        krAtRisk: krResults.filter(kr => kr.status === "yellow").length,
        krOffTrack: krResults.filter(kr => kr.status === "red").length,
      });

      overallWeightedScore += objectiveScore * objWeight;
      overallWeightTotal += objWeight;
    }

    const overallScore = overallWeightTotal > 0
      ? overallWeightedScore / overallWeightTotal
      : 0;

    const overallStatus =
      overallScore >= 0.7 ? "green" :
      overallScore >= 0.4 ? "yellow" : "red";

    // Summary statistics
    const allKRs = objectiveResults.flatMap(o => o.keyResults);
    const totalKRs = allKRs.length;

    return {
      ok: true,
      result: {
        overallScore: Math.round(overallScore * 10000) / 100,
        overallStatus,
        periodProgress: periodProgress !== null ? Math.round(periodProgress * 10000) / 100 : null,
        objectives: objectiveResults,
        summary: {
          objectiveCount: objectives.length,
          totalKeyResults: totalKRs,
          onTrack: allKRs.filter(kr => kr.status === "green").length,
          atRisk: allKRs.filter(kr => kr.status === "yellow").length,
          offTrack: allKRs.filter(kr => kr.status === "red").length,
          avgProgress: Math.round(allKRs.reduce((s, kr) => s + kr.progress, 0) / Math.max(totalKRs, 1) * 100) / 100,
          avgConfidence: Math.round(allKRs.reduce((s, kr) => s + kr.confidence, 0) / Math.max(totalKRs, 1) * 1000) / 1000,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * goalDecomposition
   * Decompose goals into sub-goals with dependency graph, critical path
   * identification, and resource allocation.
   * artifact.data.goals = [{
   *   id, title, duration?, effort?, resources?: [], dependencies?: [goalId],
   *   subGoals?: [{ id, title, duration?, effort?, dependencies? }]
   * }]
   */
  registerLensAction("goals", "goalDecomposition", (ctx, artifact, _params) => {
  try {
    const goals = artifact.data?.goals || [];
    if (goals.length === 0) {
      return { ok: true, result: { message: "No goals provided." } };
    }

    // Flatten goals and sub-goals into a single task list
    const tasks = [];
    const taskMap = {};

    for (const goal of goals) {
      const task = {
        id: goal.id,
        title: goal.title,
        duration: goal.duration || 1,
        effort: goal.effort || goal.duration || 1,
        resources: goal.resources || [],
        dependencies: goal.dependencies || [],
        isSubGoal: false,
        parentId: null,
      };
      tasks.push(task);
      taskMap[task.id] = task;

      for (const sub of (goal.subGoals || [])) {
        const subTask = {
          id: sub.id,
          title: sub.title,
          duration: sub.duration || 1,
          effort: sub.effort || sub.duration || 1,
          resources: sub.resources || [],
          dependencies: sub.dependencies || [goal.id],
          isSubGoal: true,
          parentId: goal.id,
        };
        tasks.push(subTask);
        taskMap[subTask.id] = subTask;
      }
    }

    // Validate dependencies
    const invalidDeps = [];
    for (const task of tasks) {
      for (const depId of task.dependencies) {
        if (!taskMap[depId]) {
          invalidDeps.push({ taskId: task.id, missingDependency: depId });
        }
      }
    }

    // Topological sort for scheduling
    const inDegree = {};
    const adjList = {};
    for (const task of tasks) {
      inDegree[task.id] = 0;
      adjList[task.id] = [];
    }
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (taskMap[dep]) {
          adjList[dep].push(task.id);
          inDegree[task.id]++;
        }
      }
    }

    // Kahn's algorithm
    const topoOrder = [];
    const queue = [];
    for (const task of tasks) {
      if (inDegree[task.id] === 0) queue.push(task.id);
    }
    const tempInDegree = { ...inDegree };
    while (queue.length > 0) {
      const id = queue.shift();
      topoOrder.push(id);
      for (const neighbor of adjList[id]) {
        tempInDegree[neighbor]--;
        if (tempInDegree[neighbor] === 0) queue.push(neighbor);
      }
    }

    const hasCycle = topoOrder.length < tasks.length;
    const cyclicTasks = hasCycle ? tasks.filter(t => !topoOrder.includes(t.id)).map(t => t.id) : [];

    // Forward pass: compute earliest start and finish times
    const earliest = {};
    for (const id of topoOrder) {
      const task = taskMap[id];
      let es = 0;
      for (const dep of task.dependencies) {
        if (earliest[dep]) {
          es = Math.max(es, earliest[dep].finish);
        }
      }
      earliest[id] = { start: es, finish: es + task.duration };
    }

    // Project duration
    const projectDuration = Math.max(...Object.values(earliest).map(e => e.finish), 0);

    // Backward pass: compute latest start and finish times
    const latest = {};
    for (let i = topoOrder.length - 1; i >= 0; i--) {
      const id = topoOrder[i];
      const task = taskMap[id];
      let lf = projectDuration;
      for (const successor of adjList[id]) {
        if (latest[successor]) {
          lf = Math.min(lf, latest[successor].start);
        }
      }
      latest[id] = { start: lf - task.duration, finish: lf };
    }

    // Compute slack and identify critical path
    const taskSchedules = [];
    const criticalPath = [];
    for (const id of topoOrder) {
      const task = taskMap[id];
      const e = earliest[id] || { start: 0, finish: task.duration };
      const l = latest[id] || { start: 0, finish: task.duration };
      const slack = l.start - e.start;
      const isCritical = Math.abs(slack) < 0.001;

      if (isCritical) criticalPath.push(id);

      taskSchedules.push({
        id,
        title: task.title,
        duration: task.duration,
        effort: task.effort,
        dependencies: task.dependencies,
        isSubGoal: task.isSubGoal,
        parentId: task.parentId,
        earliestStart: e.start,
        earliestFinish: e.finish,
        latestStart: l.start,
        latestFinish: l.finish,
        slack,
        isCritical,
      });
    }

    // Resource allocation analysis
    const resourceLoad = {};
    for (const task of tasks) {
      for (const resource of task.resources) {
        if (!resourceLoad[resource]) resourceLoad[resource] = { totalEffort: 0, taskCount: 0, tasks: [] };
        resourceLoad[resource].totalEffort += task.effort;
        resourceLoad[resource].taskCount++;
        resourceLoad[resource].tasks.push(task.id);
      }
    }

    // Resource conflicts: find resources assigned to concurrent tasks
    const resourceConflicts = [];
    for (const [resource, load] of Object.entries(resourceLoad)) {
      const concurrentPairs = [];
      for (let i = 0; i < load.tasks.length; i++) {
        for (let j = i + 1; j < load.tasks.length; j++) {
          const eA = earliest[load.tasks[i]];
          const eB = earliest[load.tasks[j]];
          if (eA && eB) {
            // Check overlap
            if (eA.start < eB.finish && eB.start < eA.finish) {
              concurrentPairs.push([load.tasks[i], load.tasks[j]]);
            }
          }
        }
      }
      if (concurrentPairs.length > 0) {
        resourceConflicts.push({ resource, concurrentPairs });
      }
    }

    // Depth of decomposition
    function getDepth(taskId, visited = new Set()) {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);
      const children = tasks.filter(t => t.parentId === taskId);
      if (children.length === 0) return 0;
      return 1 + Math.max(...children.map(c => getDepth(c.id, visited)));
    }
    const maxDepth = Math.max(...goals.map(g => getDepth(g.id)), 0);

    return {
      ok: true,
      result: {
        totalTasks: tasks.length,
        topLevelGoals: goals.length,
        subGoalCount: tasks.filter(t => t.isSubGoal).length,
        maxDecompositionDepth: maxDepth,
        projectDuration,
        criticalPath: { length: criticalPath.length, tasks: criticalPath },
        hasCycle,
        cyclicTasks,
        invalidDependencies: invalidDeps,
        schedule: taskSchedules,
        resourceAllocation: Object.entries(resourceLoad).map(([resource, load]) => ({
          resource,
          totalEffort: load.totalEffort,
          taskCount: load.taskCount,
          tasks: load.tasks,
        })),
        resourceConflicts,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * progressForecast
   * Forecast goal completion using linear regression on historical progress data.
   * Trend extrapolation with confidence bands.
   * artifact.data.history = [{ date, progress }] (progress: 0-100)
   * artifact.data.target = number (target progress, default 100)
   * params.confidenceLevel (default 0.95)
   */
  registerLensAction("goals", "progressForecast", (ctx, artifact, params) => {
  try {
    const history = artifact.data?.history || [];
    const target = artifact.data?.target ?? 100;
    const confidenceLevel = params.confidenceLevel || 0.95;

    if (history.length < 2) {
      return { ok: true, result: { message: "Need at least 2 historical data points for forecasting." } };
    }

    // Convert dates to numeric (days from first date)
    const sorted = [...history]
      .map(h => ({ date: h.date, progress: h.progress, time: new Date(h.date).getTime() }))
      .filter(h => !isNaN(h.time))
      .sort((a, b) => a.time - b.time);

    if (sorted.length < 2) {
      return { ok: true, result: { message: "Need at least 2 valid dated data points." } };
    }

    const t0 = sorted[0].time;
    const msPerDay = 86400000;
    const xs = sorted.map(h => (h.time - t0) / msPerDay);
    const ys = sorted.map(h => h.progress);
    const n = xs.length;

    // Linear regression: y = slope * x + intercept
    const sumX = xs.reduce((s, x) => s + x, 0);
    const sumY = ys.reduce((s, y) => s + y, 0);
    const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
    const sumX2 = xs.reduce((s, x) => s + x * x, 0);

    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;

    // R-squared
    const yMean = sumY / n;
    const ssRes = ys.reduce((s, y, i) => s + Math.pow(y - (slope * xs[i] + intercept), 2), 0);
    const ssTot = ys.reduce((s, y) => s + Math.pow(y - yMean, 2), 0);
    const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

    // Standard error
    const se = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    const xMean = sumX / n;
    const sxx = xs.reduce((s, x) => s + Math.pow(x - xMean, 2), 0);

    // t-value approximation for confidence interval
    // For simplicity, use z-values for common confidence levels
    const zValues = { 0.90: 1.645, 0.95: 1.96, 0.99: 2.576 };
    const z = zValues[confidenceLevel] || 1.96;

    // Forecast: when does progress reach target?
    let forecastDays = null;
    let forecastDate = null;
    if (slope > 0) {
      forecastDays = (target - intercept) / slope;
      if (forecastDays > 0) {
        forecastDate = new Date(t0 + forecastDays * msPerDay).toISOString().split("T")[0];
      }
    }

    // Current rate (progress per day)
    const currentProgress = ys[ys.length - 1];
    const daysElapsed = xs[xs.length - 1];

    // Generate forecast points with confidence bands
    const lastDay = xs[xs.length - 1];
    const forecastHorizon = forecastDays ? Math.min(forecastDays * 1.5, lastDay + 365) : lastDay + 90;
    const forecastPoints = [];
    const step = Math.max(1, Math.round((forecastHorizon - lastDay) / 20));

    for (let day = lastDay; day <= forecastHorizon; day += step) {
      const predicted = slope * day + intercept;
      // Prediction interval width
      const piWidth = z * se * Math.sqrt(1 + 1 / n + Math.pow(day - xMean, 2) / sxx);

      forecastPoints.push({
        day: Math.round(day),
        date: new Date(t0 + day * msPerDay).toISOString().split("T")[0],
        predicted: Math.round(predicted * 100) / 100,
        lower: Math.round((predicted - piWidth) * 100) / 100,
        upper: Math.round((predicted + piWidth) * 100) / 100,
      });

      if (predicted >= target) break;
    }

    // Velocity analysis
    const velocities = [];
    for (let i = 1; i < sorted.length; i++) {
      const dayDelta = (sorted[i].time - sorted[i - 1].time) / msPerDay;
      const progressDelta = sorted[i].progress - sorted[i - 1].progress;
      velocities.push({
        period: `${sorted[i - 1].date} to ${sorted[i].date}`,
        days: Math.round(dayDelta * 10) / 10,
        progressDelta: Math.round(progressDelta * 100) / 100,
        velocity: dayDelta > 0 ? Math.round((progressDelta / dayDelta) * 1000) / 1000 : 0,
      });
    }

    const avgVelocity = velocities.length > 0
      ? velocities.reduce((s, v) => s + v.velocity, 0) / velocities.length
      : 0;

    // Trend assessment
    let trendAssessment;
    if (slope > avgVelocity * 1.2) trendAssessment = "accelerating";
    else if (slope > 0) trendAssessment = "steady progress";
    else if (Math.abs(slope) < 0.01) trendAssessment = "stalled";
    else trendAssessment = "declining";

    // Days remaining estimate with confidence band
    let daysRemainingLower = null;
    let daysRemainingUpper = null;
    if (slope > 0) {
      const remaining = target - currentProgress;
      const slopeLower = slope - z * se / Math.sqrt(sxx);
      const slopeUpper = slope + z * se / Math.sqrt(sxx);
      if (slopeUpper > 0) daysRemainingLower = Math.round(remaining / slopeUpper);
      if (slopeLower > 0) daysRemainingUpper = Math.round(remaining / slopeLower);
    }

    const r = (v) => Math.round(v * 10000) / 10000;

    return {
      ok: true,
      result: {
        regression: {
          slope: r(slope),
          intercept: r(intercept),
          rSquared: r(rSquared),
          standardError: r(se),
          fit: rSquared > 0.9 ? "excellent" : rSquared > 0.7 ? "good" : rSquared > 0.5 ? "moderate" : "poor",
          equation: `progress = ${r(slope)} * days + ${r(intercept)}`,
        },
        currentState: {
          progress: currentProgress,
          target,
          remaining: Math.round((target - currentProgress) * 100) / 100,
          daysElapsed: Math.round(daysElapsed),
          percentComplete: Math.round((currentProgress / target) * 10000) / 100,
        },
        forecast: {
          estimatedCompletionDays: forecastDays ? Math.round(forecastDays) : null,
          estimatedCompletionDate: forecastDate,
          daysRemainingBest: daysRemainingLower,
          daysRemainingWorst: daysRemainingUpper,
          confidenceLevel,
          onTrack: forecastDays !== null && forecastDays <= daysElapsed * 3,
        },
        velocity: {
          current: r(slope),
          average: r(avgVelocity),
          trend: trendAssessment,
          history: velocities,
        },
        forecastCurve: forecastPoints,
        dataPoints: sorted.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ====================================================================
  // Feature-parity backlog — OKR alignment tree, cadence check-ins,
  // team/shared goals, templates + recurring, progress charts, reminders,
  // and goal dependencies. All persist per-user in globalThis._concordSTATE.
  // ====================================================================

  function getGoalsState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.goalsLens) {
      STATE.goalsLens = {
        objectives: new Map(), // userId -> Array<objective>  (alignment tree nodes)
        checkins: new Map(),   // userId -> Array<checkin>
        team: new Map(),       // userId -> Array<teamGoal>
        recurring: new Map(),  // userId -> Array<recurringGoal>
        reminders: new Map(),  // userId -> Array<reminder>
        deps: new Map(),       // userId -> Array<{ from, to, kind }>
        seq: new Map(),        // userId -> { obj, chk, team, rec, rem, dep }
      };
    }
    return STATE.goalsLens;
  }

  function actId(ctx) {
    return ctx?.actor?.userId || ctx?.userId || "anon";
  }

  function ensureList(map, userId) {
    if (!map.has(userId)) map.set(userId, []);
    return map.get(userId);
  }

  function nextSeq(s, userId, key) {
    if (!s.seq.has(userId)) s.seq.set(userId, { obj: 1, chk: 1, team: 1, rec: 1, rem: 1, dep: 1 });
    const seq = s.seq.get(userId);
    const n = seq[key]++;
    return n;
  }

  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch { /* non-fatal */ }
    }
  }

  // --- Built-in goal templates by category (structure only, no sample user data) ---
  const GOAL_TEMPLATES = [
    {
      id: "tpl_okr_quarter",
      category: "okr",
      name: "Quarterly OKR",
      description: "One objective with 3 measurable key results for a 90-day cycle.",
      cadence: "quarterly",
      keyResults: ["Key result 1 (metric)", "Key result 2 (metric)", "Key result 3 (metric)"],
    },
    {
      id: "tpl_health",
      category: "health",
      name: "Health & Fitness",
      description: "Build a recurring fitness habit with weekly milestones.",
      cadence: "weekly",
      keyResults: ["Sessions per week", "Target measurement", "Consistency streak"],
    },
    {
      id: "tpl_learning",
      category: "learning",
      name: "Skill Mastery",
      description: "Learn a new skill broken into staged milestones.",
      cadence: "monthly",
      keyResults: ["Fundamentals complete", "Practice hours logged", "Capstone delivered"],
    },
    {
      id: "tpl_career",
      category: "career",
      name: "Career Growth",
      description: "Advance a professional outcome over a half-year horizon.",
      cadence: "quarterly",
      keyResults: ["Skill checkpoint", "Visibility checkpoint", "Outcome checkpoint"],
    },
    {
      id: "tpl_project",
      category: "project",
      name: "Project Delivery",
      description: "Ship a project with clear scope, build and launch phases.",
      cadence: "once",
      keyResults: ["Scope locked", "Build complete", "Launched"],
    },
    {
      id: "tpl_finance",
      category: "finance",
      name: "Financial Goal",
      description: "Save or invest toward a target amount on a schedule.",
      cadence: "monthly",
      keyResults: ["Monthly contribution", "Milestone amount", "Target reached"],
    },
  ];

  /**
   * alignmentTree
   * Build an OKR alignment tree linking key results to parent objectives.
   * Maintains a per-user objective registry; each objective may declare a
   * parentId, forming a multi-level alignment hierarchy across teams.
   * params.op: 'list' | 'upsert' | 'remove'
   *   upsert -> { id?, title, parentId?, owner?, team?, level?, keyResults?:[] }
   *   remove -> { id }
   */
  registerLensAction("goals", "alignmentTree", (ctx, _artifact, params = {}) => {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.objectives, userId);
    const op = params.op || "list";

    if (op === "upsert") {
      if (!params.title || typeof params.title !== "string") {
        return { ok: false, error: "title required" };
      }
      let obj = params.id ? list.find((o) => o.id === params.id) : null;
      if (obj) {
        if (obj.id === params.parentId) return { ok: false, error: "objective cannot be its own parent" };
        obj.title = params.title;
        obj.parentId = params.parentId || null;
        obj.owner = params.owner ?? obj.owner ?? null;
        obj.team = params.team ?? obj.team ?? null;
        obj.level = params.level ?? obj.level ?? "company";
        obj.keyResults = Array.isArray(params.keyResults) ? params.keyResults : (obj.keyResults || []);
        obj.updatedAt = new Date().toISOString();
      } else {
        obj = {
          id: `obj_${nextSeq(s, userId, "obj")}`,
          title: params.title,
          parentId: params.parentId || null,
          owner: params.owner || null,
          team: params.team || null,
          level: params.level || "company",
          keyResults: Array.isArray(params.keyResults) ? params.keyResults : [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        list.push(obj);
      }
      save();
    } else if (op === "remove") {
      const idx = list.findIndex((o) => o.id === params.id);
      if (idx === -1) return { ok: false, error: "objective not found" };
      list.splice(idx, 1);
      // Orphan children -> promote to root
      for (const o of list) if (o.parentId === params.id) o.parentId = null;
      save();
    }

    // Build tree
    const byId = new Map(list.map((o) => [o.id, { ...o, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (node.parentId && byId.has(node.parentId)) {
        byId.get(node.parentId).children.push(node);
      } else {
        roots.push(node);
      }
    }
    const depth = (n) => (n.children.length === 0 ? 1 : 1 + Math.max(...n.children.map(depth)));
    const krTotal = list.reduce((acc, o) => acc + (o.keyResults?.length || 0), 0);

    return {
      ok: true,
      result: {
        tree: roots,
        flat: list,
        stats: {
          objectiveCount: list.length,
          rootCount: roots.length,
          maxDepth: roots.length ? Math.max(...roots.map(depth)) : 0,
          keyResultsLinked: krTotal,
          teams: [...new Set(list.map((o) => o.team).filter(Boolean))],
        },
      },
    };
  });

  /**
   * checkin
   * Cadence check-ins — weekly status updates with confidence ratings.
   * params.op: 'list' | 'add' | 'remove'
   *   add -> { goalId, status?('on_track'|'at_risk'|'off_track'), confidence(0-1),
   *            progress?(0-100), note?, period? }
   */
  registerLensAction("goals", "checkin", (ctx, _artifact, params = {}) => {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.checkins, userId);
    const op = params.op || "list";

    if (op === "add") {
      if (!params.goalId) return { ok: false, error: "goalId required" };
      const confidence = Math.max(0, Math.min(1, Number(params.confidence) || 0));
      const allowed = ["on_track", "at_risk", "off_track"];
      const status = allowed.includes(params.status) ? params.status
        : confidence >= 0.7 ? "on_track" : confidence >= 0.4 ? "at_risk" : "off_track";
      const entry = {
        id: `chk_${nextSeq(s, userId, "chk")}`,
        goalId: params.goalId,
        status,
        confidence,
        progress: params.progress != null ? Math.max(0, Math.min(100, Number(params.progress))) : null,
        note: typeof params.note === "string" ? params.note.slice(0, 1000) : "",
        period: params.period || new Date().toISOString().slice(0, 10),
        createdAt: new Date().toISOString(),
      };
      list.push(entry);
      save();
    } else if (op === "remove") {
      const idx = list.findIndex((c) => c.id === params.id);
      if (idx === -1) return { ok: false, error: "check-in not found" };
      list.splice(idx, 1);
      save();
    }

    let filtered = list;
    if (params.goalId && op === "list") filtered = list.filter((c) => c.goalId === params.goalId);
    const seqNum = (c) => Number(String(c.id).replace(/^chk_/, "")) || 0;
    const sorted = [...filtered].sort(
      (a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || seqNum(b) - seqNum(a),
    );
    const confValues = sorted.map((c) => c.confidence);
    const counts = { on_track: 0, at_risk: 0, off_track: 0 };
    for (const c of sorted) counts[c.status] = (counts[c.status] || 0) + 1;

    return {
      ok: true,
      result: {
        checkins: sorted,
        stats: {
          count: sorted.length,
          avgConfidence: confValues.length
            ? Math.round((confValues.reduce((a, b) => a + b, 0) / confValues.length) * 1000) / 1000
            : 0,
          latestStatus: sorted[0]?.status || null,
          statusCounts: counts,
        },
      },
    };
  });

  /**
   * teamGoal
   * Team / shared goals with per-member contribution tracking.
   * params.op: 'list' | 'create' | 'update' | 'contribute' | 'remove'
   *   create  -> { title, description?, members?:[name], target?(default 100) }
   *   update  -> { id, title?, description?, target? }
   *   contribute -> { id, member, amount(progress units), note? }
   *   remove  -> { id }
   */
  registerLensAction("goals", "teamGoal", (ctx, _artifact, params = {}) => {
  try {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.team, userId);
    const op = params.op || "list";

    const recompute = (g) => {
      g.totalContributed = Math.round(g.contributions.reduce((a, c) => a + c.amount, 0) * 100) / 100;
      g.progress = g.target > 0 ? Math.min(100, Math.round((g.totalContributed / g.target) * 10000) / 100) : 0;
      const byMember = {};
      for (const c of g.contributions) byMember[c.member] = (byMember[c.member] || 0) + c.amount;
      g.byMember = Object.entries(byMember).map(([member, amount]) => ({
        member,
        amount: Math.round(amount * 100) / 100,
        sharePct: g.totalContributed > 0 ? Math.round((amount / g.totalContributed) * 10000) / 100 : 0,
      })).sort((a, b) => b.amount - a.amount);
    };

    if (op === "create") {
      if (!params.title) return { ok: false, error: "title required" };
      const g = {
        id: `team_${nextSeq(s, userId, "team")}`,
        title: params.title,
        description: params.description || "",
        members: Array.isArray(params.members) ? [...new Set(params.members.filter(Boolean))] : [],
        target: Number(params.target) > 0 ? Number(params.target) : 100,
        contributions: [],
        createdAt: new Date().toISOString(),
      };
      recompute(g);
      list.push(g);
      save();
      return { ok: true, result: { teamGoal: g, teamGoals: list } };
    }

    const g = params.id ? list.find((x) => x.id === params.id) : null;
    if (["update", "contribute", "remove"].includes(op) && !g) {
      return { ok: false, error: "team goal not found" };
    }

    if (op === "update") {
      if (params.title) g.title = params.title;
      if (params.description != null) g.description = params.description;
      if (Number(params.target) > 0) g.target = Number(params.target);
      recompute(g);
      save();
    } else if (op === "contribute") {
      if (!params.member) return { ok: false, error: "member required" };
      const amount = Number(params.amount);
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount must be positive" };
      if (!g.members.includes(params.member)) g.members.push(params.member);
      g.contributions.push({
        id: `contrib_${g.contributions.length + 1}`,
        member: params.member,
        amount,
        note: typeof params.note === "string" ? params.note.slice(0, 500) : "",
        at: new Date().toISOString(),
      });
      recompute(g);
      save();
    } else if (op === "remove") {
      list.splice(list.indexOf(g), 1);
      save();
    }

    return { ok: true, result: { teamGoal: g || null, teamGoals: list } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * templates
   * Goal templates by category + recurring goal management.
   * params.op: 'list' | 'recurring-list' | 'recurring-create' | 'recurring-remove' | 'recurring-run-due'
   *   recurring-create -> { title, cadence('daily'|'weekly'|'monthly'|'quarterly'),
   *                         category?, startAt?, templateId? }
   *   recurring-remove -> { id }
   *   recurring-run-due -> instantiates concrete goal occurrences whose nextDue <= now
   */
  registerLensAction("goals", "templates", (ctx, _artifact, params = {}) => {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const op = params.op || "list";

    if (op === "list") {
      return { ok: true, result: { templates: GOAL_TEMPLATES } };
    }

    const list = ensureList(s.recurring, userId);
    const cadenceDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 91 };

    if (op === "recurring-create") {
      if (!params.title) return { ok: false, error: "title required" };
      const cadence = cadenceDays[params.cadence] ? params.cadence : "weekly";
      const start = params.startAt ? new Date(params.startAt) : new Date();
      if (isNaN(start.getTime())) return { ok: false, error: "invalid startAt" };
      const rec = {
        id: `rec_${nextSeq(s, userId, "rec")}`,
        title: params.title,
        cadence,
        category: params.category || null,
        templateId: params.templateId || null,
        startAt: start.toISOString(),
        nextDue: start.toISOString(),
        occurrences: 0,
        createdAt: new Date().toISOString(),
      };
      list.push(rec);
      save();
      return { ok: true, result: { recurring: rec, recurringGoals: list } };
    }

    if (op === "recurring-remove") {
      const idx = list.findIndex((r) => r.id === params.id);
      if (idx === -1) return { ok: false, error: "recurring goal not found" };
      list.splice(idx, 1);
      save();
      return { ok: true, result: { recurringGoals: list } };
    }

    if (op === "recurring-run-due") {
      const now = Date.now();
      const created = [];
      for (const rec of list) {
        let guard = 0;
        while (new Date(rec.nextDue).getTime() <= now && guard < 500) {
          created.push({
            recurringId: rec.id,
            title: rec.title,
            category: rec.category,
            occurrence: rec.occurrences + 1,
            dueAt: rec.nextDue,
          });
          rec.occurrences += 1;
          rec.nextDue = new Date(
            new Date(rec.nextDue).getTime() + cadenceDays[rec.cadence] * 86400000,
          ).toISOString();
          guard++;
        }
      }
      save();
      return { ok: true, result: { created, recurringGoals: list } };
    }

    // recurring-list (default for non-list ops fall here too)
    return { ok: true, result: { recurringGoals: list } };
  });

  /**
   * progressChart
   * Progress charts — burndown and trend series from a goal's history.
   * artifact/params.history = [{ date, progress (0-100) }]
   * params.target (default 100), params.targetDate (optional ISO)
   * Returns burndown (remaining work), trend (cumulative progress) and an
   * ideal line for comparison — ready to feed ChartKit.
   */
  registerLensAction("goals", "progressChart", (ctx, artifact, params = {}) => {
  try {
    const history = (Array.isArray(params.history) && params.history.length
      ? params.history
      : artifact?.data?.history) || [];
    const target = Number(params.target) > 0 ? Number(params.target) : 100;

    const sorted = history
      .map((h) => ({ date: h.date, progress: Number(h.progress) || 0, t: new Date(h.date).getTime() }))
      .filter((h) => !isNaN(h.t))
      .sort((a, b) => a.t - b.t);

    if (sorted.length === 0) {
      return { ok: true, result: { trend: [], burndown: [], stats: { points: 0 }, empty: true } };
    }

    const first = sorted[0].t;
    const targetDate = params.targetDate ? new Date(params.targetDate).getTime() : sorted[sorted.length - 1].t;
    const span = Math.max(1, targetDate - first);

    const trend = sorted.map((h) => {
      const frac = Math.min(1, Math.max(0, (h.t - first) / span));
      return {
        date: h.date,
        progress: Math.round(h.progress * 100) / 100,
        ideal: Math.round(frac * target * 100) / 100,
      };
    });

    const burndown = sorted.map((h) => {
      const frac = Math.min(1, Math.max(0, (h.t - first) / span));
      return {
        date: h.date,
        remaining: Math.round((target - h.progress) * 100) / 100,
        idealRemaining: Math.round((target - frac * target) * 100) / 100,
      };
    });

    const last = sorted[sorted.length - 1];
    const days = Math.max(1, (last.t - first) / 86400000);
    const velocity = Math.round(((last.progress - sorted[0].progress) / days) * 1000) / 1000;
    const idealFrac = Math.min(1, Math.max(0, (last.t - first) / span));
    const expected = idealFrac * target;
    const variance = Math.round((last.progress - expected) * 100) / 100;

    return {
      ok: true,
      result: {
        trend,
        burndown,
        stats: {
          points: sorted.length,
          currentProgress: last.progress,
          target,
          remaining: Math.round((target - last.progress) * 100) / 100,
          velocityPerDay: velocity,
          varianceFromIdeal: variance,
          pace: variance >= 0 ? "ahead" : variance > -10 ? "on_track" : "behind",
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * reminder
   * Reminders + scheduled review prompts for goals.
   * params.op: 'list' | 'create' | 'remove' | 'complete' | 'due'
   *   create -> { goalId?, label, dueAt(ISO), cadence?('once'|'daily'|'weekly'|'monthly'),
   *               kind?('review'|'checkin'|'deadline') }
   *   complete -> { id }  (reschedules if recurring, else marks done)
   *   due -> returns reminders whose dueAt <= now and not done
   */
  registerLensAction("goals", "reminder", (ctx, _artifact, params = {}) => {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.reminders, userId);
    const op = params.op || "list";
    const cadenceDays = { daily: 1, weekly: 7, monthly: 30 };

    if (op === "create") {
      if (!params.label) return { ok: false, error: "label required" };
      const due = params.dueAt ? new Date(params.dueAt) : new Date();
      if (isNaN(due.getTime())) return { ok: false, error: "invalid dueAt" };
      const kinds = ["review", "checkin", "deadline"];
      const cadences = ["once", "daily", "weekly", "monthly"];
      const rem = {
        id: `rem_${nextSeq(s, userId, "rem")}`,
        goalId: params.goalId || null,
        label: String(params.label).slice(0, 300),
        kind: kinds.includes(params.kind) ? params.kind : "review",
        cadence: cadences.includes(params.cadence) ? params.cadence : "once",
        dueAt: due.toISOString(),
        done: false,
        firedCount: 0,
        createdAt: new Date().toISOString(),
      };
      list.push(rem);
      save();
      return { ok: true, result: { reminder: rem, reminders: list } };
    }

    if (["remove", "complete"].includes(op)) {
      const rem = list.find((r) => r.id === params.id);
      if (!rem) return { ok: false, error: "reminder not found" };
      if (op === "remove") {
        list.splice(list.indexOf(rem), 1);
      } else {
        rem.firedCount += 1;
        if (rem.cadence !== "once" && cadenceDays[rem.cadence]) {
          rem.dueAt = new Date(new Date(rem.dueAt).getTime() + cadenceDays[rem.cadence] * 86400000).toISOString();
          rem.done = false;
        } else {
          rem.done = true;
        }
      }
      save();
      return { ok: true, result: { reminders: list } };
    }

    if (op === "due") {
      const now = Date.now();
      const due = list.filter((r) => !r.done && new Date(r.dueAt).getTime() <= now)
        .sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
      return { ok: true, result: { due, count: due.length } };
    }

    // list
    const sorted = [...list].sort((a, b) => (a.dueAt || "").localeCompare(b.dueAt || ""));
    return {
      ok: true,
      result: {
        reminders: sorted,
        stats: {
          total: sorted.length,
          pending: sorted.filter((r) => !r.done).length,
          overdue: sorted.filter((r) => !r.done && new Date(r.dueAt).getTime() <= Date.now()).length,
        },
      },
    };
  });

  /**
   * dependencies
   * Goal dependencies — model "this goal blocks that one".
   * params.op: 'list' | 'link' | 'unlink'
   *   link   -> { from(blocker goalId), to(blocked goalId), kind?('blocks'|'relates') }
   *   unlink -> { from, to }
   * Detects cycles and computes a blocked/ready partition.
   */
  registerLensAction("goals", "dependencies", (ctx, _artifact, params = {}) => {
  try {
    const s = getGoalsState();
    if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = actId(ctx);
    const list = ensureList(s.deps, userId);
    const op = params.op || "list";

    if (op === "link") {
      const { from, to } = params;
      if (!from || !to) return { ok: false, error: "from and to required" };
      if (from === to) return { ok: false, error: "a goal cannot depend on itself" };
      const kind = params.kind === "relates" ? "relates" : "blocks";
      // Cycle check (only for blocking edges)
      if (kind === "blocks") {
        const adj = new Map();
        for (const e of list.filter((x) => x.kind === "blocks")) {
          if (!adj.has(e.from)) adj.set(e.from, []);
          adj.get(e.from).push(e.to);
        }
        if (!adj.has(from)) adj.set(from, []);
        adj.get(from).push(to);
        // Detect cycle reachable from `to` back to `from`
        const seen = new Set();
        const stack = [to];
        while (stack.length) {
          const node = stack.pop();
          if (node === from) return { ok: false, error: "dependency would create a cycle" };
          if (seen.has(node)) continue;
          seen.add(node);
          for (const nxt of (adj.get(node) || [])) stack.push(nxt);
        }
      }
      const existing = list.find((e) => e.from === from && e.to === to);
      if (existing) {
        existing.kind = kind;
      } else {
        list.push({ id: `dep_${nextSeq(s, userId, "dep")}`, from, to, kind, createdAt: new Date().toISOString() });
      }
      save();
    } else if (op === "unlink") {
      const idx = list.findIndex((e) => e.from === params.from && e.to === params.to);
      if (idx === -1) return { ok: false, error: "dependency not found" };
      list.splice(idx, 1);
      save();
    }

    // Partition: a goal is "blocked" if it is the `to` of any blocking edge.
    const blockingEdges = list.filter((e) => e.kind === "blocks");
    const blockedSet = new Set(blockingEdges.map((e) => e.to));
    const allNodes = new Set();
    for (const e of list) { allNodes.add(e.from); allNodes.add(e.to); }
    const blockers = {};
    for (const e of blockingEdges) {
      if (!blockers[e.to]) blockers[e.to] = [];
      blockers[e.to].push(e.from);
    }

    return {
      ok: true,
      result: {
        edges: list,
        blockedGoals: [...blockedSet],
        readyGoals: [...allNodes].filter((n) => !blockedSet.has(n)),
        blockersByGoal: blockers,
        stats: {
          edgeCount: list.length,
          blockingCount: blockingEdges.length,
          nodeCount: allNodes.size,
        },
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
