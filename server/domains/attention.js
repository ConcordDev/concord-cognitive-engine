// server/domains/attention.js
// Domain actions for attention/focus management: focus scoring, priority matrix, attention budgeting.

export default function registerAttentionActions(registerLensAction) {
  /**
   * focusScore
   * Calculate focus quality from activity data — session duration, interruption
   * frequency, context-switching cost, deep work ratio.
   * artifact.data.sessions: [{ id, startTime, endTime, taskId, interruptions?: number, deepWork?: boolean }]
   * params.deepWorkMinMinutes — minimum uninterrupted minutes to count as deep work (default 25)
   * params.contextSwitchCostMinutes — estimated cost of each context switch in minutes (default 15)
   */
  registerLensAction("attention", "focusScore", (ctx, artifact, params) => {
    const sessions = artifact.data.sessions || [];
    if (sessions.length === 0) {
      return { ok: true, result: { message: "No session data provided." } };
    }

    const deepWorkMinMinutes = params.deepWorkMinMinutes || 25;
    const contextSwitchCostMinutes = params.contextSwitchCostMinutes || 15;

    // Process sessions
    const processed = sessions.map(s => {
      const start = new Date(s.startTime).getTime();
      const end = new Date(s.endTime).getTime();
      const durationMinutes = (end - start) / 60000;
      const interruptions = s.interruptions || 0;
      const isDeepWork = s.deepWork !== undefined ? s.deepWork : (durationMinutes >= deepWorkMinMinutes && interruptions === 0);

      return {
        id: s.id,
        taskId: s.taskId,
        durationMinutes: Math.round(durationMinutes * 100) / 100,
        interruptions,
        isDeepWork,
        interruptionRate: durationMinutes > 0 ? Math.round((interruptions / (durationMinutes / 60)) * 100) / 100 : 0,
      };
    }).filter(s => s.durationMinutes > 0);

    const totalMinutes = processed.reduce((s, p) => s + p.durationMinutes, 0);
    const totalInterruptions = processed.reduce((s, p) => s + p.interruptions, 0);
    const deepWorkSessions = processed.filter(p => p.isDeepWork);
    const deepWorkMinutes = deepWorkSessions.reduce((s, p) => s + p.durationMinutes, 0);
    const deepWorkRatio = totalMinutes > 0 ? Math.round((deepWorkMinutes / totalMinutes) * 10000) / 100 : 0;

    // Context switching: count unique task transitions
    const taskSequence = processed.map(p => p.taskId);
    let contextSwitches = 0;
    for (let i = 1; i < taskSequence.length; i++) {
      if (taskSequence[i] !== taskSequence[i - 1]) contextSwitches++;
    }
    const contextSwitchCostTotal = Math.round(contextSwitches * contextSwitchCostMinutes * 100) / 100;
    const effectiveMinutes = Math.max(0, totalMinutes - contextSwitchCostTotal);

    // Average session duration
    const avgSessionDuration = processed.length > 0
      ? Math.round((totalMinutes / processed.length) * 100) / 100
      : 0;

    // Longest uninterrupted streak
    let longestStreak = 0;
    let currentStreak = 0;
    for (const s of processed) {
      if (s.interruptions === 0) {
        currentStreak += s.durationMinutes;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    // Focus score: 0-100 composite
    // Components: deep work ratio (40%), interruption frequency (25%),
    // context switching (20%), session length (15%)
    const interruptionScore = totalMinutes > 0
      ? Math.max(0, 100 - (totalInterruptions / (totalMinutes / 60)) * 10)
      : 100;
    const switchScore = processed.length > 1
      ? Math.max(0, 100 - (contextSwitches / (processed.length - 1)) * 100)
      : 100;
    const sessionLengthScore = Math.min(100, (avgSessionDuration / 60) * 100);

    const focusScore = Math.round((
      deepWorkRatio * 0.4 +
      interruptionScore * 0.25 +
      switchScore * 0.2 +
      sessionLengthScore * 0.15
    ) * 100) / 100;

    const focusLevel = focusScore >= 80 ? "excellent"
      : focusScore >= 60 ? "good"
      : focusScore >= 40 ? "moderate"
      : focusScore >= 20 ? "poor"
      : "very-poor";

    // Per-task breakdown
    const taskBreakdown = {};
    for (const s of processed) {
      if (!taskBreakdown[s.taskId]) {
        taskBreakdown[s.taskId] = { totalMinutes: 0, sessionCount: 0, interruptions: 0, deepWorkMinutes: 0 };
      }
      taskBreakdown[s.taskId].totalMinutes += s.durationMinutes;
      taskBreakdown[s.taskId].sessionCount++;
      taskBreakdown[s.taskId].interruptions += s.interruptions;
      if (s.isDeepWork) taskBreakdown[s.taskId].deepWorkMinutes += s.durationMinutes;
    }

    for (const taskId of Object.keys(taskBreakdown)) {
      const t = taskBreakdown[taskId];
      t.totalMinutes = Math.round(t.totalMinutes * 100) / 100;
      t.deepWorkMinutes = Math.round(t.deepWorkMinutes * 100) / 100;
      t.deepWorkRatio = t.totalMinutes > 0 ? Math.round((t.deepWorkMinutes / t.totalMinutes) * 10000) / 100 : 0;
    }

    const result = {
      analyzedAt: new Date().toISOString(),
      sessionCount: processed.length,
      totalMinutes: Math.round(totalMinutes * 100) / 100,
      effectiveMinutes: Math.round(effectiveMinutes * 100) / 100,
      focusScore,
      focusLevel,
      deepWork: {
        sessions: deepWorkSessions.length,
        minutes: Math.round(deepWorkMinutes * 100) / 100,
        ratio: deepWorkRatio,
      },
      interruptions: {
        total: totalInterruptions,
        perHour: totalMinutes > 0 ? Math.round((totalInterruptions / (totalMinutes / 60)) * 100) / 100 : 0,
      },
      contextSwitching: {
        switches: contextSwitches,
        costMinutes: contextSwitchCostTotal,
        uniqueTasks: new Set(taskSequence).size,
      },
      avgSessionDuration,
      longestUninterruptedStreak: Math.round(longestStreak * 100) / 100,
      componentScores: {
        deepWorkScore: deepWorkRatio,
        interruptionScore: Math.round(interruptionScore * 100) / 100,
        switchScore: Math.round(switchScore * 100) / 100,
        sessionLengthScore: Math.round(sessionLengthScore * 100) / 100,
      },
      taskBreakdown,
    };

    artifact.data.focusScore = result;
    return { ok: true, result };
  });

  /**
   * priorityMatrix
   * Eisenhower matrix + weighted scoring — urgency/importance with diminishing
   * returns curves, compute optimal task ordering.
   * artifact.data.tasks: [{ id, name, urgency: 0-10, importance: 0-10, effort?: hours, deadline?, dependencies?: [taskId] }]
   * params.urgencyDecay — diminishing returns exponent for urgency (default 0.7)
   * params.importanceDecay — diminishing returns exponent for importance (default 0.8)
   */
  registerLensAction("attention", "priorityMatrix", (ctx, artifact, params) => {
    const tasks = artifact.data.tasks || [];
    if (tasks.length === 0) {
      return { ok: true, result: { message: "No tasks provided for prioritization." } };
    }

    const urgencyDecay = params.urgencyDecay || 0.7;
    const importanceDecay = params.importanceDecay || 0.8;
    const now = new Date();

    // Apply diminishing returns: f(x) = x^decay (normalized 0-1)
    function diminishing(value, decay) {
      const normalized = Math.max(0, Math.min(1, value / 10));
      return Math.pow(normalized, decay);
    }

    const scored = tasks.map(task => {
      let urgency = parseFloat(task.urgency) || 0;
      const importance = parseFloat(task.importance) || 0;
      const effort = parseFloat(task.effort) || 1;

      // Boost urgency based on deadline proximity
      if (task.deadline) {
        const deadlineDate = new Date(task.deadline);
        const hoursUntilDeadline = (deadlineDate - now) / 3600000;
        if (hoursUntilDeadline < 0) {
          urgency = 10; // Overdue
        } else if (hoursUntilDeadline < 24) {
          urgency = Math.max(urgency, 9);
        } else if (hoursUntilDeadline < 72) {
          urgency = Math.max(urgency, 7);
        }
      }

      const urgencyScore = diminishing(urgency, urgencyDecay);
      const importanceScore = diminishing(importance, importanceDecay);

      // Eisenhower quadrant
      let quadrant;
      if (urgency >= 5 && importance >= 5) quadrant = "do-first";
      else if (urgency < 5 && importance >= 5) quadrant = "schedule";
      else if (urgency >= 5 && importance < 5) quadrant = "delegate";
      else quadrant = "eliminate";

      // Priority score: weighted combination with effort penalty
      const effortPenalty = 1 / (1 + Math.log2(effort));
      const priorityScore = Math.round(
        (urgencyScore * 0.45 + importanceScore * 0.55) * effortPenalty * 10000
      ) / 100;

      return {
        id: task.id,
        name: task.name,
        rawUrgency: task.urgency,
        adjustedUrgency: Math.round(urgency * 100) / 100,
        rawImportance: task.importance,
        urgencyScore: Math.round(urgencyScore * 10000) / 10000,
        importanceScore: Math.round(importanceScore * 10000) / 10000,
        effort,
        effortPenalty: Math.round(effortPenalty * 10000) / 10000,
        quadrant,
        priorityScore,
        deadline: task.deadline || null,
        dependencies: task.dependencies || [],
      };
    });

    // Topological sort respecting dependencies for optimal ordering
    const taskMap = {};
    for (const t of scored) taskMap[t.id] = t;

    // Simple topological sort with priority tie-breaking
    const order = [];
    const visited = new Set();
    const visiting = new Set();

    function visit(taskId) {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) return; // Cycle detected, skip
      visiting.add(taskId);

      const task = taskMap[taskId];
      if (task) {
        for (const dep of task.dependencies) {
          if (taskMap[dep]) visit(dep);
        }
      }
      visiting.delete(taskId);
      visited.add(taskId);
      order.push(taskId);
    }

    // Visit in priority order (highest first)
    const sortedByPriority = [...scored].sort((a, b) => b.priorityScore - a.priorityScore);
    for (const task of sortedByPriority) {
      visit(task.id);
    }

    // Quadrant summary
    const quadrants = {
      "do-first": scored.filter(t => t.quadrant === "do-first").sort((a, b) => b.priorityScore - a.priorityScore),
      "schedule": scored.filter(t => t.quadrant === "schedule").sort((a, b) => b.priorityScore - a.priorityScore),
      "delegate": scored.filter(t => t.quadrant === "delegate").sort((a, b) => b.priorityScore - a.priorityScore),
      "eliminate": scored.filter(t => t.quadrant === "eliminate").sort((a, b) => b.priorityScore - a.priorityScore),
    };

    const result = {
      analyzedAt: new Date().toISOString(),
      taskCount: tasks.length,
      optimalOrder: order.map(id => ({ id, name: taskMap[id]?.name, priorityScore: taskMap[id]?.priorityScore })),
      quadrants: {
        "do-first": { count: quadrants["do-first"].length, tasks: quadrants["do-first"] },
        "schedule": { count: quadrants["schedule"].length, tasks: quadrants["schedule"] },
        "delegate": { count: quadrants["delegate"].length, tasks: quadrants["delegate"] },
        "eliminate": { count: quadrants["eliminate"].length, tasks: quadrants["eliminate"] },
      },
      allTasks: sortedByPriority,
      decayParams: { urgencyDecay, importanceDecay },
    };

    artifact.data.priorityMatrix = result;
    return { ok: true, result };
  });

  /**
   * attentionBudget
   * Budget attention across tasks — distribute cognitive load, predict fatigue
   * using logarithmic decay model.
   * artifact.data.tasks: [{ id, name, cognitiveLoad: 1-10, estimatedMinutes, priority?: 1-10 }]
   * params.totalAvailableMinutes — total time budget (default 480, i.e., 8 hours)
   * params.fatigueHalfLife — minutes until cognitive capacity halves (default 90)
   * params.breakDurationMinutes — break duration between tasks (default 10)
   */
  registerLensAction("attention", "attentionBudget", (ctx, artifact, params) => {
    const tasks = artifact.data.tasks || [];
    if (tasks.length === 0) {
      return { ok: true, result: { message: "No tasks provided for attention budgeting." } };
    }

    const totalAvailableMinutes = params.totalAvailableMinutes || 480;
    const fatigueHalfLife = params.fatigueHalfLife || 90;
    const breakDuration = params.breakDurationMinutes || 10;

    // Logarithmic fatigue model: capacity = 1 / (1 + ln(1 + t / halfLife))
    function fatigueMultiplier(elapsedMinutes) {
      return 1 / (1 + Math.log(1 + elapsedMinutes / fatigueHalfLife));
    }

    // Sort tasks by priority * cognitiveLoad (high cognitive tasks first when fresh)
    const scored = tasks.map(t => ({
      id: t.id,
      name: t.name,
      cognitiveLoad: Math.max(1, Math.min(10, t.cognitiveLoad || 5)),
      estimatedMinutes: parseFloat(t.estimatedMinutes) || 30,
      priority: parseFloat(t.priority) || 5,
      // High cognitive + high priority tasks should be scheduled when fresh
      schedulingScore: (parseFloat(t.priority) || 5) * (t.cognitiveLoad || 5),
    })).sort((a, b) => b.schedulingScore - a.schedulingScore);

    // Allocate time slots with fatigue tracking
    let elapsedMinutes = 0;
    const schedule = [];
    let totalAllocated = 0;
    const unscheduled = [];

    for (const task of scored) {
      if (elapsedMinutes >= totalAvailableMinutes) {
        unscheduled.push({ id: task.id, name: task.name, reason: "no-time-remaining" });
        continue;
      }

      const fatigue = fatigueMultiplier(elapsedMinutes);
      // Actual time needed increases as fatigue grows (inverse of capacity)
      const adjustedDuration = Math.round((task.estimatedMinutes / fatigue) * 100) / 100;

      // Check if task fits in remaining budget
      const remainingMinutes = totalAvailableMinutes - elapsedMinutes;
      if (adjustedDuration > remainingMinutes) {
        // Partial allocation
        const partialMinutes = remainingMinutes;
        const completionPct = Math.round((partialMinutes / adjustedDuration) * 10000) / 100;
        schedule.push({
          id: task.id,
          name: task.name,
          startMinute: Math.round(elapsedMinutes),
          allocatedMinutes: Math.round(partialMinutes * 100) / 100,
          estimatedMinutes: task.estimatedMinutes,
          adjustedDuration: Math.round(adjustedDuration * 100) / 100,
          fatigueMultiplier: Math.round(fatigue * 10000) / 10000,
          cognitiveLoad: task.cognitiveLoad,
          completionPct,
          partial: true,
        });
        totalAllocated += partialMinutes;
        elapsedMinutes += partialMinutes;
        break;
      }

      schedule.push({
        id: task.id,
        name: task.name,
        startMinute: Math.round(elapsedMinutes),
        allocatedMinutes: Math.round(adjustedDuration * 100) / 100,
        estimatedMinutes: task.estimatedMinutes,
        adjustedDuration: Math.round(adjustedDuration * 100) / 100,
        fatigueMultiplier: Math.round(fatigue * 10000) / 10000,
        cognitiveLoad: task.cognitiveLoad,
        completionPct: 100,
        partial: false,
      });

      totalAllocated += adjustedDuration;
      elapsedMinutes += adjustedDuration;

      // Add break between tasks
      if (elapsedMinutes < totalAvailableMinutes) {
        elapsedMinutes += breakDuration;
      }
    }

    // Fatigue curve: capacity at key intervals
    const fatigueCurve = [];
    for (let t = 0; t <= totalAvailableMinutes; t += 30) {
      fatigueCurve.push({
        minute: t,
        capacity: Math.round(fatigueMultiplier(t) * 10000) / 10000,
        label: `${Math.floor(t / 60)}h${t % 60 > 0 ? (t % 60) + "m" : ""}`,
      });
    }

    // Cognitive load distribution
    const totalCogLoad = schedule.reduce((s, t) => s + t.cognitiveLoad * t.allocatedMinutes, 0);
    const avgCogLoad = totalAllocated > 0
      ? Math.round((totalCogLoad / totalAllocated) * 100) / 100
      : 0;

    // Efficiency: ratio of base estimated time to fatigue-adjusted time
    const baseTotal = schedule.reduce((s, t) => s + t.estimatedMinutes, 0);
    const efficiency = baseTotal > 0
      ? Math.round((baseTotal / totalAllocated) * 10000) / 100
      : 100;

    const result = {
      analyzedAt: new Date().toISOString(),
      totalTasks: tasks.length,
      scheduledTasks: schedule.length,
      unscheduledTasks: unscheduled,
      totalAvailableMinutes,
      totalAllocatedMinutes: Math.round(totalAllocated * 100) / 100,
      remainingMinutes: Math.round(Math.max(0, totalAvailableMinutes - elapsedMinutes) * 100) / 100,
      efficiency,
      avgCognitiveLoad: avgCogLoad,
      schedule,
      fatigueCurve,
      fatigueModel: {
        halfLife: fatigueHalfLife,
        breakDuration,
        formula: "capacity = 1 / (1 + ln(1 + elapsed / halfLife))",
      },
    };

    artifact.data.attentionBudget = result;
    return { ok: true, result };
  });

  // ───────────────────────────────────────────────────────────────────
  // Sunsama / Motion–class focus-tool substrate — per-user, STATE-backed.
  //   focusSessions:  completed Pomodoro / deep-work sessions
  //   pomodoro:       the single live timer per user
  //   plannerDays:    timeboxed day plans keyed by date
  //   distractions:   interruption log
  //   focusMode:      do-not-disturb toggle + state
  //   calendarBlocks: reserved focus blocks
  // All data is real — derived only from what the user records.
  // ───────────────────────────────────────────────────────────────────

  function getFocusState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.attentionLens) STATE.attentionLens = {};
    const s = STATE.attentionLens;
    if (!(s.focusSessions instanceof Map)) s.focusSessions = new Map();   // userId -> Array<session>
    if (!(s.pomodoro instanceof Map)) s.pomodoro = new Map();             // userId -> timer
    if (!(s.plannerDays instanceof Map)) s.plannerDays = new Map();       // userId -> { date -> day }
    if (!(s.distractions instanceof Map)) s.distractions = new Map();     // userId -> Array<distraction>
    if (!(s.focusMode instanceof Map)) s.focusMode = new Map();           // userId -> mode
    if (!(s.calendarBlocks instanceof Map)) s.calendarBlocks = new Map(); // userId -> Array<block>
    return s;
  }
  function persistFocusState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const fId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fNow = () => new Date().toISOString();
  const fActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const fClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const fNum = (v, dflt = 0) => { const n = Number(v); return Number.isFinite(n) ? n : dflt; };
  const fList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const fDateKey = (d) => {
    const dt = d ? new Date(d) : new Date();
    return Number.isNaN(dt.getTime()) ? new Date().toISOString().slice(0, 10) : dt.toISOString().slice(0, 10);
  };

  // ── Feature: Focus-session timer (Pomodoro) with start/break/stats ──

  /**
   * pomodoroStart — begin a focus or break interval.
   * params: { mode: 'focus'|'short-break'|'long-break', durationMinutes?, taskId?, taskName? }
   */
  registerLensAction("attention", "pomodoroStart", (ctx, artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const mode = ["focus", "short-break", "long-break"].includes(params?.mode) ? params.mode : "focus";
      const defaults = { focus: 25, "short-break": 5, "long-break": 15 };
      const durationMinutes = Math.max(1, Math.min(180, fNum(params?.durationMinutes, defaults[mode])));
      const startedAt = Date.now();
      const timer = {
        id: fId("pom"),
        mode,
        durationMinutes,
        startedAt,
        endsAt: startedAt + durationMinutes * 60000,
        taskId: params?.taskId ? fClean(params.taskId, 80) : null,
        taskName: params?.taskName ? fClean(params.taskName, 160) : null,
        status: "running",
        interruptions: 0,
      };
      s.pomodoro.set(userId, timer);
      persistFocusState();
      return { ok: true, result: { timer } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pomodoroStatus — current live timer with remaining time computed server-side.
   */
  registerLensAction("attention", "pomodoroStatus", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const timer = s.pomodoro.get(userId) || null;
      if (!timer) return { ok: true, result: { timer: null, remainingSeconds: 0 } };
      const remainingMs = Math.max(0, timer.endsAt - Date.now());
      const elapsedMs = Math.min(timer.durationMinutes * 60000, Date.now() - timer.startedAt);
      return {
        ok: true,
        result: {
          timer,
          remainingSeconds: Math.round(remainingMs / 1000),
          elapsedSeconds: Math.round(elapsedMs / 1000),
          expired: remainingMs <= 0 && timer.status === "running",
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pomodoroInterrupt — record an interruption against the live timer.
   */
  registerLensAction("attention", "pomodoroInterrupt", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const timer = s.pomodoro.get(userId);
      if (!timer) return { ok: false, error: "no_active_timer" };
      timer.interruptions += 1;
      persistFocusState();
      return { ok: true, result: { timer } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pomodoroComplete — finish/abandon a timer; logs a focus-session if it was a focus interval.
   * params: { abandoned?: boolean, energy?: 'low'|'medium'|'high', mood?, notes? }
   */
  registerLensAction("attention", "pomodoroComplete", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const timer = s.pomodoro.get(userId);
      if (!timer) return { ok: false, error: "no_active_timer" };
      const endedAt = Date.now();
      const actualMinutes = Math.round(((endedAt - timer.startedAt) / 60000) * 100) / 100;
      const abandoned = params?.abandoned === true;
      let session = null;
      if (timer.mode === "focus" && actualMinutes > 0) {
        session = {
          id: fId("fs"),
          taskId: timer.taskId,
          taskName: timer.taskName,
          startedAt: new Date(timer.startedAt).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          plannedMinutes: timer.durationMinutes,
          actualMinutes,
          interruptions: timer.interruptions,
          completed: !abandoned && actualMinutes >= timer.durationMinutes * 0.9,
          deepWork: !abandoned && timer.interruptions === 0 && actualMinutes >= 20,
          energy: ["low", "medium", "high"].includes(params?.energy) ? params.energy : null,
          mood: params?.mood ? fClean(params.mood, 40) : null,
          notes: params?.notes ? fClean(params.notes, 400) : null,
        };
        fList(s.focusSessions, userId).unshift(session);
        if (s.focusSessions.get(userId).length > 1000) s.focusSessions.get(userId).length = 1000;
      }
      s.pomodoro.delete(userId);
      persistFocusState();
      return { ok: true, result: { session, abandoned, actualMinutes } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * pomodoroStats — aggregate Pomodoro performance for the user.
   */
  registerLensAction("attention", "pomodoroStats", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const sessions = s.focusSessions.get(userId) || [];
      const todayKey = fDateKey();
      const today = sessions.filter((x) => fDateKey(x.startedAt) === todayKey);
      const totalMinutes = sessions.reduce((a, x) => a + x.actualMinutes, 0);
      const completed = sessions.filter((x) => x.completed).length;
      const deepWork = sessions.filter((x) => x.deepWork).length;
      const interruptions = sessions.reduce((a, x) => a + x.interruptions, 0);
      return {
        ok: true,
        result: {
          totalSessions: sessions.length,
          completedSessions: completed,
          deepWorkSessions: deepWork,
          totalFocusMinutes: Math.round(totalMinutes * 100) / 100,
          totalFocusHours: Math.round((totalMinutes / 60) * 100) / 100,
          totalInterruptions: interruptions,
          completionRate: sessions.length ? Math.round((completed / sessions.length) * 1000) / 10 : 0,
          today: {
            sessions: today.length,
            minutes: Math.round(today.reduce((a, x) => a + x.actualMinutes, 0) * 100) / 100,
            deepWork: today.filter((x) => x.deepWork).length,
          },
          recentSessions: sessions.slice(0, 12),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Daily attention planner — timeboxed day ──

  /**
   * plannerGet — fetch (or initialise) the timeboxed plan for a given date.
   * params: { date? }
   */
  registerLensAction("attention", "plannerGet", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const date = fDateKey(params?.date);
      if (!s.plannerDays.has(userId)) s.plannerDays.set(userId, {});
      const days = s.plannerDays.get(userId);
      if (!days[date]) days[date] = { date, dayStartMinute: 540, dayEndMinute: 1080, tasks: [] };
      const day = days[date];
      const plannedMinutes = day.tasks.reduce((a, t) => a + (t.durationMinutes || 0), 0);
      const capacityMinutes = day.dayEndMinute - day.dayStartMinute;
      return {
        ok: true,
        result: {
          day,
          plannedMinutes,
          capacityMinutes,
          remainingMinutes: capacityMinutes - plannedMinutes,
          overbooked: plannedMinutes > capacityMinutes,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * plannerAddTask — add a task into the day plan at a start minute.
   * params: { date?, name, startMinute?, durationMinutes?, priority?, color? }
   */
  registerLensAction("attention", "plannerAddTask", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const name = fClean(params?.name, 160);
      if (!name) return { ok: false, error: "name_required" };
      const date = fDateKey(params?.date);
      if (!s.plannerDays.has(userId)) s.plannerDays.set(userId, {});
      const days = s.plannerDays.get(userId);
      if (!days[date]) days[date] = { date, dayStartMinute: 540, dayEndMinute: 1080, tasks: [] };
      const day = days[date];
      const task = {
        id: fId("pt"),
        name,
        startMinute: Math.max(0, Math.min(1439, fNum(params?.startMinute, day.dayStartMinute))),
        durationMinutes: Math.max(5, Math.min(720, fNum(params?.durationMinutes, 60))),
        priority: Math.max(0, Math.min(1, fNum(params?.priority, 0.5))),
        color: params?.color ? fClean(params.color, 24) : "#6366f1",
        done: false,
        createdAt: fNow(),
      };
      day.tasks.push(task);
      day.tasks.sort((a, b) => a.startMinute - b.startMinute);
      persistFocusState();
      return { ok: true, result: { task, day } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * plannerMoveTask — reschedule (drag) a task to a new start minute / duration / done state.
   * params: { date?, taskId, startMinute?, durationMinutes?, done? }
   */
  registerLensAction("attention", "plannerMoveTask", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const date = fDateKey(params?.date);
      const days = s.plannerDays.get(userId) || {};
      const day = days[date];
      if (!day) return { ok: false, error: "day_not_found" };
      const task = day.tasks.find((t) => t.id === params?.taskId);
      if (!task) return { ok: false, error: "task_not_found" };
      if (params?.startMinute !== undefined) task.startMinute = Math.max(0, Math.min(1439, fNum(params.startMinute, task.startMinute)));
      if (params?.durationMinutes !== undefined) task.durationMinutes = Math.max(5, Math.min(720, fNum(params.durationMinutes, task.durationMinutes)));
      if (params?.done !== undefined) task.done = params.done === true;
      day.tasks.sort((a, b) => a.startMinute - b.startMinute);
      persistFocusState();
      return { ok: true, result: { task, day } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * plannerRemoveTask — drop a task from the day plan.
   * params: { date?, taskId }
   */
  registerLensAction("attention", "plannerRemoveTask", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const date = fDateKey(params?.date);
      const days = s.plannerDays.get(userId) || {};
      const day = days[date];
      if (!day) return { ok: false, error: "day_not_found" };
      const before = day.tasks.length;
      day.tasks = day.tasks.filter((t) => t.id !== params?.taskId);
      if (day.tasks.length === before) return { ok: false, error: "task_not_found" };
      persistFocusState();
      return { ok: true, result: { day, removed: true } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Distraction log / interruption tracking ──

  /**
   * distractionLog — record an interruption event.
   * params: { source, kind?, durationMinutes?, note? }
   */
  registerLensAction("attention", "distractionLog", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const source = fClean(params?.source, 120);
      if (!source) return { ok: false, error: "source_required" };
      const kinds = ["notification", "person", "self", "meeting", "other"];
      const entry = {
        id: fId("dx"),
        source,
        kind: kinds.includes(params?.kind) ? params.kind : "other",
        durationMinutes: Math.max(0, Math.min(480, fNum(params?.durationMinutes, 0))),
        note: params?.note ? fClean(params.note, 300) : null,
        loggedAt: fNow(),
      };
      fList(s.distractions, userId).unshift(entry);
      if (s.distractions.get(userId).length > 2000) s.distractions.get(userId).length = 2000;
      persistFocusState();
      return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * distractionSummary — counts by source/kind plus a today figure.
   */
  registerLensAction("attention", "distractionSummary", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const all = s.distractions.get(userId) || [];
      const todayKey = fDateKey();
      const today = all.filter((d) => fDateKey(d.loggedAt) === todayKey);
      const bySource = {};
      const byKind = {};
      let lostMinutes = 0;
      for (const d of all) {
        bySource[d.source] = (bySource[d.source] || 0) + 1;
        byKind[d.kind] = (byKind[d.kind] || 0) + 1;
        lostMinutes += d.durationMinutes;
      }
      const topSources = Object.entries(bySource)
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8);
      return {
        ok: true,
        result: {
          total: all.length,
          todayCount: today.length,
          lostMinutes: Math.round(lostMinutes * 100) / 100,
          byKind,
          topSources,
          recent: all.slice(0, 20),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Focus analytics — deep-work hours per day/week trends ──

  /**
   * focusAnalytics — daily + weekly deep-work trends derived from logged sessions.
   * params: { days? } window length, default 14
   */
  registerLensAction("attention", "focusAnalytics", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const sessions = s.focusSessions.get(userId) || [];
      const distractions = s.distractions.get(userId) || [];
      const windowDays = Math.max(7, Math.min(90, fNum(params?.days, 14)));
      const daily = [];
      const dayMs = 86400000;
      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      for (let i = windowDays - 1; i >= 0; i--) {
        const d = new Date(startOfToday.getTime() - i * dayMs);
        const key = d.toISOString().slice(0, 10);
        const dayS = sessions.filter((x) => fDateKey(x.startedAt) === key);
        const dayD = distractions.filter((x) => fDateKey(x.loggedAt) === key);
        const focusMinutes = dayS.reduce((a, x) => a + x.actualMinutes, 0);
        const deepMinutes = dayS.filter((x) => x.deepWork).reduce((a, x) => a + x.actualMinutes, 0);
        daily.push({
          date: key,
          label: d.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
          focusHours: Math.round((focusMinutes / 60) * 100) / 100,
          deepWorkHours: Math.round((deepMinutes / 60) * 100) / 100,
          sessions: dayS.length,
          interruptions: dayD.length,
        });
      }
      // weekly aggregation
      const weekly = [];
      for (let i = 0; i < daily.length; i += 7) {
        const chunk = daily.slice(i, i + 7);
        if (!chunk.length) continue;
        weekly.push({
          weekStart: chunk[0].date,
          label: `Wk ${chunk[0].label}`,
          focusHours: Math.round(chunk.reduce((a, x) => a + x.focusHours, 0) * 100) / 100,
          deepWorkHours: Math.round(chunk.reduce((a, x) => a + x.deepWorkHours, 0) * 100) / 100,
          sessions: chunk.reduce((a, x) => a + x.sessions, 0),
        });
      }
      const totalFocus = daily.reduce((a, x) => a + x.focusHours, 0);
      const totalDeep = daily.reduce((a, x) => a + x.deepWorkHours, 0);
      const activeDays = daily.filter((x) => x.sessions > 0).length;
      // simple linear trend on deep-work hours (slope sign)
      const n = daily.length;
      const meanX = (n - 1) / 2;
      const meanY = totalDeep / n;
      let num = 0, den = 0;
      daily.forEach((d, idx) => { num += (idx - meanX) * (d.deepWorkHours - meanY); den += (idx - meanX) ** 2; });
      const slope = den ? num / den : 0;
      return {
        ok: true,
        result: {
          windowDays,
          daily,
          weekly,
          totals: {
            focusHours: Math.round(totalFocus * 100) / 100,
            deepWorkHours: Math.round(totalDeep * 100) / 100,
            avgFocusHoursPerActiveDay: activeDays ? Math.round((totalFocus / activeDays) * 100) / 100 : 0,
            activeDays,
          },
          deepWorkTrend: slope > 0.02 ? "improving" : slope < -0.02 ? "declining" : "steady",
          trendSlope: Math.round(slope * 1000) / 1000,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Do-not-disturb / focus-mode toggle ──

  /**
   * focusModeGet — current focus-mode (DND) state.
   */
  registerLensAction("attention", "focusModeGet", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const mode = s.focusMode.get(userId) || { enabled: false, label: null, mutedChannels: [], enabledAt: null };
      let activeMinutes = 0;
      if (mode.enabled && mode.enabledAt) {
        activeMinutes = Math.round(((Date.now() - new Date(mode.enabledAt).getTime()) / 60000) * 10) / 10;
      }
      return { ok: true, result: { mode, activeMinutes } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * focusModeSet — toggle do-not-disturb and choose which notification channels to mute.
   * params: { enabled, label?, mutedChannels?: string[] }
   */
  registerLensAction("attention", "focusModeSet", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const enabled = params?.enabled === true;
      const allChannels = ["chat", "world", "marketplace", "system", "email"];
      const mutedChannels = Array.isArray(params?.mutedChannels)
        ? params.mutedChannels.map((c) => fClean(c, 24)).filter((c) => allChannels.includes(c))
        : (enabled ? allChannels.slice() : []);
      const mode = {
        enabled,
        label: params?.label ? fClean(params.label, 80) : (enabled ? "Deep Work" : null),
        mutedChannels,
        enabledAt: enabled ? fNow() : null,
      };
      s.focusMode.set(userId, mode);
      persistFocusState();
      return { ok: true, result: { mode, availableChannels: allChannels } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Calendar integration — reserve focus blocks ──

  /**
   * calendarReserve — reserve a focus block on the calendar.
   * params: { date?, startMinute, durationMinutes, title?, taskId? }
   */
  registerLensAction("attention", "calendarReserve", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const date = fDateKey(params?.date);
      const startMinute = Math.max(0, Math.min(1439, fNum(params?.startMinute, 540)));
      const durationMinutes = Math.max(15, Math.min(480, fNum(params?.durationMinutes, 90)));
      const endMinute = Math.min(1440, startMinute + durationMinutes);
      const blocks = fList(s.calendarBlocks, userId);
      // conflict detection on same date
      const conflict = blocks.find((b) =>
        b.date === date && startMinute < (b.startMinute + b.durationMinutes) && endMinute > b.startMinute);
      if (conflict) return { ok: false, error: "time_conflict", result: { conflict } };
      const block = {
        id: fId("cb"),
        date,
        startMinute,
        durationMinutes,
        endMinute,
        title: params?.title ? fClean(params.title, 120) : "Focus Block",
        taskId: params?.taskId ? fClean(params.taskId, 80) : null,
        createdAt: fNow(),
      };
      blocks.push(block);
      blocks.sort((a, b) => (a.date.localeCompare(b.date)) || (a.startMinute - b.startMinute));
      persistFocusState();
      return { ok: true, result: { block } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * calendarBlocks — list reserved focus blocks, optionally filtered by date.
   * params: { date? }
   */
  registerLensAction("attention", "calendarBlocks", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      let blocks = s.calendarBlocks.get(userId) || [];
      if (params?.date) {
        const date = fDateKey(params.date);
        blocks = blocks.filter((b) => b.date === date);
      }
      const totalReservedMinutes = blocks.reduce((a, b) => a + b.durationMinutes, 0);
      return {
        ok: true,
        result: {
          blocks,
          count: blocks.length,
          totalReservedMinutes,
          totalReservedHours: Math.round((totalReservedMinutes / 60) * 100) / 100,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * calendarRelease — release a reserved focus block.
   * params: { blockId }
   */
  registerLensAction("attention", "calendarRelease", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const blocks = s.calendarBlocks.get(userId) || [];
      const before = blocks.length;
      const next = blocks.filter((b) => b.id !== params?.blockId);
      if (next.length === before) return { ok: false, error: "block_not_found" };
      s.calendarBlocks.set(userId, next);
      persistFocusState();
      return { ok: true, result: { released: true, remaining: next.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ── Feature: Energy/mood tagging per session — peak-hour discovery ──

  /**
   * energyTag — attach an energy/mood reading to a logged focus session.
   * params: { sessionId, energy: 'low'|'medium'|'high', mood?, notes? }
   */
  registerLensAction("attention", "energyTag", (ctx, _artifact, params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const sessions = s.focusSessions.get(userId) || [];
      const session = sessions.find((x) => x.id === params?.sessionId);
      if (!session) return { ok: false, error: "session_not_found" };
      if (!["low", "medium", "high"].includes(params?.energy)) return { ok: false, error: "invalid_energy" };
      session.energy = params.energy;
      if (params?.mood !== undefined) session.mood = params.mood ? fClean(params.mood, 40) : null;
      if (params?.notes !== undefined) session.notes = params.notes ? fClean(params.notes, 400) : null;
      persistFocusState();
      return { ok: true, result: { session } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  /**
   * peakHours — compute peak-performance hours-of-day from energy-tagged sessions.
   */
  registerLensAction("attention", "peakHours", (ctx, _artifact, _params) => {
    try {
      const s = getFocusState();
      const userId = fActor(ctx);
      const sessions = s.focusSessions.get(userId) || [];
      const energyWeight = { low: 0.33, medium: 0.66, high: 1 };
      const hourly = [];
      for (let h = 0; h < 24; h++) hourly.push({ hour: h, sessions: 0, deepWork: 0, focusMinutes: 0, energySum: 0, energyN: 0 });
      for (const x of sessions) {
        const h = new Date(x.startedAt).getHours();
        if (Number.isNaN(h)) continue;
        const slot = hourly[h];
        slot.sessions += 1;
        slot.focusMinutes += x.actualMinutes;
        if (x.deepWork) slot.deepWork += 1;
        if (x.energy && energyWeight[x.energy] !== undefined) {
          slot.energySum += energyWeight[x.energy];
          slot.energyN += 1;
        }
      }
      const scored = hourly.map((slot) => {
        const avgEnergy = slot.energyN ? slot.energySum / slot.energyN : 0;
        const deepRatio = slot.sessions ? slot.deepWork / slot.sessions : 0;
        // performance index combines energy, deep-work ratio, and volume
        const performanceIndex = Math.round(
          (avgEnergy * 0.5 + deepRatio * 0.35 + Math.min(1, slot.sessions / 5) * 0.15) * 1000) / 1000;
        return {
          hour: slot.hour,
          label: `${String(slot.hour).padStart(2, "0")}:00`,
          sessions: slot.sessions,
          deepWork: slot.deepWork,
          focusMinutes: Math.round(slot.focusMinutes * 100) / 100,
          avgEnergy: Math.round(avgEnergy * 1000) / 1000,
          performanceIndex,
        };
      });
      const ranked = [...scored].filter((x) => x.sessions > 0).sort((a, b) => b.performanceIndex - a.performanceIndex);
      const moodBreakdown = {};
      for (const x of sessions) if (x.mood) moodBreakdown[x.mood] = (moodBreakdown[x.mood] || 0) + 1;
      return {
        ok: true,
        result: {
          hourly: scored,
          peakHours: ranked.slice(0, 3),
          lowHours: ranked.slice(-3).reverse(),
          taggedSessions: sessions.filter((x) => x.energy).length,
          moodBreakdown,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
