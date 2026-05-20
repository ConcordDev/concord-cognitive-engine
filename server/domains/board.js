// server/domains/board.js
// Domain actions for board/kanban management: workflow analysis, card prioritization, burndown forecasting.

export default function registerBoardActions(registerLensAction) {
  /**
   * workflowAnalysis
   * Analyze kanban board flow — compute cycle time, lead time, throughput,
   * WIP limits, identify bottlenecks using Little's Law.
   * artifact.data.cards: [{ id, title, column, createdAt, startedAt?, completedAt?, transitions?: [{ column, enteredAt, exitedAt? }] }]
   * artifact.data.columns: [{ name, wipLimit? }] — ordered column definitions
   */
  registerLensAction("board", "workflowAnalysis", (ctx, artifact, params) => {
    const cards = artifact.data.cards || [];
    const columns = artifact.data.columns || [];

    if (cards.length === 0) {
      return { ok: true, result: { message: "No cards provided for workflow analysis." } };
    }

    const now = new Date();

    // Compute cycle time (started -> completed) and lead time (created -> completed)
    const completedCards = cards.filter(c => c.completedAt);
    const cycleTimes = [];
    const leadTimes = [];

    for (const card of completedCards) {
      const created = new Date(card.createdAt).getTime();
      const started = card.startedAt ? new Date(card.startedAt).getTime() : created;
      const completed = new Date(card.completedAt).getTime();

      if (!isNaN(created) && !isNaN(completed)) {
        const leadTimeDays = (completed - created) / 86400000;
        leadTimes.push({ id: card.id, days: Math.round(leadTimeDays * 100) / 100 });
      }
      if (!isNaN(started) && !isNaN(completed)) {
        const cycleTimeDays = (completed - started) / 86400000;
        cycleTimes.push({ id: card.id, days: Math.round(cycleTimeDays * 100) / 100 });
      }
    }

    const avg = arr => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const median = arr => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };
    const percentile = (arr, p) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.ceil(p / 100 * sorted.length) - 1;
      return sorted[Math.max(0, idx)];
    };

    const cycleTimeDays = cycleTimes.map(c => c.days);
    const leadTimeDays = leadTimes.map(l => l.days);

    const cycleTimeStats = {
      mean: Math.round(avg(cycleTimeDays) * 100) / 100,
      median: Math.round(median(cycleTimeDays) * 100) / 100,
      p85: Math.round(percentile(cycleTimeDays, 85) * 100) / 100,
      p95: Math.round(percentile(cycleTimeDays, 95) * 100) / 100,
      min: cycleTimeDays.length > 0 ? Math.min(...cycleTimeDays) : 0,
      max: cycleTimeDays.length > 0 ? Math.max(...cycleTimeDays) : 0,
    };

    const leadTimeStats = {
      mean: Math.round(avg(leadTimeDays) * 100) / 100,
      median: Math.round(median(leadTimeDays) * 100) / 100,
      p85: Math.round(percentile(leadTimeDays, 85) * 100) / 100,
      p95: Math.round(percentile(leadTimeDays, 95) * 100) / 100,
    };

    // WIP (Work In Progress) per column
    const columnWip = {};
    for (const col of columns) {
      columnWip[col.name] = {
        currentWip: 0,
        wipLimit: col.wipLimit || null,
        isOverLimit: false,
      };
    }
    for (const card of cards) {
      if (!card.completedAt && columnWip[card.column]) {
        columnWip[card.column].currentWip++;
      }
    }
    for (const col of columns) {
      if (columnWip[col.name] && col.wipLimit) {
        columnWip[col.name].isOverLimit = columnWip[col.name].currentWip > col.wipLimit;
      }
    }

    // Throughput: completed cards per week (last 4 weeks)
    const fourWeeksAgo = new Date(now - 28 * 86400000);
    const recentCompleted = completedCards.filter(c => new Date(c.completedAt) >= fourWeeksAgo);
    const weeklyThroughput = Math.round((recentCompleted.length / 4) * 100) / 100;

    // Little's Law: Avg WIP = Throughput * Avg Cycle Time
    // We can use this to validate or predict
    const totalWip = Object.values(columnWip).reduce((s, c) => s + c.currentWip, 0);
    const littlesLawPredictedCycleTime = weeklyThroughput > 0
      ? Math.round((totalWip / weeklyThroughput) * 100) / 100
      : null;

    // Bottleneck detection: column with highest avg time spent
    const columnTimeSpent = {};
    for (const card of cards) {
      if (!card.transitions) continue;
      for (const transition of card.transitions) {
        const entered = new Date(transition.enteredAt).getTime();
        const exited = transition.exitedAt ? new Date(transition.exitedAt).getTime() : now.getTime();
        if (!isNaN(entered) && !isNaN(exited)) {
          const days = (exited - entered) / 86400000;
          if (!columnTimeSpent[transition.column]) columnTimeSpent[transition.column] = [];
          columnTimeSpent[transition.column].push(days);
        }
      }
    }

    const bottleneckAnalysis = Object.entries(columnTimeSpent)
      .map(([column, times]) => ({
        column,
        avgDays: Math.round(avg(times) * 100) / 100,
        medianDays: Math.round(median(times) * 100) / 100,
        cardCount: times.length,
        totalDays: Math.round(times.reduce((s, t) => s + t, 0) * 100) / 100,
      }))
      .sort((a, b) => b.avgDays - a.avgDays);

    const bottleneck = bottleneckAnalysis.length > 0 ? bottleneckAnalysis[0].column : null;

    // Flow efficiency: active time / total lead time
    let flowEfficiency = null;
    if (Object.keys(columnTimeSpent).length > 0 && leadTimeStats.mean > 0) {
      // Assume first and last columns are wait states
      const waitColumns = new Set();
      if (columns.length >= 2) {
        waitColumns.add(columns[0].name);
        waitColumns.add(columns[columns.length - 1].name);
      }
      const activeTime = Object.entries(columnTimeSpent)
        .filter(([col]) => !waitColumns.has(col))
        .reduce((s, [, times]) => s + avg(times), 0);
      flowEfficiency = leadTimeStats.mean > 0
        ? Math.round((activeTime / leadTimeStats.mean) * 10000) / 100
        : null;
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      totalCards: cards.length,
      completedCards: completedCards.length,
      inProgressCards: totalWip,
      cycleTime: cycleTimeStats,
      leadTime: leadTimeStats,
      throughput: {
        weeklyAvg: weeklyThroughput,
        recentCompletedCount: recentCompleted.length,
        periodWeeks: 4,
      },
      wip: {
        total: totalWip,
        byColumn: columnWip,
        overLimitColumns: Object.entries(columnWip)
          .filter(([, v]) => v.isOverLimit)
          .map(([name, v]) => ({ column: name, wip: v.currentWip, limit: v.wipLimit })),
      },
      littlesLaw: {
        currentWip: totalWip,
        throughputPerWeek: weeklyThroughput,
        predictedCycleTimeWeeks: littlesLawPredictedCycleTime,
      },
      bottleneck,
      bottleneckAnalysis,
      flowEfficiency,
    };

    artifact.data.workflowAnalysis = result;
    return { ok: true, result };
  });

  /**
   * cardPrioritization
   * WSJF (Weighted Shortest Job First) scoring — cost of delay / job duration,
   * with urgency and risk adjustment.
   * artifact.data.cards: [{ id, title, businessValue: 1-10, timeCriticality: 1-10, riskReduction: 1-10, effort: 1-10, deadline? }]
   */
  registerLensAction("board", "cardPrioritization", (ctx, artifact, params) => {
    const cards = artifact.data.cards || [];
    if (cards.length === 0) {
      return { ok: true, result: { message: "No cards provided for prioritization." } };
    }

    const now = new Date();

    const scored = cards.map(card => {
      const businessValue = Math.max(1, Math.min(10, parseFloat(card.businessValue) || 5));
      let timeCriticality = Math.max(1, Math.min(10, parseFloat(card.timeCriticality) || 5));
      const riskReduction = Math.max(1, Math.min(10, parseFloat(card.riskReduction) || 5));
      const effort = Math.max(1, Math.min(10, parseFloat(card.effort) || 5));

      // Adjust time criticality based on deadline proximity
      if (card.deadline) {
        const deadlineDate = new Date(card.deadline);
        const daysUntilDeadline = (deadlineDate - now) / 86400000;
        if (daysUntilDeadline < 0) {
          timeCriticality = 10; // Overdue
        } else if (daysUntilDeadline < 7) {
          timeCriticality = Math.max(timeCriticality, 9);
        } else if (daysUntilDeadline < 14) {
          timeCriticality = Math.max(timeCriticality, 7);
        } else if (daysUntilDeadline < 30) {
          timeCriticality = Math.max(timeCriticality, 5);
        }
      }

      // Cost of Delay = Business Value + Time Criticality + Risk Reduction/Opportunity Enablement
      const costOfDelay = businessValue + timeCriticality + riskReduction;

      // WSJF = Cost of Delay / Job Duration (effort)
      const wsjf = Math.round((costOfDelay / effort) * 1000) / 1000;

      // Normalized WSJF score (0-100)
      // Max possible: (10+10+10)/1 = 30, Min possible: (1+1+1)/10 = 0.3
      const normalizedScore = Math.round((wsjf / 30) * 10000) / 100;

      return {
        id: card.id,
        title: card.title,
        businessValue,
        timeCriticality,
        riskReduction,
        effort,
        costOfDelay,
        wsjfScore: wsjf,
        normalizedScore: Math.min(100, normalizedScore),
        deadline: card.deadline || null,
        daysUntilDeadline: card.deadline
          ? Math.round((new Date(card.deadline) - now) / 86400000)
          : null,
      };
    });

    // Sort by WSJF score descending
    scored.sort((a, b) => b.wsjfScore - a.wsjfScore);

    // Assign priority rank
    scored.forEach((card, idx) => {
      card.rank = idx + 1;
    });

    // Priority tiers
    const tierSize = Math.max(1, Math.ceil(scored.length / 4));
    const tiers = {
      critical: scored.slice(0, tierSize).map(c => c.id),
      high: scored.slice(tierSize, tierSize * 2).map(c => c.id),
      medium: scored.slice(tierSize * 2, tierSize * 3).map(c => c.id),
      low: scored.slice(tierSize * 3).map(c => c.id),
    };

    // Value-effort quadrant analysis
    const avgValue = scored.reduce((s, c) => s + c.costOfDelay, 0) / scored.length;
    const avgEffort = scored.reduce((s, c) => s + c.effort, 0) / scored.length;

    const quadrantAssignment = scored.map(card => {
      let quadrant;
      if (card.costOfDelay >= avgValue && card.effort <= avgEffort) quadrant = "quick-wins";
      else if (card.costOfDelay >= avgValue && card.effort > avgEffort) quadrant = "major-projects";
      else if (card.costOfDelay < avgValue && card.effort <= avgEffort) quadrant = "fill-ins";
      else quadrant = "thankless-tasks";

      return { id: card.id, title: card.title, quadrant };
    });

    const result = {
      analyzedAt: new Date().toISOString(),
      totalCards: cards.length,
      rankedCards: scored,
      tiers,
      quadrants: {
        "quick-wins": quadrantAssignment.filter(q => q.quadrant === "quick-wins"),
        "major-projects": quadrantAssignment.filter(q => q.quadrant === "major-projects"),
        "fill-ins": quadrantAssignment.filter(q => q.quadrant === "fill-ins"),
        "thankless-tasks": quadrantAssignment.filter(q => q.quadrant === "thankless-tasks"),
      },
      thresholds: {
        avgCostOfDelay: Math.round(avgValue * 100) / 100,
        avgEffort: Math.round(avgEffort * 100) / 100,
      },
    };

    artifact.data.cardPrioritization = result;
    return { ok: true, result };
  });

  /**
   * burndownForecast
   * Monte Carlo simulation for project completion — sample historical velocity,
   * compute completion date probability distribution.
   * artifact.data.sprints: [{ id, plannedPoints, completedPoints, startDate, endDate }]
   * artifact.data.remainingPoints — total story points remaining
   * params.simulations — number of Monte Carlo runs (default 1000)
   * params.sprintLengthDays — sprint duration in days (default 14)
   */
  registerLensAction("board", "burndownForecast", (ctx, artifact, params) => {
    const sprints = artifact.data.sprints || [];
    const remainingPoints = parseFloat(artifact.data.remainingPoints) || 0;
    const simulations = params.simulations || 1000;
    const sprintLengthDays = params.sprintLengthDays || 14;

    if (sprints.length === 0) {
      return { ok: true, result: { message: "No sprint history provided for forecasting." } };
    }
    if (remainingPoints <= 0) {
      return { ok: true, result: { message: "No remaining points to forecast.", completionDate: new Date().toISOString() } };
    }

    // Extract historical velocities
    const velocities = sprints.map(s => parseFloat(s.completedPoints) || 0).filter(v => v > 0);
    if (velocities.length === 0) {
      return { ok: true, result: { message: "No positive velocity data in sprint history." } };
    }

    const avgVelocity = velocities.reduce((s, v) => s + v, 0) / velocities.length;
    const velocityStdDev = Math.sqrt(
      velocities.reduce((s, v) => s + Math.pow(v - avgVelocity, 2), 0) / velocities.length
    );
    const minVelocity = Math.min(...velocities);
    const maxVelocity = Math.max(...velocities);

    // Monte Carlo simulation: for each run, sample velocities from history
    // until remaining points are consumed
    const now = new Date();
    const completionSprints = [];

    // Seeded pseudo-random using simple LCG (for reproducibility within session)
    let seed = 42;
    function random() {
      seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
      return seed / 0x7fffffff;
    }

    for (let sim = 0; sim < simulations; sim++) {
      let remaining = remainingPoints;
      let sprintCount = 0;
      const maxSprints = 100; // Safety cap

      while (remaining > 0 && sprintCount < maxSprints) {
        // Sample a random velocity from historical data
        const idx = Math.floor(random() * velocities.length);
        const sampledVelocity = velocities[idx];

        // Add some noise: +/- 20% variance
        const noise = 1 + (random() - 0.5) * 0.4;
        const adjustedVelocity = Math.max(1, sampledVelocity * noise);

        remaining -= adjustedVelocity;
        sprintCount++;
      }

      completionSprints.push(sprintCount);
    }

    // Analyze simulation results
    completionSprints.sort((a, b) => a - b);

    const sprintPercentiles = {};
    for (const p of [10, 25, 50, 75, 85, 90, 95]) {
      const idx = Math.min(Math.ceil(simulations * p / 100) - 1, simulations - 1);
      sprintPercentiles[`p${p}`] = completionSprints[idx];
    }

    // Convert sprint counts to dates
    const datePercentiles = {};
    for (const [key, sprintCount] of Object.entries(sprintPercentiles)) {
      const completionDate = new Date(now.getTime() + sprintCount * sprintLengthDays * 86400000);
      datePercentiles[key] = completionDate.toISOString().split("T")[0];
    }

    // Deterministic forecast (using average velocity)
    const deterministicSprints = Math.ceil(remainingPoints / avgVelocity);
    const deterministicDate = new Date(now.getTime() + deterministicSprints * sprintLengthDays * 86400000);

    // Build histogram of completion sprints
    const histogram = {};
    for (const sc of completionSprints) {
      histogram[sc] = (histogram[sc] || 0) + 1;
    }
    const histogramEntries = Object.entries(histogram)
      .map(([sprints, count]) => ({
        sprints: parseInt(sprints),
        count,
        probability: Math.round((count / simulations) * 10000) / 100,
        cumulativeProbability: 0,
      }))
      .sort((a, b) => a.sprints - b.sprints);

    let cumulative = 0;
    for (const entry of histogramEntries) {
      cumulative += entry.count;
      entry.cumulativeProbability = Math.round((cumulative / simulations) * 10000) / 100;
    }

    // Sprint-by-sprint burndown projection
    const burndownProjection = [];
    let projectedRemaining = remainingPoints;
    for (let i = 0; i < deterministicSprints + 5 && projectedRemaining > 0; i++) {
      burndownProjection.push({
        sprint: i + 1,
        date: new Date(now.getTime() + (i + 1) * sprintLengthDays * 86400000).toISOString().split("T")[0],
        projectedRemaining: Math.round(Math.max(0, projectedRemaining) * 100) / 100,
        optimistic: Math.round(Math.max(0, remainingPoints - maxVelocity * (i + 1)) * 100) / 100,
        pessimistic: Math.round(Math.max(0, remainingPoints - minVelocity * (i + 1)) * 100) / 100,
      });
      projectedRemaining -= avgVelocity;
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      remainingPoints,
      sprintCount: sprints.length,
      sprintLengthDays,
      velocityStats: {
        mean: Math.round(avgVelocity * 100) / 100,
        stdDev: Math.round(velocityStdDev * 100) / 100,
        min: minVelocity,
        max: maxVelocity,
        coefficientOfVariation: avgVelocity > 0
          ? Math.round((velocityStdDev / avgVelocity) * 10000) / 100
          : 0,
      },
      simulations,
      forecast: {
        deterministicSprints,
        deterministicDate: deterministicDate.toISOString().split("T")[0],
        sprintPercentiles,
        datePercentiles,
        mostLikelySprints: sprintPercentiles.p50,
        mostLikelyDate: datePercentiles.p50,
        confidenceRange: {
          optimistic: datePercentiles.p25,
          likely: datePercentiles.p50,
          conservative: datePercentiles.p85,
          worstCase: datePercentiles.p95,
        },
      },
      histogram: histogramEntries,
      burndownProjection,
    };

    artifact.data.burndownForecast = result;
    return { ok: true, result };
  });

  // ─── Trello / Asana-shape kanban substrate (per-user, STATE) ─────────

  function getBoardState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.boardLens) STATE.boardLens = {};
    if (!(STATE.boardLens.boards instanceof Map)) STATE.boardLens.boards = new Map(); // userId -> Array
    return STATE.boardLens;
  }
  function saveBoard() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const bdId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const bdNow = () => new Date().toISOString();
  const bdActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const bdClean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const bdList = (s, userId) => { if (!s.boards.has(userId)) s.boards.set(userId, []); return s.boards.get(userId); };

  registerLensAction("board", "board-create", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = bdClean(params.name, 120);
    if (!name) return { ok: false, error: "board name required" };
    const board = {
      id: bdId("bd"),
      name,
      columns: [
        { id: bdId("col"), name: "To Do" },
        { id: bdId("col"), name: "In Progress" },
        { id: bdId("col"), name: "Done" },
      ],
      cards: [],
      createdAt: bdNow(),
    };
    bdList(s, bdActor(ctx)).push(board);
    saveBoard();
    return { ok: true, result: { board } };
  });

  registerLensAction("board", "board-list", (ctx, _a, _params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = bdList(s, bdActor(ctx)).map((b) => ({
      id: b.id, name: b.name, columnCount: b.columns.length, cardCount: b.cards.length, createdAt: b.createdAt,
    }));
    return { ok: true, result: { boards, count: boards.length } };
  });

  registerLensAction("board", "board-detail", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = bdList(s, bdActor(ctx)).find((b) => b.id === params.id);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { board } };
  });

  registerLensAction("board", "board-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = bdList(s, bdActor(ctx));
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "board not found" };
    arr.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.id } };
  });

  function findBoard(s, ctx, boardId) {
    return bdList(s, bdActor(ctx)).find((b) => b.id === boardId);
  }

  registerLensAction("board", "column-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const name = bdClean(params.name, 80);
    if (!name) return { ok: false, error: "column name required" };
    const column = { id: bdId("col"), name };
    board.columns.push(column);
    saveBoard();
    return { ok: true, result: { column } };
  });

  registerLensAction("board", "column-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const i = board.columns.findIndex((c) => c.id === params.columnId);
    if (i < 0) return { ok: false, error: "column not found" };
    board.columns.splice(i, 1);
    board.cards = board.cards.filter((c) => c.columnId !== params.columnId);
    saveBoard();
    return { ok: true, result: { deleted: params.columnId } };
  });

  registerLensAction("board", "card-create", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const column = board.columns.find((c) => c.id === params.columnId) || board.columns[0];
    if (!column) return { ok: false, error: "board has no columns" };
    const title = bdClean(params.title, 240);
    if (!title) return { ok: false, error: "card title required" };
    const card = {
      id: bdId("crd"),
      columnId: column.id,
      title,
      description: bdClean(params.description, 4000),
      labels: Array.isArray(params.labels) ? params.labels.map((l) => bdClean(l, 30)).filter(Boolean).slice(0, 6) : [],
      dueDate: bdClean(params.dueDate, 30) || null,
      assignee: bdClean(params.assignee, 80) || null,
      checklist: [],
      position: board.cards.filter((c) => c.columnId === column.id).length,
      createdAt: bdNow(),
    };
    board.cards.push(card);
    saveBoard();
    return { ok: true, result: { card } };
  });

  registerLensAction("board", "card-move", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = board.cards.find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const target = board.columns.find((c) => c.id === params.toColumnId);
    if (!target) return { ok: false, error: "target column not found" };
    card.columnId = target.id;
    if (params.position != null) card.position = Math.max(0, Math.round(Number(params.position)));
    else card.position = board.cards.filter((c) => c.columnId === target.id && c.id !== card.id).length;
    // renumber the target column's cards
    board.cards.filter((c) => c.columnId === target.id).sort((a, b) => a.position - b.position)
      .forEach((c, i) => { c.position = i; });
    saveBoard();
    return { ok: true, result: { cardId: card.id, columnId: card.columnId } };
  });

  registerLensAction("board", "card-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = board.cards.find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (params.title != null) card.title = bdClean(params.title, 240) || card.title;
    if (params.description != null) card.description = bdClean(params.description, 4000);
    if (Array.isArray(params.labels)) card.labels = params.labels.map((l) => bdClean(l, 30)).filter(Boolean).slice(0, 6);
    if (params.dueDate !== undefined) card.dueDate = bdClean(params.dueDate, 30) || null;
    if (params.assignee !== undefined) card.assignee = bdClean(params.assignee, 80) || null;
    if (params.addChecklistItem) {
      card.checklist.push({ id: bdId("ci"), text: bdClean(params.addChecklistItem, 200), done: false });
    }
    saveBoard();
    return { ok: true, result: { card } };
  });

  registerLensAction("board", "card-checklist-toggle", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = board.cards.find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const item = card.checklist.find((i) => i.id === params.itemId);
    if (!item) return { ok: false, error: "checklist item not found" };
    item.done = !item.done;
    saveBoard();
    return { ok: true, result: { itemId: item.id, done: item.done } };
  });

  registerLensAction("board", "card-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const i = board.cards.findIndex((c) => c.id === params.cardId);
    if (i < 0) return { ok: false, error: "card not found" };
    board.cards.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.cardId } };
  });

  registerLensAction("board", "board-dashboard", (ctx, _a, _params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = bdList(s, bdActor(ctx));
    const allCards = boards.flatMap((b) => b.cards);
    const now = Date.now();
    return {
      ok: true,
      result: {
        boards: boards.length,
        totalCards: allCards.length,
        overdue: allCards.filter((c) => c.dueDate && new Date(c.dueDate).getTime() < now).length,
        withChecklists: allCards.filter((c) => c.checklist.length > 0).length,
      },
    };
  });
}
