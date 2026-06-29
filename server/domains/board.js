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
  // Finite-number coercion helpers shared by the three analytics calculators.
  // parseFloat("Infinity") / parseFloat("1e999") both yield a non-finite value
  // that flows through `x || 0` (Infinity || 0 === Infinity) and JSON-serialises
  // to null → blank in the UI. finNum/finInt force every numeric output FINITE.
  const finNum = (v, dflt = 0) => {
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  };
  const finInt = (v, dflt = 0) => Math.round(finNum(v, dflt));
  const safeArr = (v) => (Array.isArray(v) ? v : []);

  registerLensAction("board", "workflowAnalysis", (ctx, artifact, params = {}) => {
  try {
    // Component-exact contract: the board page derives `cards`/`columns` from
    // its live tasks and passes them as params (the persisted task artifact's
    // .data has no cards/columns of its own). Fall back to artifact.data for any
    // caller that pre-stamps the board snapshot onto the artifact.
    const cards = safeArr(params.cards ?? artifact?.data?.cards);
    const columns = safeArr(params.columns ?? artifact?.data?.columns);

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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  /**
   * cardPrioritization
   * WSJF (Weighted Shortest Job First) scoring — cost of delay / job duration,
   * with urgency and risk adjustment.
   * artifact.data.cards: [{ id, title, businessValue: 1-10, timeCriticality: 1-10, riskReduction: 1-10, effort: 1-10, deadline? }]
   */
  registerLensAction("board", "cardPrioritization", (ctx, artifact, params = {}) => {
  try {
    const cards = safeArr(params.cards ?? artifact?.data?.cards);
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
          ? (Number.isFinite(new Date(card.deadline).getTime())
              ? Math.round((new Date(card.deadline).getTime() - now.getTime()) / 86400000)
              : null)
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  registerLensAction("board", "burndownForecast", (ctx, artifact, params = {}) => {
  try {
    const sprints = safeArr(params.sprints ?? artifact?.data?.sprints);
    // Fail-closed on poisoned numeric inputs (NaN/Infinity/1e308/-1): an explicit
    // isFinite reject so a poisoned knob can never silently degrade to a default
    // and return ok:true.
    const _rpRaw = params.remainingPoints ?? artifact?.data?.remainingPoints;
    for (const [name, raw] of [
      ["remainingPoints", _rpRaw],
      ["simulations", params.simulations],
      ["sprintLengthDays", params.sprintLengthDays],
    ]) {
      if (raw !== undefined && raw !== null && !Number.isFinite(Number(raw))) {
        return { ok: false, error: `invalid_${name}` };
      }
    }
    // finNum: a poisoned remainingPoints ("Infinity"/"1e999") must NOT pass the
    // > 0 gate and seed an infinite Monte-Carlo loop / non-finite output.
    const remainingPoints = finNum(_rpRaw, 0);
    // Clamp the simulation knobs FINITE + bounded so a poisoned/huge value can't
    // hang the loop. 1..50_000 sims, 1..365-day sprints.
    const simulations = Math.max(1, Math.min(50000, finInt(params.simulations, 1000)));
    const sprintLengthDays = Math.max(1, Math.min(365, finInt(params.sprintLengthDays, 14)));

    if (sprints.length === 0) {
      return { ok: true, result: { message: "No sprint history provided for forecasting." } };
    }
    if (!(remainingPoints > 0)) {
      return { ok: true, result: { message: "No remaining points to forecast.", completionDate: new Date().toISOString() } };
    }

    // Extract historical velocities — finNum so "1e999"/Infinity do not survive
    // the > 0 filter and poison avgVelocity / stdDev downstream.
    const velocities = sprints.map(s => finNum(s.completedPoints, 0)).filter(v => v > 0);
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = bdList(s, bdActor(ctx)).map((b) => ({
      id: b.id, name: b.name, columnCount: b.columns.length, cardCount: b.cards.length, createdAt: b.createdAt,
    }));
    return { ok: true, result: { boards, count: boards.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("board", "board-detail", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = bdList(s, bdActor(ctx)).find((b) => b.id === params.id);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { board } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
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
  try {
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
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Backlog parity macros (Trello feature gap) ─────────────────────
  // Comments + attachments + activity feed, calendar view, card covers,
  // automation rules, label management, collaborators, custom fields.

  function findCard(board, cardId) {
    return board ? board.cards.find((c) => c.id === cardId) : null;
  }
  function pushActivity(card, action) {
    if (!Array.isArray(card.activity)) card.activity = [];
    card.activity.unshift({ id: bdId("act"), action: bdClean(action, 240), at: bdNow() });
    if (card.activity.length > 200) card.activity.length = 200;
  }

  // ── Card detail: comments ──────────────────────────────────────────
  registerLensAction("board", "card-comment-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const text = bdClean(params.text, 2000);
    if (!text) return { ok: false, error: "comment text required" };
    if (!Array.isArray(card.comments)) card.comments = [];
    const comment = { id: bdId("cmt"), author: bdActor(ctx), text, at: bdNow() };
    card.comments.push(comment);
    pushActivity(card, "added a comment");
    saveBoard();
    return { ok: true, result: { comment, commentCount: card.comments.length } };
  });

  registerLensAction("board", "card-comment-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (!Array.isArray(card.comments)) card.comments = [];
    const i = card.comments.findIndex((c) => c.id === params.commentId);
    if (i < 0) return { ok: false, error: "comment not found" };
    card.comments.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.commentId, commentCount: card.comments.length } };
  });

  // ── Card detail: attachments (URL / link references, no binary) ─────
  registerLensAction("board", "card-attachment-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const url = bdClean(params.url, 1000);
    if (!url) return { ok: false, error: "attachment url required" };
    if (!Array.isArray(card.attachments)) card.attachments = [];
    const attachment = {
      id: bdId("att"),
      url,
      name: bdClean(params.name, 160) || url.slice(0, 60),
      kind: bdClean(params.kind, 24) || "link",
      at: bdNow(),
    };
    card.attachments.push(attachment);
    pushActivity(card, `attached ${attachment.name}`);
    saveBoard();
    return { ok: true, result: { attachment, attachmentCount: card.attachments.length } };
  });

  registerLensAction("board", "card-attachment-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (!Array.isArray(card.attachments)) card.attachments = [];
    const i = card.attachments.findIndex((a) => a.id === params.attachmentId);
    if (i < 0) return { ok: false, error: "attachment not found" };
    card.attachments.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.attachmentId, attachmentCount: card.attachments.length } };
  });

  // ── Card detail: activity feed read ────────────────────────────────
  registerLensAction("board", "card-detail", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    return {
      ok: true,
      result: {
        card: {
          ...card,
          comments: card.comments || [],
          attachments: Array.isArray(card.attachments) ? card.attachments : [],
          activity: card.activity || [],
          cover: card.cover || null,
          customFields: card.customFields || {},
        },
      },
    };
  });

  // ── Calendar view: cards grouped by due date ───────────────────────
  registerLensAction("board", "card-calendar", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const now = Date.now();
    const byDate = {};
    let scheduled = 0;
    let overdue = 0;
    for (const card of board.cards) {
      if (!card.dueDate) continue;
      const key = String(card.dueDate).slice(0, 10);
      if (!byDate[key]) byDate[key] = [];
      const col = board.columns.find((c) => c.id === card.columnId);
      const isOverdue = new Date(card.dueDate).getTime() < now;
      if (isOverdue) overdue++;
      byDate[key].push({
        id: card.id, title: card.title, columnId: card.columnId,
        columnName: col ? col.name : null, dueDate: card.dueDate, overdue: isOverdue,
        labels: card.labels || [],
      });
      scheduled++;
    }
    const days = Object.keys(byDate).sort().map((date) => ({ date, cards: byDate[date] }));
    return {
      ok: true,
      result: { days, scheduled, overdue, unscheduled: board.cards.length - scheduled },
    };
  });

  // ── Card cover image + rich description ────────────────────────────
  registerLensAction("board", "card-set-cover", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (params.cover == null || params.cover === "") {
      card.cover = null;
    } else if (typeof params.cover === "object") {
      card.cover = {
        type: params.cover.type === "color" ? "color" : "image",
        value: bdClean(params.cover.value, 1000),
      };
      if (!card.cover.value) card.cover = null;
    } else {
      card.cover = { type: "image", value: bdClean(params.cover, 1000) };
    }
    pushActivity(card, card.cover ? "updated the cover" : "removed the cover");
    saveBoard();
    return { ok: true, result: { cardId: card.id, cover: card.cover } };
  });

  // ── Board automation rules ─────────────────────────────────────────
  // Trigger: card-moved-to-column. Actions: check-all-checklist,
  // set-due-clear, add-label, set-assignee.
  const AUTO_TRIGGERS = new Set(["card-moved-to-column"]);
  const AUTO_ACTIONS = new Set(["check-all-checklist", "clear-due", "add-label", "set-assignee"]);

  registerLensAction("board", "automation-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const trigger = bdClean(params.trigger, 48);
    const action = bdClean(params.action, 48);
    if (!AUTO_TRIGGERS.has(trigger)) return { ok: false, error: "unknown trigger" };
    if (!AUTO_ACTIONS.has(action)) return { ok: false, error: "unknown action" };
    const columnId = bdClean(params.columnId, 64);
    if (!board.columns.find((c) => c.id === columnId)) return { ok: false, error: "trigger column not found" };
    if (!Array.isArray(board.automations)) board.automations = [];
    const rule = {
      id: bdId("auto"),
      trigger,
      columnId,
      action,
      value: bdClean(params.value, 120) || null,
      enabled: true,
      createdAt: bdNow(),
    };
    board.automations.push(rule);
    saveBoard();
    return { ok: true, result: { rule } };
  });

  registerLensAction("board", "automation-list", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { rules: Array.isArray(board.automations) ? board.automations : [] } };
  });

  registerLensAction("board", "automation-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.automations)) board.automations = [];
    const i = board.automations.findIndex((r) => r.id === params.ruleId);
    if (i < 0) return { ok: false, error: "rule not found" };
    board.automations.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.ruleId } };
  });

  // card-move-auto: move a card and apply matching automation rules
  registerLensAction("board", "card-move-auto", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const target = board.columns.find((c) => c.id === params.toColumnId);
    if (!target) return { ok: false, error: "target column not found" };
    card.columnId = target.id;
    if (params.position != null) card.position = Math.max(0, Math.round(Number(params.position)));
    else card.position = board.cards.filter((c) => c.columnId === target.id && c.id !== card.id).length;
    board.cards.filter((c) => c.columnId === target.id).sort((a, b) => a.position - b.position)
      .forEach((c, i) => { c.position = i; });
    pushActivity(card, `moved to ${target.name}`);
    // apply automations
    const applied = [];
    const rules = Array.isArray(board.automations) ? board.automations : [];
    for (const rule of rules) {
      if (!rule.enabled || rule.trigger !== "card-moved-to-column" || rule.columnId !== target.id) continue;
      if (rule.action === "check-all-checklist") {
        for (const item of card.checklist || []) item.done = true;
      } else if (rule.action === "clear-due") {
        card.dueDate = null;
      } else if (rule.action === "add-label" && rule.value) {
        if (!Array.isArray(card.labels)) card.labels = [];
        if (!card.labels.includes(rule.value) && card.labels.length < 6) card.labels.push(rule.value);
      } else if (rule.action === "set-assignee" && rule.value) {
        card.assignee = rule.value;
      }
      applied.push(rule.id);
      pushActivity(card, `automation: ${rule.action}`);
    }
    saveBoard();
    return { ok: true, result: { cardId: card.id, columnId: card.columnId, automationsApplied: applied } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ── Label management ───────────────────────────────────────────────
  const LABEL_COLORS = new Set([
    "red", "orange", "yellow", "green", "blue", "purple", "pink", "gray",
  ]);
  registerLensAction("board", "label-create", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const name = bdClean(params.name, 40);
    if (!name) return { ok: false, error: "label name required" };
    if (!Array.isArray(board.labelDefs)) board.labelDefs = [];
    if (board.labelDefs.some((l) => l.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "label already exists" };
    }
    const color = LABEL_COLORS.has(params.color) ? params.color : "gray";
    const label = { id: bdId("lbl"), name, color };
    board.labelDefs.push(label);
    saveBoard();
    return { ok: true, result: { label } };
  });

  registerLensAction("board", "label-list", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { labels: Array.isArray(board.labelDefs) ? board.labelDefs : [] } };
  });

  registerLensAction("board", "label-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.labelDefs)) board.labelDefs = [];
    const i = board.labelDefs.findIndex((l) => l.id === params.labelId);
    if (i < 0) return { ok: false, error: "label not found" };
    const removed = board.labelDefs.splice(i, 1)[0];
    // strip the label from all cards
    for (const card of board.cards) {
      if (Array.isArray(card.labels)) card.labels = card.labels.filter((l) => l !== removed.name);
    }
    saveBoard();
    return { ok: true, result: { deleted: params.labelId } };
  });

  // ── Board collaborators / sharing with permissions ─────────────────
  const COLLAB_ROLES = new Set(["viewer", "editor", "admin"]);
  registerLensAction("board", "collaborator-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const userId = bdClean(params.userId, 80);
    if (!userId) return { ok: false, error: "userId required" };
    const role = COLLAB_ROLES.has(params.role) ? params.role : "viewer";
    if (!Array.isArray(board.collaborators)) board.collaborators = [];
    const existing = board.collaborators.find((c) => c.userId === userId);
    if (existing) {
      existing.role = role;
      saveBoard();
      return { ok: true, result: { collaborator: existing, updated: true } };
    }
    const collaborator = { id: bdId("clb"), userId, role, addedAt: bdNow() };
    board.collaborators.push(collaborator);
    saveBoard();
    return { ok: true, result: { collaborator } };
  });

  registerLensAction("board", "collaborator-list", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return {
      ok: true,
      result: {
        owner: bdActor(ctx),
        collaborators: Array.isArray(board.collaborators) ? board.collaborators : [],
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("board", "collaborator-remove", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.collaborators)) board.collaborators = [];
    const i = board.collaborators.findIndex((c) => c.id === params.collaboratorId || c.userId === params.userId);
    if (i < 0) return { ok: false, error: "collaborator not found" };
    const removed = board.collaborators.splice(i, 1)[0];
    saveBoard();
    return { ok: true, result: { removed: removed.userId } };
  });

  // ── Power-ups / custom fields on cards ─────────────────────────────
  const FIELD_TYPES = new Set(["text", "number", "date", "select", "checkbox"]);
  registerLensAction("board", "custom-field-add", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const name = bdClean(params.name, 48);
    if (!name) return { ok: false, error: "field name required" };
    const type = FIELD_TYPES.has(params.type) ? params.type : "text";
    if (!Array.isArray(board.customFields)) board.customFields = [];
    if (board.customFields.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: "field already exists" };
    }
    const options = type === "select" && Array.isArray(params.options)
      ? params.options.map((o) => bdClean(o, 48)).filter(Boolean).slice(0, 20)
      : [];
    const field = { id: bdId("fld"), name, type, options };
    board.customFields.push(field);
    saveBoard();
    return { ok: true, result: { field } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("board", "custom-field-list", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { fields: Array.isArray(board.customFields) ? board.customFields : [] } };
  });

  registerLensAction("board", "custom-field-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.customFields)) board.customFields = [];
    const i = board.customFields.findIndex((f) => f.id === params.fieldId);
    if (i < 0) return { ok: false, error: "field not found" };
    const removed = board.customFields.splice(i, 1)[0];
    for (const card of board.cards) {
      if (card.customFields && card.customFields[removed.id] !== undefined) {
        delete card.customFields[removed.id];
      }
    }
    saveBoard();
    return { ok: true, result: { deleted: params.fieldId } };
  });

  registerLensAction("board", "card-set-field", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const field = (board.customFields || []).find((f) => f.id === params.fieldId);
    if (!field) return { ok: false, error: "field not found" };
    if (!card.customFields || typeof card.customFields !== "object") card.customFields = {};
    if (params.value == null || params.value === "") {
      delete card.customFields[field.id];
    } else if (field.type === "number") {
      const n = Number(params.value);
      if (Number.isNaN(n)) return { ok: false, error: "value must be a number" };
      card.customFields[field.id] = n;
    } else if (field.type === "checkbox") {
      card.customFields[field.id] = !!params.value;
    } else if (field.type === "select") {
      const v = bdClean(params.value, 48);
      if (field.options.length && !field.options.includes(v)) {
        return { ok: false, error: "value not in field options" };
      }
      card.customFields[field.id] = v;
    } else {
      card.customFields[field.id] = bdClean(params.value, 400);
    }
    pushActivity(card, `set field ${field.name}`);
    saveBoard();
    return { ok: true, result: { cardId: card.id, fieldId: field.id, customFields: card.customFields } };
  });
}
