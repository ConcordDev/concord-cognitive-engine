// server/domains/board.js
// Domain actions for board/kanban management: workflow analysis, card prioritization, burndown forecasting.

import { guardAnonWrites } from "../lib/lens-authz.js";
import { displayName } from "../lib/media-release-shop.js";
export default function registerBoardActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)

  // ── Shared boards: who may do what (the Cork Wall, 2026-11-20) ──────
  // A board lives in its owner's list. Collaborators are real: a viewer can
  // open it and comment, an editor can change cards and columns, an admin
  // can also manage people, labels and automations; only the owner deletes
  // it. Every board action declares the role it needs; one wrapper checks
  // it, says plainly when the role falls short, records who did what on the
  // board's activity, and sends the change live to everyone on the board.
  const ROLE_RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
  const NEED = {
    "board-detail": "view", "card-detail": "view", "card-calendar": "view", "automation-list": "view",
    "label-list": "view", "collaborator-list": "view", "custom-field-list": "view", "card-template-list": "view",
    "board-presence": "view", "board-activity": "view", "card-comment-add": "view", "card-comment-update": "view", "card-comment-delete": "view",
    "board-update": "admin", "collaborator-add": "admin", "collaborator-remove": "admin",
    "automation-add": "admin", "automation-delete": "admin", "automation-toggle": "admin",
    "board-delete": "owner",
    "column-add": "edit", "column-delete": "edit", "column-update": "edit", "column-archive": "edit", "column-restore": "edit",
    "card-create": "edit", "card-move": "edit", "card-move-auto": "edit", "card-update": "edit", "card-checklist-toggle": "edit",
    "card-delete": "edit", "card-archive": "edit", "card-restore": "edit", "card-attachment-add": "edit", "card-attachment-delete": "edit",
    "card-set-cover": "edit", "label-create": "edit", "label-delete": "edit", "label-update": "edit",
    "custom-field-add": "edit", "custom-field-delete": "edit", "custom-field-update": "edit", "card-set-field": "edit",
    "card-template-create": "edit", "card-template-delete": "edit", "card-create-from-template": "edit",
  };
  let ACTING = null; // the person whose action is running (handlers are synchronous)
  const nameOf = (userId) => (userId && userId !== "anon" ? displayName(userId) || "someone" : "someone");
  function locateBoard(s, boardId) {
    if (!s || !boardId) return null;
    for (const [ownerId, arr] of s.boards) {
      const b = arr.find((x) => x.id === boardId);
      if (b) { if (!b.ownerId) b.ownerId = ownerId; return b; }
    }
    return null;
  }
  function roleOn(board, userId) {
    if (!board || !userId || userId === "anon") return null;
    if (board.ownerId === userId) return "owner";
    const c = (board.collaborators || []).find((x) => x.userId === userId);
    return c ? c.role : null;
  }
  const RANK_OF_NEED = { view: 1, edit: 2, admin: 3, owner: 4 };
  const membersOf = (board) => [board.ownerId, ...(board.collaborators || []).map((c) => c.userId)].filter(Boolean);
  function emitBoard(board, event, payload, alsoTo = []) {
    try {
      const fn = globalThis._concordRealtimeEmit || globalThis.realtimeEmit;
      if (typeof fn !== "function") return;
      for (const uid of new Set([...membersOf(board), ...alsoTo])) fn(event, { boardId: board.id, ...payload }, { userId: uid });
    } catch { /* live updates are best-effort; the board itself is saved */ }
  }
  const ACT_WORDS = {
    "card-create": "added", "card-move": "moved", "card-move-auto": "moved", "card-update": "edited", "card-checklist-toggle": "ticked an item on",
    "card-delete": "deleted", "card-archive": "archived", "card-restore": "restored", "card-comment-add": "commented on",
    "card-attachment-add": "attached a file to", "card-set-cover": "set the cover of", "card-set-field": "set a field on",
    "card-create-from-template": "added from a template", "column-add": "added a column", "column-update": "renamed a column",
    "column-delete": "deleted a column", "column-archive": "archived a column", "column-restore": "restored a column",
    "board-update": "renamed the board", "collaborator-add": "shared the board", "collaborator-remove": "removed someone from the board",
    "automation-add": "added an automation", "automation-delete": "removed an automation", "automation-toggle": "switched an automation",
    "label-create": "added a label", "label-update": "edited a label", "label-delete": "deleted a label",
  };
  {
    const inner = registerLensAction;
    registerLensAction = function boardAccess(domain, name, handler, ...rest) {
      const need = NEED[name];
      if (domain !== "board" || !need || typeof handler !== "function") return inner(domain, name, handler, ...rest);
      return inner(domain, name, (ctx, a, params = {}) => {
        const s = getBoardState();
        const bid = params?.boardId ?? params?.id;
        const me = bdActor(ctx);
        let board = null;
        if (s && bid != null) {
          board = locateBoard(s, String(bid));
          if (!board) return { ok: false, error: "board not found" };
          const role = roleOn(board, me);
          // Leaving a board you were invited to needs no admin.
          const leaving = name === "collaborator-remove" && role && role !== "owner" && params?.userId === me;
          if (!role) return { ok: false, error: "board not found" };
          if (!leaving && ROLE_RANK[role] < RANK_OF_NEED[need]) {
            return { ok: false, error: need === "edit" ? "you can look at this board, but not change it" : need === "owner" ? "only the board's owner can do that" : "only the board's owner or an admin can do that" };
          }
        }
        ACTING = { userId: me };
        let r;
        try { r = handler({ ...(ctx || {}), __bdNeed: name === "collaborator-remove" ? "view" : need }, a, params); }
        finally { ACTING = null; }
        if (board && need !== "view" || name === "card-comment-add") {
          if (r && r.ok && board) {
            const cardId = params?.cardId || r?.result?.card?.id || null;
            const card = cardId ? (board.cards || []).find((c) => c.id === cardId) : null;
            const col = name.startsWith("card-move") && card ? board.columns.find((c) => c.id === card.columnId) : null;
            const entry = { id: bdId("bact"), at: bdNow(), by: me, byName: nameOf(me), action: name, words: ACT_WORDS[name] || name, cardId, cardTitle: card ? card.title : null, toColumn: col ? col.name : null };
            if (name !== "board-delete") {
              if (!Array.isArray(board.activity)) board.activity = [];
              board.activity.unshift(entry);
              if (board.activity.length > 300) board.activity.length = 300;
              saveBoard();
            }
            emitBoard(board, name === "board-delete" ? "board:removed" : "board:changed", { action: name, cardId, by: { id: me, name: entry.byName }, words: entry.words, cardTitle: entry.cardTitle, toColumn: entry.toColumn },
              name === "collaborator-remove" && r?.result?.removed ? [r.result.removed] : []);
          }
        }
        return r;
      }, ...rest);
    };
  }
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
    // finNum: a poisoned remainingPoints ("Infinity"/"1e999") must NOT pass the
    // > 0 gate and seed an infinite Monte-Carlo loop / non-finite output.
    const remainingPoints = finNum(params.remainingPoints ?? artifact?.data?.remainingPoints, 0);
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
      ownerId: bdActor(ctx),
      collaborators: [],
      activity: [],
      createdAt: bdNow(),
    };
    bdList(s, bdActor(ctx)).push(board);
    saveBoard();
    return { ok: true, result: { board } };
  });

  registerLensAction("board", "board-list", (ctx, _a, _params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = bdActor(ctx);
    const boards = boardsFor(s, me).map((b) => ({
      id: b.id, name: b.name, columnCount: b.columns.length, cardCount: b.cards.filter((c) => !c.archived).length, createdAt: b.createdAt,
      role: roleOn(b, me), owner: { id: b.ownerId, name: nameOf(b.ownerId) }, shared: (b.collaborators || []).length > 0,
      background: b.background || null,
    }));
    return { ok: true, result: { boards, count: boards.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("board", "board-detail", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.id);
    if (!board) return { ok: false, error: "board not found" };
    const me = bdActor(ctx);
    return { ok: true, result: { board: { ...board, activity: undefined, viewers: undefined }, role: roleOn(board, me), members: membersView(board), me } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("board", "board-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = bdList(s, bdActor(ctx));
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "board not found" };
    const gone = arr.splice(i, 1)[0];
    emitBoard(gone, "board:removed", { action: "board-delete", by: { id: bdActor(ctx), name: nameOf(bdActor(ctx)) } });
    saveBoard();
    return { ok: true, result: { deleted: params.id } };
  });

  // Rename / redescribe a board (Trello: boards are renameable in place).
  registerLensAction("board", "board-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.id);
    if (!board) return { ok: false, error: "board not found" };
    if (params.background !== undefined) board.background = ["cork", "dark", "pale"].includes(params.background) ? params.background : null;
    if (params.name != null) {
      const name = bdClean(params.name, 120);
      if (!name) return { ok: false, error: "board name required" };
      board.name = name;
    }
    if (params.description !== undefined) board.description = bdClean(params.description, 2000) || null;
    saveBoard();
    return { ok: true, result: { board } };
  });

  function findBoard(s, ctx, boardId) {
    const b = locateBoard(s, String(boardId ?? ""));
    if (!b) return undefined;
    const role = roleOn(b, bdActor(ctx));
    const need = ctx?.__bdNeed || "edit";
    if (!role || ROLE_RANK[role] < RANK_OF_NEED[need]) return undefined;
    return b;
  }
  /** Every board this person can open: their own, then the ones shared with them. */
  function boardsFor(s, userId) {
    const own = bdList(s, userId).map((b) => { if (!b.ownerId) b.ownerId = userId; return b; });
    const shared = [];
    for (const [ownerId, arr] of s.boards) {
      if (ownerId === userId) continue;
      for (const b of arr) { if (!b.ownerId) b.ownerId = ownerId; if ((b.collaborators || []).some((c) => c.userId === userId)) shared.push(b); }
    }
    return [...own, ...shared];
  }
  function membersView(board) {
    return [{ userId: board.ownerId, name: nameOf(board.ownerId), role: "owner" },
      ...(board.collaborators || []).map((c) => ({ userId: c.userId, name: nameOf(c.userId), role: c.role, id: c.id, addedAt: c.addedAt }))];
  }
  /** An assignee must be on the board: a member's id or username. null clears it. */
  function resolveMember(board, v) {
    if (v == null || v === "") return { ok: true, userId: null };
    const raw = String(v).trim().slice(0, 80);
    const members = membersOf(board);
    if (members.includes(raw)) return { ok: true, userId: raw };
    const byName = members.find((m) => (nameOf(m) || "").toLowerCase() === raw.toLowerCase());
    if (byName) return { ok: true, userId: byName };
    return { ok: false, error: `${raw} isn't on this board; share it with them first` };
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

  // Rename a list and/or move it to a new position (column order = array order).
  registerLensAction("board", "column-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const i = board.columns.findIndex((c) => c.id === params.columnId);
    if (i < 0) return { ok: false, error: "column not found" };
    const column = board.columns[i];
    if (params.name != null) {
      const name = bdClean(params.name, 80);
      if (!name) return { ok: false, error: "column name required" };
      column.name = name;
    }
    if (params.toIndex != null) {
      const to = Math.max(0, Math.min(board.columns.length - 1, Math.round(Number(params.toIndex))));
      if (Number.isFinite(to) && to !== i) {
        board.columns.splice(i, 1);
        board.columns.splice(to, 0, column);
      }
    }
    saveBoard();
    return { ok: true, result: { column, index: board.columns.indexOf(column) } };
  });

  // Archive a list: hidden from the working board, cards kept, restorable.
  registerLensAction("board", "column-archive", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const column = board.columns.find((c) => c.id === params.columnId);
    if (!column) return { ok: false, error: "column not found" };
    column.archived = true;
    column.archivedAt = bdNow();
    saveBoard();
    return { ok: true, result: { columnId: column.id, archived: true } };
  });

  registerLensAction("board", "column-restore", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const column = board.columns.find((c) => c.id === params.columnId);
    if (!column) return { ok: false, error: "column not found" };
    column.archived = false;
    delete column.archivedAt;
    saveBoard();
    return { ok: true, result: { columnId: column.id, archived: false } };
  });

  registerLensAction("board", "card-create", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const askedForColumn = params.columnId != null && String(params.columnId) !== "";
    const found = board.columns.find((c) => c.id === params.columnId);
    if (askedForColumn && !found) return { ok: false, error: "column not found" };
    const column = found || board.columns[0];
    if (!column) return { ok: false, error: "board has no columns" };
    const title = bdClean(params.title, 240);
    if (!title) return { ok: false, error: "card title required" };
    const who = resolveMember(board, params.assignee);
    if (!who.ok) return { ok: false, error: who.error };
    const due = cleanDue(params.dueDate);
    if (due === false) return { ok: false, error: "dueDate must be a date like 2026-11-30" };
    const card = {
      id: bdId("crd"),
      columnId: column.id,
      title,
      description: bdClean(params.description, 4000),
      labels: Array.isArray(params.labels) ? params.labels.map((l) => bdClean(l, 30)).filter(Boolean).slice(0, 6) : [],
      dueDate: due,
      assignee: who.userId,
      checklist: [],
      position: board.cards.filter((c) => c.columnId === column.id).length,
      createdBy: bdActor(ctx),
      transitions: [{ columnId: column.id, at: bdNow() }],
      createdAt: bdNow(),
    };
    board.cards.push(card);
    pushActivity(card, "created the card");
    const applied = runAutomations(board, card, "card-created-in-column", column.id);
    saveBoard();
    return { ok: true, result: { card, automationsApplied: applied.map((a) => a.id), automations: applied } };
  });

  registerLensAction("board", "card-move", (ctx, _a, params = {}) => moveCard(ctx, params));

  /** The one move: reorder, record the column change, then run the board's automations. */
  function moveCard(ctx, params) {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = board.cards.find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    const target = board.columns.find((c) => c.id === params.toColumnId);
    if (!target) return { ok: false, error: "target column not found" };
    if (target.archived) return { ok: false, error: "that column is archived" };
    const from = card.columnId;
    card.columnId = target.id;
    const others = board.cards.filter((c) => c.columnId === target.id && c.id !== card.id && !c.archived).sort((a, b) => a.position - b.position);
    const at = params.position == null ? others.length : Math.max(0, Math.min(others.length, Math.round(Number(params.position) || 0)));
    others.splice(at, 0, card);
    others.forEach((c, i) => { c.position = i; });
    if (from !== target.id) {
      board.cards.filter((c) => c.columnId === from && !c.archived).sort((a, b) => a.position - b.position).forEach((c, i) => { c.position = i; });
      if (!Array.isArray(card.transitions)) card.transitions = [];
      card.transitions.push({ columnId: target.id, at: bdNow() });
      if (card.transitions.length > 100) card.transitions.splice(0, card.transitions.length - 100);
      pushActivity(card, `moved to ${target.name}`);
    }
    const applied = from !== target.id ? runAutomations(board, card, "card-moved-to-column", target.id) : [];
    saveBoard();
    return { ok: true, result: { cardId: card.id, columnId: card.columnId, position: card.position, automationsApplied: applied.map((a) => a.id), automations: applied } };
  }

  registerLensAction("board", "card-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = board.cards.find((c) => c.id === params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (params.title != null) card.title = bdClean(params.title, 240) || card.title;
    if (params.description != null) card.description = bdClean(params.description, 4000);
    if (Array.isArray(params.labels)) card.labels = params.labels.map((l) => bdClean(l, 30)).filter(Boolean).slice(0, 6);
    if (params.dueDate !== undefined) {
      const due = cleanDue(params.dueDate);
      if (due === false) return { ok: false, error: "dueDate must be a date like 2026-11-30" };
      card.dueDate = due;
    }
    if (params.assignee !== undefined) {
      const who = resolveMember(board, params.assignee);
      if (!who.ok) return { ok: false, error: who.error };
      card.assignee = who.userId;
    }
    if (params.addChecklistItem) {
      card.checklist.push({ id: bdId("ci"), text: bdClean(params.addChecklistItem, 200), done: false });
    }
    pushActivity(card, "updated the card");
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
    const complete = card.checklist.length > 0 && card.checklist.every((i) => i.done);
    const applied = item.done && complete ? runAutomations(board, card, "checklist-completed", card.columnId) : [];
    saveBoard();
    return { ok: true, result: { itemId: item.id, done: item.done, checklistComplete: complete, columnId: card.columnId, automationsApplied: applied.map((a) => a.id), automations: applied } };
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

  // Archive a card: out of the working board, kept and restorable (Trello's
  // safety net — delete is forever, archive is not).
  registerLensAction("board", "card-archive", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    card.archived = true;
    card.archivedAt = bdNow();
    pushActivity(card, "archived the card");
    saveBoard();
    return { ok: true, result: { cardId: card.id, archived: true } };
  });

  registerLensAction("board", "card-restore", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    card.archived = false;
    delete card.archivedAt;
    pushActivity(card, "restored the card");
    saveBoard();
    return { ok: true, result: { cardId: card.id, archived: false } };
  });

  registerLensAction("board", "board-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const boards = boardsFor(s, bdActor(ctx));
    const allCards = boards.flatMap((b) => b.cards);
    const now = Date.now();
    return {
      ok: true,
      result: {
        boards: boards.length,
        totalCards: allCards.length,
        overdue: allCards.filter((c) => !c.archived && c.dueDate && new Date(c.dueDate).getTime() < now).length,
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
    card.activity.unshift({ id: bdId("act"), action: bdClean(action, 240), at: bdNow(), by: ACTING?.userId || null, byName: ACTING ? nameOf(ACTING.userId) : null });
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
    const comment = { id: bdId("cmt"), author: bdActor(ctx), authorName: nameOf(bdActor(ctx)), text, at: bdNow() };
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

  // Edit a comment — author only (the comment's recorded author, from ctx at
  // add time; never a caller-supplied identity).
  registerLensAction("board", "card-comment-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (!Array.isArray(card.comments)) card.comments = [];
    const comment = card.comments.find((c) => c.id === params.commentId);
    if (!comment) return { ok: false, error: "comment not found" };
    if (comment.author !== bdActor(ctx)) return { ok: false, error: "only the comment author can edit this comment" };
    const text = bdClean(params.text, 2000);
    if (!text) return { ok: false, error: "comment text required" };
    comment.text = text;
    comment.editedAt = bdNow();
    pushActivity(card, "edited a comment");
    saveBoard();
    return { ok: true, result: { comment } };
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
      if (card.archived || !card.dueDate) continue;
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
  // Automations: "when <trigger> in <column>, do <action>". They run inside
  // the same move / create / checklist call that triggered them (one pass;
  // a rule that moves a card does not set off further rules).
  const AUTO_TRIGGERS = new Set(["card-moved-to-column", "card-created-in-column", "checklist-completed"]);
  const AUTO_ACTIONS = new Set(["check-all-checklist", "clear-due", "add-label", "set-assignee", "set-due-in-days", "move-to-column"]);
  function cleanDue(v) {
    if (v == null || v === "") return null;
    const t = String(v).trim().slice(0, 30);
    if (!/^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(t) || !Number.isFinite(Date.parse(t))) return false;
    return t;
  }
  function runAutomations(board, card, trigger, columnId) {
    const applied = [];
    for (const rule of Array.isArray(board.automations) ? board.automations : []) {
      if (!rule.enabled || rule.trigger !== trigger || rule.columnId !== columnId) continue;
      if (rule.action === "check-all-checklist") { for (const item of card.checklist || []) item.done = true; }
      else if (rule.action === "clear-due") card.dueDate = null;
      else if (rule.action === "add-label" && rule.value) {
        if (!Array.isArray(card.labels)) card.labels = [];
        if (!card.labels.includes(rule.value) && card.labels.length < 6) card.labels.push(rule.value);
      } else if (rule.action === "set-assignee" && rule.value) {
        if (membersOf(board).includes(rule.value)) card.assignee = rule.value; else continue;
      } else if (rule.action === "set-due-in-days") {
        const d = new Date(Date.now() + Number(rule.value) * 86400000);
        card.dueDate = d.toISOString().slice(0, 10);
      } else if (rule.action === "move-to-column") {
        const to = board.columns.find((c) => c.id === rule.value && !c.archived);
        if (!to || to.id === card.columnId) continue;
        card.columnId = to.id;
        card.position = board.cards.filter((c) => c.columnId === to.id && c.id !== card.id && !c.archived).length;
        if (!Array.isArray(card.transitions)) card.transitions = [];
        card.transitions.push({ columnId: to.id, at: bdNow() });
      } else continue;
      applied.push({ id: rule.id, action: rule.action });
      pushActivity(card, `automation: ${AUTO_WORDS[rule.action] || rule.action}`);
    }
    return applied;
  }
  const AUTO_WORDS = { "check-all-checklist": "ticked the whole checklist", "clear-due": "cleared the due date", "add-label": "added a label", "set-assignee": "assigned it", "set-due-in-days": "set a due date", "move-to-column": "moved it" };

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
    let value = bdClean(params.value, 120) || null;
    if (action === "add-label" && !value) return { ok: false, error: "choose the label to add" };
    if (action === "set-assignee") { const who = resolveMember(board, value); if (!who.ok || !who.userId) return { ok: false, error: who.error || "choose who to assign" }; value = who.userId; }
    if (action === "set-due-in-days") { const n = Number(value); if (!Number.isInteger(n) || n < 0 || n > 365) return { ok: false, error: "set-due-in-days takes 0 to 365 days" }; value = String(n); }
    if (action === "move-to-column") {
      if (!board.columns.find((c) => c.id === value && !c.archived)) return { ok: false, error: "choose the column to move it to" };
      if (trigger === "card-moved-to-column" && value === columnId) return { ok: false, error: "a card moved into a column can't be moved into the same column" };
    }
    if (!Array.isArray(board.automations)) board.automations = [];
    if (board.automations.length >= 50) return { ok: false, error: "a board can have 50 automations" };
    const rule = {
      id: bdId("auto"),
      trigger,
      columnId,
      action,
      value,
      enabled: true,
      createdBy: bdActor(ctx),
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
  // Kept for older callers: every move runs the automations now.
  registerLensAction("board", "card-move-auto", (ctx, _a, params = {}) => moveCard(ctx, params));

  registerLensAction("board", "automation-toggle", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const rule = (board.automations || []).find((r) => r.id === params.ruleId);
    if (!rule) return { ok: false, error: "automation not found" };
    rule.enabled = params.enabled === undefined ? !rule.enabled : !!params.enabled;
    saveBoard();
    return { ok: true, result: { rule } };
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

  // Rename / recolor a label. Cards store label NAMES, so a rename cascades
  // to every card carrying the old name (same treatment as label-delete).
  registerLensAction("board", "label-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.labelDefs)) board.labelDefs = [];
    const label = board.labelDefs.find((l) => l.id === params.labelId);
    if (!label) return { ok: false, error: "label not found" };
    if (params.name != null) {
      const name = bdClean(params.name, 40);
      if (!name) return { ok: false, error: "label name required" };
      if (board.labelDefs.some((l) => l.id !== label.id && l.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: "label already exists" };
      }
      if (name !== label.name) {
        const old = label.name;
        for (const card of board.cards) {
          if (Array.isArray(card.labels)) card.labels = card.labels.map((l) => (l === old ? name : l));
        }
        label.name = name;
      }
    }
    if (params.color != null) {
      if (!LABEL_COLORS.has(params.color)) return { ok: false, error: "unknown label color" };
      label.color = params.color;
    }
    saveBoard();
    return { ok: true, result: { label } };
  });

  // ── Board collaborators / sharing with permissions ─────────────────
  const COLLAB_ROLES = new Set(["viewer", "editor", "admin"]);
  registerLensAction("board", "collaborator-add", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const role = COLLAB_ROLES.has(params.role) ? params.role : "viewer";
    const me = bdActor(ctx);
    // Only the owner hands out admin.
    if (role === "admin" && board.ownerId !== me) return { ok: false, error: "only the board's owner can make someone an admin" };
    const handle = bdClean(params.username ?? params.userId, 80).replace(/^@/, "");
    if (!handle) return { ok: false, error: "username required" };
    let user = null;
    try {
      const db = globalThis._concordSTATE?.db;
      user = db?.prepare?.("SELECT id, username FROM users WHERE lower(username) = lower(?) OR id = ? LIMIT 1").get(handle, handle) || null;
    } catch { user = null; }
    if (!user) return { ok: false, error: `no one is called ${handle}` };
    if (user.id === board.ownerId) return { ok: false, error: "that's the board's owner" };
    if (!Array.isArray(board.collaborators)) board.collaborators = [];
    const existing = board.collaborators.find((c) => c.userId === user.id);
    if (existing) {
      if (existing.role === "admin" && board.ownerId !== me) return { ok: false, error: "only the board's owner can change an admin" };
      existing.role = role;
      saveBoard();
      return { ok: true, result: { collaborator: { ...existing, name: user.username }, updated: true, members: membersView(board) } };
    }
    if (board.collaborators.length >= 50) return { ok: false, error: "a board can be shared with 50 people" };
    const collaborator = { id: bdId("clb"), userId: user.id, role, addedAt: bdNow(), addedBy: me };
    board.collaborators.push(collaborator);
    saveBoard();
    emitBoard(board, "board:shared", { action: "collaborator-add", by: { id: me, name: nameOf(me) }, role }, [user.id]);
    return { ok: true, result: { collaborator: { ...collaborator, name: user.username }, members: membersView(board) } };
  });

  registerLensAction("board", "collaborator-list", (ctx, _a, params = {}) => {
  try {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return {
      ok: true,
      result: {
        owner: board.ownerId,
        collaborators: Array.isArray(board.collaborators) ? board.collaborators : [],
        members: membersView(board),
        role: roleOn(board, bdActor(ctx)),
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
    const me = bdActor(ctx);
    const target = board.collaborators[i];
    const myRole = roleOn(board, me);
    if (target.userId !== me && myRole !== "owner" && myRole !== "admin") return { ok: false, error: "only the board's owner or an admin can do that" };
    if (target.role === "admin" && target.userId !== me && myRole !== "owner") return { ok: false, error: "only the board's owner can remove an admin" };
    const removed = board.collaborators.splice(i, 1)[0];
    // Their cards stay; they're simply no longer assigned.
    for (const c of board.cards) if (c.assignee === removed.userId) c.assignee = null;
    saveBoard();
    return { ok: true, result: { removed: removed.userId, left: removed.userId === me } };
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

  // Rename a custom field and/or replace a select field's options.
  registerLensAction("board", "custom-field-update", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.customFields)) board.customFields = [];
    const field = board.customFields.find((f) => f.id === params.fieldId);
    if (!field) return { ok: false, error: "field not found" };
    if (params.name != null) {
      const name = bdClean(params.name, 48);
      if (!name) return { ok: false, error: "field name required" };
      if (board.customFields.some((f) => f.id !== field.id && f.name.toLowerCase() === name.toLowerCase())) {
        return { ok: false, error: "field already exists" };
      }
      field.name = name;
    }
    if (params.options !== undefined) {
      if (field.type !== "select") return { ok: false, error: "only select fields have options" };
      if (!Array.isArray(params.options)) return { ok: false, error: "options must be a list" };
      field.options = params.options.map((o) => bdClean(o, 48)).filter(Boolean).slice(0, 20);
    }
    saveBoard();
    return { ok: true, result: { field } };
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

  // ── Card templates (Trello: save a card as a template, spawn from it) ──
  registerLensAction("board", "card-template-create", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const card = findCard(board, params.cardId);
    if (!card) return { ok: false, error: "card not found" };
    if (!Array.isArray(board.templates)) board.templates = [];
    const template = {
      id: bdId("tpl"),
      name: bdClean(params.name, 120) || card.title,
      title: card.title,
      description: card.description || "",
      labels: Array.isArray(card.labels) ? [...card.labels] : [],
      checklist: (card.checklist || []).map((i) => ({ text: i.text })),
      customFields: card.customFields && typeof card.customFields === "object" ? { ...card.customFields } : {},
      createdAt: bdNow(),
    };
    board.templates.push(template);
    saveBoard();
    return { ok: true, result: { template } };
  });

  registerLensAction("board", "card-template-list", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    return { ok: true, result: { templates: Array.isArray(board.templates) ? board.templates : [] } };
  });

  registerLensAction("board", "card-template-delete", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    if (!Array.isArray(board.templates)) board.templates = [];
    const i = board.templates.findIndex((t) => t.id === params.templateId);
    if (i < 0) return { ok: false, error: "template not found" };
    board.templates.splice(i, 1);
    saveBoard();
    return { ok: true, result: { deleted: params.templateId } };
  });

  registerLensAction("board", "card-create-from-template", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const template = (board.templates || []).find((t) => t.id === params.templateId);
    if (!template) return { ok: false, error: "template not found" };
    const askedForColumn = params.columnId != null && String(params.columnId) !== "";
    const found = board.columns.find((c) => c.id === params.columnId && !c.archived);
    if (askedForColumn && !found) return { ok: false, error: "column not found" };
    const column = found || board.columns.find((c) => !c.archived) || board.columns[0];
    if (!column) return { ok: false, error: "board has no columns" };
    const card = {
      id: bdId("crd"),
      columnId: column.id,
      title: bdClean(params.title, 240) || template.title,
      description: template.description || "",
      labels: [...(template.labels || [])],
      dueDate: null,
      assignee: null,
      checklist: (template.checklist || []).map((i) => ({ id: bdId("ci"), text: i.text, done: false })),
      customFields: { ...(template.customFields || {}) },
      position: board.cards.filter((c) => c.columnId === column.id).length,
      createdAt: bdNow(),
    };
    board.cards.push(card);
    pushActivity(card, `created from template ${template.name}`);
    saveBoard();
    return { ok: true, result: { card } };
  });

  // ── Due-date reminders: honest computed read across the user's boards ──
  // Overdue + due-within-the-window cards (archived excluded). This is the
  // data a notification would carry; dispatch lives in the server heartbeat,
  // not in a lens macro.
  registerLensAction("board", "due-reminders", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const withinHours = Math.max(1, Math.min(24 * 30, Number(params.withinHours) || 48));
    const now = Date.now();
    const horizon = now + withinHours * 3600 * 1000;
    const reminders = [];
    for (const board of boardsFor(s, bdActor(ctx))) {
      for (const card of board.cards) {
        if (card.archived || !card.dueDate) continue;
        const t = new Date(card.dueDate).getTime();
        if (!Number.isFinite(t) || t > horizon) continue;
        const col = board.columns.find((c) => c.id === card.columnId);
        reminders.push({
          boardId: board.id, boardName: board.name,
          cardId: card.id, title: card.title,
          columnName: col ? col.name : null,
          dueDate: card.dueDate, overdue: t < now,
        });
      }
    }
    reminders.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    return {
      ok: true,
      result: {
        reminders,
        overdueCount: reminders.filter((r) => r.overdue).length,
        dueSoonCount: reminders.filter((r) => !r.overdue).length,
        withinHours,
      },
    };
  });

  // ── Who's here, what happened, what's mine ─────────────────────────

  /** "I'm looking at this board": returns everyone seen in the last 45 s. */
  registerLensAction("board", "board-presence", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const me = bdActor(ctx), now = Date.now();
    if (!(board.viewers instanceof Map)) Object.defineProperty(board, "viewers", { value: new Map(), enumerable: false, writable: true });
    board.viewers.set(me, now);
    const here = [...board.viewers].filter(([uid, t]) => now - t < 45_000 && roleOn(board, uid)).map(([uid]) => ({ userId: uid, name: nameOf(uid), you: uid === me }));
    return { ok: true, result: { here } };
  });

  registerLensAction("board", "board-activity", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const board = findBoard(s, ctx, params.boardId);
    if (!board) return { ok: false, error: "board not found" };
    const limit = Math.max(1, Math.min(300, Number(params.limit) || 60));
    return { ok: true, result: { activity: (board.activity || []).slice(0, limit) } };
  });

  /**
   * My tasks: across every board you can open, the cards assigned to you
   * (and the unassigned ones you made), grouped by when they're due. A card
   * in a board's last column counts as done.
   */
  registerLensAction("board", "my-tasks", (ctx, _a, params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = bdActor(ctx);
    if (!me || me === "anon") return { ok: false, error: "sign in to see your tasks" };
    const includeDone = !!params.includeDone;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = 86400000, t0 = today.getTime();
    const tasks = [];
    for (const board of boardsFor(s, me)) {
      const live = board.columns.filter((c) => !c.archived);
      const last = live[live.length - 1];
      for (const card of board.cards) {
        if (card.archived) continue;
        const mine = card.assignee === me || (!card.assignee && card.createdBy === me);
        if (!mine) continue;
        const col = board.columns.find((c) => c.id === card.columnId);
        const done = !!last && card.columnId === last.id && live.length > 1;
        if (done && !includeDone) continue;
        const due = card.dueDate ? Date.parse(card.dueDate) : NaN;
        const bucket = done ? "done" : !Number.isFinite(due) ? "later" : due < t0 ? "overdue" : due < t0 + day ? "today" : due < t0 + 7 * day ? "week" : "later";
        tasks.push({
          boardId: board.id, boardName: board.name, cardId: card.id, title: card.title, columnId: card.columnId, columnName: col ? col.name : null,
          dueDate: card.dueDate || null, labels: card.labels || [], assignedToMe: card.assignee === me, done, bucket,
          checklist: { done: (card.checklist || []).filter((i) => i.done).length, total: (card.checklist || []).length },
        });
      }
    }
    const order = { overdue: 0, today: 1, week: 2, later: 3, done: 4 };
    tasks.sort((a, b) => order[a.bucket] - order[b.bucket] || String(a.dueDate || "9999").localeCompare(String(b.dueDate || "9999")));
    const counts = Object.fromEntries(Object.keys(order).map((k) => [k, tasks.filter((t) => t.bucket === k).length]));
    const legacy = legacyTasks(me).length;
    return { ok: true, result: { tasks, counts, legacyTasks: legacy } };
  });

  // The old personal task list kept each task as a lens artifact of its own.
  function legacyTasks(userId) {
    const arts = globalThis._concordSTATE?.lensArtifacts;
    if (!arts || typeof arts.values !== "function") return [];
    const out = [];
    for (const a of arts.values()) {
      if (!a || a.domain !== "board" || (a.type && a.type !== "task")) continue;
      if ((a.ownerId || a.createdBy) !== userId) continue;
      if (a.data?.importedTo) continue;
      out.push(a);
    }
    return out;
  }
  const LEGACY_COLUMNS = [["backlog", "Backlog"], ["todo", "To do"], ["in_progress", "In progress"], ["in_review", "In review"], ["testing", "Testing"], ["done", "Done"]];

  /** Bring the old personal tasks onto a real board, once. */
  registerLensAction("board", "import-tasks", (ctx, _a, _params = {}) => {
    const s = getBoardState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const me = bdActor(ctx);
    if (!me || me === "anon") return { ok: false, error: "sign in to import your tasks" };
    const old = legacyTasks(me);
    if (!old.length) return { ok: false, error: "there are no older tasks to bring in" };
    const used = new Set(old.map((a) => a.data?.status || "backlog"));
    const cols = LEGACY_COLUMNS.filter(([id]) => used.has(id) || id === "todo" || id === "done").map(([key, name]) => ({ key, id: bdId("col"), name }));
    const board = { id: bdId("bd"), name: "My tasks", columns: cols.map(({ id, name }) => ({ id, name })), cards: [], ownerId: me, collaborators: [], activity: [], createdAt: bdNow() };
    const colFor = (status) => (cols.find((c) => c.key === status) || cols.find((c) => c.key === "todo")).id;
    for (const a of old) {
      const d = a.data || {};
      const columnId = colFor(d.status || "backlog");
      const due = cleanDue(d.dueDate);
      const labels = [d.priority && d.priority !== "medium" ? `${d.priority} priority` : null, d.label || null, ...(Array.isArray(d.tags) ? d.tags : [])].filter(Boolean).map((l) => bdClean(l, 30)).slice(0, 6);
      board.cards.push({
        id: bdId("crd"), columnId, title: bdClean(d.title || a.title || "Untitled", 240), description: bdClean(d.description, 4000), labels,
        dueDate: due || null, assignee: null, createdBy: me,
        checklist: (Array.isArray(d.subtasks) ? d.subtasks : []).slice(0, 100).map((t) => ({ id: bdId("ci"), text: bdClean(t?.title || t?.text, 200), done: !!(t?.done || t?.completed) })).filter((i) => i.text),
        comments: (Array.isArray(d.comments) ? d.comments : []).slice(0, 100).map((c) => ({ id: bdId("cmt"), author: me, authorName: nameOf(me), text: bdClean(c?.text || c?.content, 2000), at: c?.timestamp || bdNow() })).filter((c) => c.text),
        position: board.cards.filter((c) => c.columnId === columnId).length,
        transitions: [{ columnId, at: bdNow() }], createdAt: a.createdAt || bdNow(), activity: [{ id: bdId("act"), action: "brought in from your old task list", at: bdNow(), by: me, byName: nameOf(me) }],
      });
      a.data = { ...(a.data || {}), importedTo: board.id };
    }
    bdList(s, me).push(board);
    saveBoard();
    return { ok: true, result: { boardId: board.id, imported: board.cards.length, columns: board.columns.map((c) => c.name) } };
  });
}
