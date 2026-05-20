// server/domains/education.js
// Domain actions for education: grading, attendance, progress tracking, schedule conflicts.

export default function registerEducationActions(registerLensAction) {
  /**
   * gradeCalculation
   * Compute weighted grades from assignment categories and scores.
   * artifact.data.students: [{ studentId, name, grades: [{ category, name, score, maxScore }] }]
   * artifact.data.weightScheme: [{ category, weight }] — weights should sum to 100
   * params.studentId — optional single student filter
   */
  registerLensAction("education", "gradeCalculation", (_ctx, artifact, params) => {
    const students = artifact.data.students || [];
    const weightScheme = artifact.data.weightScheme || params.weightScheme || [];
    const targetId = params.studentId || null;
    const gradeScale = params.gradeScale || [
      { min: 93, letter: "A" }, { min: 90, letter: "A-" },
      { min: 87, letter: "B+" }, { min: 83, letter: "B" }, { min: 80, letter: "B-" },
      { min: 77, letter: "C+" }, { min: 73, letter: "C" }, { min: 70, letter: "C-" },
      { min: 67, letter: "D+" }, { min: 63, letter: "D" }, { min: 60, letter: "D-" },
      { min: 0, letter: "F" },
    ];

    const subset = targetId
      ? students.filter((s) => s.studentId === targetId)
      : students;

    // Build weight map, defaulting to equal weights if not provided
    const weightMap = {};
    if (weightScheme.length > 0) {
      for (const w of weightScheme) weightMap[w.category] = parseFloat(w.weight) || 0;
    } else {
      const categories = [...new Set(subset.flatMap((s) => (s.grades || []).map((g) => g.category)))];
      const equalWeight = categories.length > 0 ? 100 / categories.length : 100;
      for (const cat of categories) weightMap[cat] = equalWeight;
    }

    function toLetter(pct) {
      for (const g of gradeScale) {
        if (pct >= g.min) return g.letter;
      }
      return "F";
    }

    const results = subset.map((student) => {
      const grades = student.grades || [];
      const byCategory = {};

      for (const grade of grades) {
        const cat = grade.category || "uncategorized";
        if (!byCategory[cat]) byCategory[cat] = { scores: [], maxScores: [] };
        byCategory[cat].scores.push(parseFloat(grade.score) || 0);
        byCategory[cat].maxScores.push(parseFloat(grade.maxScore) || 100);
      }

      let weightedTotal = 0;
      let totalWeight = 0;
      const categoryBreakdown = [];

      for (const [cat, data] of Object.entries(byCategory)) {
        const totalScore = data.scores.reduce((s, v) => s + v, 0);
        const totalMax = data.maxScores.reduce((s, v) => s + v, 0);
        const pct = totalMax > 0 ? (totalScore / totalMax) * 100 : 0;
        const weight = weightMap[cat] || 0;

        weightedTotal += pct * (weight / 100);
        totalWeight += weight;

        categoryBreakdown.push({
          category: cat,
          assignmentCount: data.scores.length,
          earnedPoints: Math.round(totalScore * 100) / 100,
          possiblePoints: Math.round(totalMax * 100) / 100,
          categoryPct: Math.round(pct * 100) / 100,
          weight,
        });
      }

      // Normalize if weights don't sum to 100
      const finalPct = totalWeight > 0 ? (weightedTotal / totalWeight) * 100 : weightedTotal;
      const roundedPct = Math.round(finalPct * 100) / 100;

      return {
        studentId: student.studentId,
        name: student.name,
        weightedPct: roundedPct,
        letterGrade: toLetter(roundedPct),
        totalAssignments: grades.length,
        categoryBreakdown,
      };
    });

    // Class statistics
    const pcts = results.map((r) => r.weightedPct);
    const classAvg = pcts.length > 0 ? Math.round((pcts.reduce((s, v) => s + v, 0) / pcts.length) * 100) / 100 : 0;
    const classMedian = pcts.length > 0
      ? (() => {
          const sorted = pcts.slice().sort((a, b) => a - b);
          const mid = Math.floor(sorted.length / 2);
          return sorted.length % 2 !== 0 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 100) / 100;
        })()
      : 0;
    const classHigh = pcts.length > 0 ? Math.max(...pcts) : 0;
    const classLow = pcts.length > 0 ? Math.min(...pcts) : 0;

    const report = {
      generatedAt: new Date().toISOString(),
      studentsGraded: results.length,
      weightScheme: Object.entries(weightMap).map(([cat, w]) => ({ category: cat, weight: w })),
      classStats: { average: classAvg, median: classMedian, high: classHigh, low: classLow },
      students: results.sort((a, b) => b.weightedPct - a.weightedPct),
    };

    artifact.data.gradeReport = report;

    return { ok: true, result: report };
  });

  /**
   * attendanceReport
   * Generate an attendance summary.
   * artifact.data.attendance: [{ studentId, name, records: [{ date, status }] }]
   * status: "present", "absent", "tardy", "excused"
   * params.startDate, params.endDate — optional period filter
   */
  registerLensAction("education", "attendanceReport", (_ctx, artifact, params) => {
    const attendance = artifact.data.attendance || [];
    const startDate = params.startDate ? new Date(params.startDate) : null;
    const endDate = params.endDate ? new Date(params.endDate) : null;

    const studentSummaries = attendance.map((student) => {
      let records = student.records || [];
      if (startDate || endDate) {
        records = records.filter((r) => {
          const d = new Date(r.date);
          if (startDate && d < startDate) return false;
          if (endDate && d > endDate) return false;
          return true;
        });
      }

      const counts = { present: 0, absent: 0, tardy: 0, excused: 0 };
      for (const r of records) {
        const s = (r.status || "present").toLowerCase();
        if (counts[s] !== undefined) counts[s]++;
        else counts.present++;
      }

      const totalDays = records.length;
      const attendancePct = totalDays > 0
        ? Math.round(((counts.present + counts.tardy) / totalDays) * 10000) / 100
        : 100;

      // Consecutive absences
      let maxConsecutiveAbsent = 0;
      let currentStreak = 0;
      const sorted = records.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      for (const r of sorted) {
        if (r.status === "absent") {
          currentStreak++;
          maxConsecutiveAbsent = Math.max(maxConsecutiveAbsent, currentStreak);
        } else {
          currentStreak = 0;
        }
      }

      return {
        studentId: student.studentId,
        name: student.name,
        totalDays,
        ...counts,
        attendancePct,
        maxConsecutiveAbsent,
        atRisk: attendancePct < 90 || maxConsecutiveAbsent >= 3,
      };
    });

    const totalStudents = studentSummaries.length;
    const atRiskStudents = studentSummaries.filter((s) => s.atRisk);
    const overallRate = totalStudents > 0
      ? Math.round((studentSummaries.reduce((s, st) => s + st.attendancePct, 0) / totalStudents) * 100) / 100
      : 100;

    const report = {
      generatedAt: new Date().toISOString(),
      period: {
        start: startDate ? startDate.toISOString().split("T")[0] : "all-time",
        end: endDate ? endDate.toISOString().split("T")[0] : "current",
      },
      totalStudents,
      overallAttendanceRate: overallRate,
      atRiskCount: atRiskStudents.length,
      students: studentSummaries.sort((a, b) => a.attendancePct - b.attendancePct),
      atRiskStudents: atRiskStudents.map((s) => ({ studentId: s.studentId, name: s.name, attendancePct: s.attendancePct })),
    };

    artifact.data.attendanceReport = report;

    return { ok: true, result: report };
  });

  /**
   * progressTrack
   * Calculate percentage completion toward a certification or program goal.
   * artifact.data.requirements: [{ requirementId, name, type, requiredUnits }]
   * artifact.data.completions: [{ requirementId, completedUnits, completedDate }]
   */
  registerLensAction("education", "progressTrack", (_ctx, artifact, params) => {
    const requirements = artifact.data.requirements || [];
    const completions = artifact.data.completions || [];

    // Build completions map
    const completionMap = {};
    for (const c of completions) {
      if (!completionMap[c.requirementId]) completionMap[c.requirementId] = 0;
      completionMap[c.requirementId] += parseFloat(c.completedUnits) || 0;
    }

    let totalRequired = 0;
    let totalCompleted = 0;

    const details = requirements.map((req) => {
      const required = parseFloat(req.requiredUnits) || 1;
      const completed = Math.min(completionMap[req.requirementId] || 0, required);
      const pct = Math.round((completed / required) * 10000) / 100;

      totalRequired += required;
      totalCompleted += completed;

      return {
        requirementId: req.requirementId,
        name: req.name,
        type: req.type || "general",
        requiredUnits: required,
        completedUnits: Math.round(completed * 100) / 100,
        remainingUnits: Math.round((required - completed) * 100) / 100,
        completionPct: pct,
        complete: pct >= 100,
      };
    });

    const overallPct = totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 10000) / 100 : 0;
    const completedReqs = details.filter((d) => d.complete).length;
    const incompleteReqs = details.filter((d) => !d.complete);

    // Estimated completion: if we know a start date and current progress
    let estimatedCompletionDate = null;
    if (params.startDate && overallPct > 0 && overallPct < 100) {
      const start = new Date(params.startDate);
      const elapsed = Date.now() - start.getTime();
      const totalEstimated = elapsed / (overallPct / 100);
      estimatedCompletionDate = new Date(start.getTime() + totalEstimated).toISOString().split("T")[0];
    }

    const result = {
      generatedAt: new Date().toISOString(),
      overallCompletionPct: overallPct,
      totalRequirements: requirements.length,
      completedRequirements: completedReqs,
      remainingRequirements: incompleteReqs.length,
      estimatedCompletionDate,
      details: details.sort((a, b) => a.completionPct - b.completionPct),
    };

    artifact.data.progressReport = result;

    return { ok: true, result };
  });

  /**
   * generateReportCard
   * Aggregate grades by subject, compute GPA, and determine honor roll status.
   * artifact.data.grades: [{ subject, assignment, score, maxScore, credits }]
   * artifact.data.studentName — student name
   * params.honorRollThreshold (default 3.5), params.highHonorsThreshold (default 3.8)
   */
  registerLensAction("education", "generateReportCard", (_ctx, artifact, params) => {
    const grades = artifact.data.grades || [];
    const honorRollThreshold = params.honorRollThreshold || 3.5;
    const highHonorsThreshold = params.highHonorsThreshold || 3.8;

    const gradeScale = [
      { min: 93, letter: "A", gpa: 4.0 }, { min: 90, letter: "A-", gpa: 3.7 },
      { min: 87, letter: "B+", gpa: 3.3 }, { min: 83, letter: "B", gpa: 3.0 }, { min: 80, letter: "B-", gpa: 2.7 },
      { min: 77, letter: "C+", gpa: 2.3 }, { min: 73, letter: "C", gpa: 2.0 }, { min: 70, letter: "C-", gpa: 1.7 },
      { min: 67, letter: "D+", gpa: 1.3 }, { min: 63, letter: "D", gpa: 1.0 }, { min: 60, letter: "D-", gpa: 0.7 },
      { min: 0, letter: "F", gpa: 0.0 },
    ];

    function toLetterAndGpa(pct) {
      for (const g of gradeScale) {
        if (pct >= g.min) return { letter: g.letter, gpa: g.gpa };
      }
      return { letter: "F", gpa: 0.0 };
    }

    // Aggregate by subject
    const bySubject = {};
    for (const g of grades) {
      const subj = g.subject || "General";
      if (!bySubject[subj]) bySubject[subj] = { earned: 0, possible: 0, credits: g.credits || 1, count: 0 };
      bySubject[subj].earned += parseFloat(g.score) || 0;
      bySubject[subj].possible += parseFloat(g.maxScore) || 100;
      bySubject[subj].count++;
      if (g.credits != null) bySubject[subj].credits = parseFloat(g.credits) || 1;
    }

    let totalGpaPoints = 0;
    let totalCredits = 0;
    const subjects = [];

    for (const [name, data] of Object.entries(bySubject)) {
      const pct = data.possible > 0 ? (data.earned / data.possible) * 100 : 0;
      const roundedPct = Math.round(pct * 100) / 100;
      const { letter, gpa } = toLetterAndGpa(roundedPct);
      const credits = data.credits;
      totalGpaPoints += gpa * credits;
      totalCredits += credits;

      subjects.push({
        subject: name,
        assignments: data.count,
        earnedPoints: Math.round(data.earned * 100) / 100,
        possiblePoints: Math.round(data.possible * 100) / 100,
        percentage: roundedPct,
        letterGrade: letter,
        gpa,
        credits,
      });
    }

    const cumulativeGpa = totalCredits > 0 ? Math.round((totalGpaPoints / totalCredits) * 100) / 100 : 0;
    let honorRoll = "none";
    if (cumulativeGpa >= highHonorsThreshold) honorRoll = "high-honors";
    else if (cumulativeGpa >= honorRollThreshold) honorRoll = "honor-roll";

    const result = {
      generatedAt: new Date().toISOString(),
      studentName: artifact.data.studentName || artifact.title,
      totalSubjects: subjects.length,
      totalAssignments: grades.length,
      cumulativeGpa,
      honorRoll,
      subjects: subjects.sort((a, b) => b.gpa - a.gpa),
    };

    artifact.data.reportCard = result;

    return { ok: true, result };
  });

  /**
   * scheduleConflict
   * Detect overlapping schedule entries.
   * artifact.data.schedules: [{ id, title, day, startTime, endTime, room, instructor }]
   * startTime/endTime in "HH:MM" 24-hour format
   */
  registerLensAction("education", "scheduleConflict", (_ctx, artifact, _params) => {
    const schedules = artifact.data.schedules || [];

    function timeToMinutes(t) {
      const [h, m] = (t || "0:00").split(":").map(Number);
      return h * 60 + (m || 0);
    }

    function overlaps(a, b) {
      return a.startMin < b.endMin && b.startMin < a.endMin;
    }

    // Prepare entries
    const entries = schedules.map((s) => ({
      ...s,
      startMin: timeToMinutes(s.startTime),
      endMin: timeToMinutes(s.endTime),
    }));

    const conflicts = [];
    const seen = new Set();

    // Group by day, then check each pair
    const byDay = {};
    for (const entry of entries) {
      const day = entry.day || "unknown";
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(entry);
    }

    for (const [day, dayEntries] of Object.entries(byDay)) {
      for (let i = 0; i < dayEntries.length; i++) {
        for (let j = i + 1; j < dayEntries.length; j++) {
          const a = dayEntries[i];
          const b = dayEntries[j];

          if (!overlaps(a, b)) continue;

          // Determine conflict type
          const conflictTypes = [];
          if (a.room && b.room && a.room === b.room) conflictTypes.push("room");
          if (a.instructor && b.instructor && a.instructor === b.instructor) conflictTypes.push("instructor");
          if (conflictTypes.length === 0) conflictTypes.push("time-overlap");

          const key = [a.id, b.id].sort().join("-");
          if (seen.has(key)) continue;
          seen.add(key);

          conflicts.push({
            day,
            conflictType: conflictTypes,
            entryA: { id: a.id, title: a.title, startTime: a.startTime, endTime: a.endTime, room: a.room, instructor: a.instructor },
            entryB: { id: b.id, title: b.title, startTime: b.startTime, endTime: b.endTime, room: b.room, instructor: b.instructor },
            overlapMinutes: Math.min(a.endMin, b.endMin) - Math.max(a.startMin, b.startMin),
          });
        }
      }
    }

    const result = {
      checkedAt: new Date().toISOString(),
      totalEntries: schedules.length,
      conflictsFound: conflicts.length,
      conflicts: conflicts.sort((a, b) => b.overlapMinutes - a.overlapMinutes),
      conflictFree: conflicts.length === 0,
    };

    artifact.data.scheduleConflicts = result;

    return { ok: true, result };
  });

  // ─── Parity-sprint macros: Anki SM-2 / Khanmigo Socratic / Quizlet Magic Notes ───

  function getEduState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.educationLens) {
      STATE.educationLens = {
        decks: new Map(),   // userId → deck[]
        cards: new Map(),   // userId → card[]
      };
    }
    return STATE.educationLens;
  }

  /**
   * flashcards-decks — list user's decks with per-deck count + due-today count.
   */
  registerLensAction("education", "flashcards-decks", (ctx, _artifact, _params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const decks = state.decks.get(userId) || [];
    const cards = state.cards.get(userId) || [];
    const now = Date.now();
    const enriched = decks.map(d => {
      const dCards = cards.filter(c => c.deckId === d.id);
      return {
        id: d.id, title: d.title, createdAt: d.createdAt,
        count: dCards.length,
        due: dCards.filter(c => new Date(c.dueAt).getTime() <= now).length,
      };
    });
    return { ok: true, result: { decks: enriched } };
  });

  registerLensAction("education", "flashcards-deck-create", (ctx, _artifact, params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    if (!state.decks.has(userId)) state.decks.set(userId, []);
    const deck = {
      id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title, createdAt: new Date().toISOString(),
    };
    state.decks.get(userId).push(deck);
    saveStateIfAvailable();
    return { ok: true, result: { deck } };
  });

  registerLensAction("education", "flashcards-card-create", (ctx, _artifact, params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const deckId = String(params.deckId || "");
    const front = String(params.front || "").trim();
    const back = String(params.back || "").trim();
    if (!deckId || !front || !back) return { ok: false, error: "deckId, front, back required" };
    if (!state.cards.has(userId)) state.cards.set(userId, []);
    const card = {
      id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      deckId, front, back,
      ease: 2.5, interval: 0, repetitions: 0,
      dueAt: new Date().toISOString(),
      scheduler: "sm2",
      createdAt: new Date().toISOString(),
    };
    state.cards.get(userId).push(card);
    saveStateIfAvailable();
    return { ok: true, result: { card } };
  });

  /**
   * flashcards-due — return cards due now, sorted by due time, capped at limit.
   */
  registerLensAction("education", "flashcards-due", (ctx, _artifact, params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const deckId = params.deckId ? String(params.deckId) : null;
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 20));
    const now = Date.now();
    const all = state.cards.get(userId) || [];
    const due = all
      .filter(c => (!deckId || c.deckId === deckId) && new Date(c.dueAt).getTime() <= now)
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
      .slice(0, limit);
    return { ok: true, result: { cards: due, total: all.length } };
  });

  /**
   * flashcards-review — SM-2 algorithm. Quality 0-5 maps to Again/Hard/Good/Easy.
   *   EF' = EF + (0.1 − (5−q)·(0.08 + (5−q)·0.02))
   *   Interval: n=1 → 1d, n=2 → 6d, n>2 → prev × EF
   *   Quality < 3 → reset (repetitions=0, interval=0).
   */
  registerLensAction("education", "flashcards-review", (ctx, _artifact, params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const cardId = String(params.cardId || "");
    const quality = Math.max(0, Math.min(5, Number(params.quality)));
    if (!cardId || !isFinite(quality)) return { ok: false, error: "cardId + numeric quality required" };
    const all = state.cards.get(userId) || [];
    const card = all.find(c => c.id === cardId);
    if (!card) return { ok: false, error: "card not found" };

    // SM-2
    if (quality < 3) {
      card.repetitions = 0;
      card.interval = 0;
    } else {
      card.repetitions += 1;
      if (card.repetitions === 1) card.interval = 1;
      else if (card.repetitions === 2) card.interval = 6;
      else card.interval = Math.round(card.interval * card.ease);
    }
    const eaNew = card.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    card.ease = Math.max(1.3, Math.round(eaNew * 100) / 100);
    card.dueAt = new Date(Date.now() + Math.max(1, card.interval) * (quality < 3 ? 60_000 : 86_400_000)).toISOString();
    card.lastReviewedAt = new Date().toISOString();
    card.lastQuality = quality;
    saveStateIfAvailable();
    return { ok: true, result: { card } };
  });

  /**
   * tutor-ask — Khanmigo-style Socratic. LLM constrained NEVER to give
   * the answer; outputs scaffolded questions, prerequisite checks,
   * 3-tier hint escalation, and identifies misconceptions.
   */
  registerLensAction("education", "tutor-ask", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: true, result: { text: "(tutor unavailable — LLM not configured)" } };
    const subject = String(params.subject || "general");
    const level = String(params.level || "high school");
    const context = String(params.context || "");
    const hintLevel = Math.max(1, Math.min(3, Number(params.hintLevel) || 1));
    const history = Array.isArray(params.history) ? params.history.slice(-12) : [];

    const hintPolicy = hintLevel === 1
      ? "Ask ONE Socratic question that nudges them to discover the next step. Do not reveal anything."
      : hintLevel === 2
      ? "Offer a small concrete nudge — name the rule or concept that applies, but do NOT solve."
      : "Walk them through the next single step explicitly. Stop after that step; ask them to take the next one.";

    const sys = `You are a Socratic tutor for ${subject} (${level}). NEVER give the final answer directly. ${hintPolicy}
Identify prerequisite gaps when relevant. If the student shows a misconception, name it gently and ask a question that surfaces it.
Be encouraging, short, and concrete. 3 sentences max.${context ? `\n\nLesson context:\n${context}` : ""}`;

    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          ...history.map(h => ({ role: h.role === "student" ? "user" : "assistant", content: String(h.content || "") })),
        ],
        temperature: 0.4,
        maxTokens: 256,
        slot: "conscious",
      });
      const text = String(llmRes?.text || llmRes?.content || llmRes?.message?.content || "").trim();
      return { ok: true, result: { text, hintLevel, model: "conscious" } };
    } catch (e) {
      return { ok: true, result: { text: `(tutor error: ${e?.message || "unknown"})`, hintLevel, error: true } };
    }
  });

  /**
   * quiz-from-text — Quizlet Magic Notes parity. LLM generates N study
   * cards from source text. Routes to utility brain (fast, cheap).
   */
  registerLensAction("education", "quiz-from-text", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const source = String(params.source || "").trim();
    const sourceDtuId = params.sourceDtuId ? String(params.sourceDtuId) : null;
    const count = Math.max(1, Math.min(30, Number(params.count) || 10));
    const difficulty = ["easy", "medium", "hard", "mixed"].includes(params.difficulty) ? params.difficulty : "mixed";

    let body = source;
    if (!body && sourceDtuId) {
      const STATE = globalThis._concordSTATE;
      const dtu = STATE?.dtus?.get?.(sourceDtuId);
      if (dtu) body = [dtu.title, dtu.human?.summary, ...(dtu.core?.definitions || []), ...(dtu.core?.claims || [])].filter(Boolean).join("\n\n");
    }
    if (!body || body.trim().length < 10) return { ok: false, error: "source text too short" };

    const sys = `You are a quiz card generator. Output ONLY a JSON object — no prose, no fences.
{
  "cards": [
    { "front": "question text", "back": "answer text", "difficulty": "easy|medium|hard" }
  ]
}
Constraints:
- Exactly ${count} cards
- Difficulty: ${difficulty === "mixed" ? "mix easy/medium/hard" : difficulty}
- Front is a question; back is the concise answer
- Pull facts ONLY from the source — do not invent`;

    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Source:\n${body.slice(0, 6000)}\n\nGenerate ${count} cards.` },
        ],
        temperature: 0.2,
        maxTokens: 2048,
        slot: "utility",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonForQuiz(raw);
      if (!parsed || !Array.isArray(parsed.cards)) return { ok: false, error: "parse failed", raw: raw.slice(0, 200) };
      const cards = parsed.cards.slice(0, count).map(c => ({
        front: String(c.front || c.question || "").trim(),
        back: String(c.back || c.answer || "").trim(),
        difficulty: ["easy", "medium", "hard"].includes(c.difficulty) ? c.difficulty : "medium",
      })).filter(c => c.front && c.back);
      return { ok: true, result: { cards, count: cards.length, source: sourceDtuId ? `dtu:${sourceDtuId}` : "user-text" } };
    } catch (e) {
      return { ok: false, error: e?.message || "generation failed" };
    }
  });

  /**
   * quiz-mint-deck — Persist accepted quiz cards as a flashcard deck.
   */
  registerLensAction("education", "quiz-mint-deck", (ctx, _artifact, params = {}) => {
    const state = getEduState();
    if (!state) return { ok: false, error: "STATE unavailable" };
    const userId = ctx?.actor?.userId || ctx?.userId || "anon";
    const title = String(params.title || "Generated quiz").trim();
    const cardsIn = Array.isArray(params.cards) ? params.cards : [];
    if (cardsIn.length === 0) return { ok: false, error: "no cards" };
    if (!state.decks.has(userId)) state.decks.set(userId, []);
    if (!state.cards.has(userId)) state.cards.set(userId, []);
    const deck = {
      id: `deck_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      title, createdAt: new Date().toISOString(),
    };
    state.decks.get(userId).push(deck);
    for (const c of cardsIn) {
      const front = String(c.front || "").trim();
      const back = String(c.back || "").trim();
      if (!front || !back) continue;
      state.cards.get(userId).push({
        id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        deckId: deck.id, front, back,
        ease: 2.5, interval: 0, repetitions: 0,
        dueAt: new Date().toISOString(),
        scheduler: "sm2",
        createdAt: new Date().toISOString(),
      });
    }
    saveStateIfAvailable();
    return { ok: true, result: { deck, added: cardsIn.length } };
  });

  /**
   * lesson-plan-generate — Khan/Chalkie-style lesson plan via conscious brain.
   * Returns a structured plan: objectives, materials, warm-up, main, practice,
   * closure, differentiation (struggling/grade/advanced), assessment.
   */
  registerLensAction("education", "lesson-plan-generate", async (ctx, _artifact, params = {}) => {
    if (!ctx?.llm?.chat) return { ok: false, error: "llm unavailable" };
    const subject = String(params.subject || "general");
    const grade = String(params.grade || "high school");
    const duration = String(params.duration || "45 min");
    const topic = String(params.topic || "").trim();
    const standard = params.standard ? String(params.standard) : null;
    if (!topic) return { ok: false, error: "topic required" };

    const sys = `You are an experienced teacher building lesson plans. Output ONLY JSON, no prose, no fences.
{
  "plan": {
    "title": "string",
    "subject": "${subject}",
    "grade": "${grade}",
    "duration": "${duration}",
    "standards": ["${standard || ""}"],
    "objectives": ["3-5 measurable student learning objectives"],
    "materials": ["list of materials and tools"],
    "warmUp": "5-min activity to activate prior knowledge",
    "mainActivity": "guided instruction block (be specific)",
    "practice": "guided + independent practice",
    "closure": "exit ticket / summary",
    "differentiation": {
      "struggling": "scaffolding for struggling learners",
      "grade_level": "core experience for on-grade learners",
      "advanced": "extension for advanced learners"
    },
    "assessment": "how learning will be assessed"
  }
}`;

    try {
      const llmRes = await ctx.llm.chat({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: `Topic: ${topic}\nDuration: ${duration}\nGrade: ${grade}\nSubject: ${subject}${standard ? `\nStandard: ${standard}` : ""}\n\nGenerate the lesson plan.` },
        ],
        temperature: 0.4,
        maxTokens: 2048,
        slot: "conscious",
      });
      const raw = String(llmRes?.text || llmRes?.content || "").trim();
      const parsed = extractJsonForQuiz(raw);
      if (!parsed?.plan) return { ok: false, error: "parse failed", raw: raw.slice(0, 200) };
      return { ok: true, result: { plan: parsed.plan } };
    } catch (e) {
      return { ok: false, error: e?.message || "generation failed" };
    }
  });

  // ─── Full-app parity: Khan Academy + Coursera 2026 ─────────────────

  function uidEdu(p) { return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  function eduActor(ctx) { return ctx?.actor?.userId || ctx?.userId || "anon"; }
  function ensureEduBucket(state, key, userId) {
    if (!state[key]) state[key] = new Map();
    if (!state[key].has(userId)) state[key].set(userId, []);
    return state[key].get(userId);
  }
  function hashEdu(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return h;
  }

  // ── Courses CRUD + catalog search ─────────────────────────────

  registerLensAction("education", "courses-list", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courses = ensureEduBucket(s, "courses", userId);
    const category = params.category ? String(params.category) : null;
    const filtered = category ? courses.filter(c => c.category === category) : courses;
    return { ok: true, result: { courses: filtered, total: filtered.length } };
  });

  registerLensAction("education", "courses-create", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const title = String(params.title || "").trim();
    if (!title) return { ok: false, error: "title required" };
    const course = {
      id: uidEdu("course"), title,
      description: String(params.description || ""),
      category: String(params.category || "general"),
      level: ["beginner", "intermediate", "advanced"].includes(params.level) ? params.level : "beginner",
      durationHours: Math.max(0, Number(params.durationHours) || 0),
      instructor: String(params.instructor || ""),
      institution: String(params.institution || ""),
      kind: ["course", "specialization", "certificate", "guided_project"].includes(params.kind) ? params.kind : "course",
      lessons: [],
      enrollmentCount: 0,
      rating: Math.max(0, Math.min(5, Number(params.rating) || 0)),
      createdAt: new Date().toISOString(),
    };
    ensureEduBucket(s, "courses", userId).push(course);
    saveStateIfAvailable();
    return { ok: true, result: { course } };
  });

  registerLensAction("education", "courses-get", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const course = ensureEduBucket(s, "courses", userId).find(c => c.id === id);
    if (!course) return { ok: false, error: "course not found" };
    return { ok: true, result: { course } };
  });

  registerLensAction("education", "courses-delete", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const list = ensureEduBucket(s, "courses", userId);
    const idx = list.findIndex(c => c.id === id);
    if (idx < 0) return { ok: false, error: "course not found" };
    list.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  registerLensAction("education", "courses-search", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const query = String(params.query || "").trim().toLowerCase();
    if (!query) return { ok: false, error: "query required" };
    const all = ensureEduBucket(s, "courses", userId);
    const matches = all.filter(c =>
      c.title.toLowerCase().includes(query) ||
      c.description.toLowerCase().includes(query) ||
      c.category.toLowerCase().includes(query) ||
      c.instructor.toLowerCase().includes(query) ||
      c.institution.toLowerCase().includes(query)
    );
    return { ok: true, result: { matches, total: matches.length, query } };
  });

  // ── Lessons within a course ───────────────────────────────────

  registerLensAction("education", "lessons-list", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    const course = ensureEduBucket(s, "courses", userId).find(c => c.id === courseId);
    if (!course) return { ok: false, error: "course not found" };
    return { ok: true, result: { lessons: course.lessons || [] } };
  });

  registerLensAction("education", "lessons-create", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    const title = String(params.title || "").trim();
    if (!courseId || !title) return { ok: false, error: "courseId and title required" };
    const course = ensureEduBucket(s, "courses", userId).find(c => c.id === courseId);
    if (!course) return { ok: false, error: "course not found" };
    const lesson = {
      id: uidEdu("less"), title,
      videoUrl: String(params.videoUrl || ""),
      durationMin: Math.max(0, Number(params.durationMin) || 0),
      kind: ["video", "reading", "quiz", "assignment", "discussion"].includes(params.kind) ? params.kind : "video",
      order: course.lessons.length + 1,
      createdAt: new Date().toISOString(),
    };
    course.lessons.push(lesson);
    saveStateIfAvailable();
    return { ok: true, result: { lesson } };
  });

  registerLensAction("education", "lessons-complete", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    const lessonId = String(params.lessonId || "");
    if (!courseId || !lessonId) return { ok: false, error: "courseId and lessonId required" };
    const progressMap = ensureEduBucket(s, "lessonProgress", userId);
    const existing = progressMap.find(p => p.courseId === courseId && p.lessonId === lessonId);
    if (existing) {
      existing.completedAt = new Date().toISOString();
    } else {
      progressMap.push({ courseId, lessonId, completedAt: new Date().toISOString() });
    }
    // Award energy points + check streak
    const points = ensureEduBucket(s, "energyPoints", userId);
    points.push({ amount: 50, source: "lesson_complete", lessonId, timestamp: new Date().toISOString() });
    saveStateIfAvailable();
    return { ok: true, result: { completedAt: new Date().toISOString(), pointsAwarded: 50 } };
  });

  // ── Enrollments + course progress ─────────────────────────────

  registerLensAction("education", "enrollments-list", (ctx, _a, _p = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const enrollments = ensureEduBucket(s, "enrollments", userId);
    const courses = ensureEduBucket(s, "courses", userId);
    const progress = ensureEduBucket(s, "lessonProgress", userId);
    const enriched = enrollments.map(e => {
      const course = courses.find(c => c.id === e.courseId);
      const total = course?.lessons?.length || 0;
      const completed = progress.filter(p => p.courseId === e.courseId).length;
      return {
        ...e, course,
        totalLessons: total,
        completedLessons: completed,
        progressPct: total > 0 ? Math.round((completed / total) * 100) : 0,
      };
    });
    return { ok: true, result: { enrollments: enriched } };
  });

  registerLensAction("education", "enrollments-enroll", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    if (!courseId) return { ok: false, error: "courseId required" };
    const course = ensureEduBucket(s, "courses", userId).find(c => c.id === courseId);
    if (!course) return { ok: false, error: "course not found" };
    const enrollments = ensureEduBucket(s, "enrollments", userId);
    if (enrollments.find(e => e.courseId === courseId)) return { ok: false, error: "already enrolled" };
    const enrollment = {
      id: uidEdu("enr"), courseId,
      enrolledAt: new Date().toISOString(),
      status: "in_progress",
    };
    enrollments.push(enrollment);
    course.enrollmentCount = (course.enrollmentCount || 0) + 1;
    saveStateIfAvailable();
    return { ok: true, result: { enrollment } };
  });

  registerLensAction("education", "enrollments-unenroll", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const enrollments = ensureEduBucket(s, "enrollments", userId);
    const idx = enrollments.findIndex(e => e.id === id);
    if (idx < 0) return { ok: false, error: "enrollment not found" };
    enrollments.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Skill tree + mastery levels (Khan-style) ──────────────────

  const MASTERY_LEVELS = ["not_started", "attempted", "familiar", "proficient", "mastered"];

  registerLensAction("education", "skills-tree", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const subject = String(params.subject || "");
    const skills = ensureEduBucket(s, "skills", userId);
    const filtered = subject ? skills.filter(k => k.subject === subject) : skills;
    const counts = MASTERY_LEVELS.reduce((acc, lvl) => { acc[lvl] = filtered.filter(k => k.mastery === lvl).length; return acc; }, {});
    return { ok: true, result: { skills: filtered, counts, subject } };
  });

  registerLensAction("education", "skills-create", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const name = String(params.name || "").trim();
    if (!name) return { ok: false, error: "name required" };
    const skill = {
      id: uidEdu("skill"), name,
      subject: String(params.subject || "general"),
      mastery: "not_started",
      prerequisites: Array.isArray(params.prerequisites) ? params.prerequisites : [],
      attempts: 0,
      lastPracticedAt: null,
      createdAt: new Date().toISOString(),
    };
    ensureEduBucket(s, "skills", userId).push(skill);
    saveStateIfAvailable();
    return { ok: true, result: { skill } };
  });

  registerLensAction("education", "skills-practice", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const success = params.success !== false;
    const skills = ensureEduBucket(s, "skills", userId);
    const skill = skills.find(k => k.id === id);
    if (!skill) return { ok: false, error: "skill not found" };
    skill.attempts++;
    skill.lastPracticedAt = new Date().toISOString();
    if (success) {
      const idx = MASTERY_LEVELS.indexOf(skill.mastery);
      if (idx < MASTERY_LEVELS.length - 1) skill.mastery = MASTERY_LEVELS[idx + 1];
    } else {
      const idx = MASTERY_LEVELS.indexOf(skill.mastery);
      if (idx > 1) skill.mastery = MASTERY_LEVELS[idx - 1];
    }
    // Award points for mastery progress
    if (success) {
      const pts = skill.mastery === "mastered" ? 200 : skill.mastery === "proficient" ? 100 : 25;
      ensureEduBucket(s, "energyPoints", userId).push({ amount: pts, source: `skill_${skill.mastery}`, skillId: id, timestamp: new Date().toISOString() });
    }
    saveStateIfAvailable();
    return { ok: true, result: { skill, pointsAwarded: success ? (skill.mastery === "mastered" ? 200 : skill.mastery === "proficient" ? 100 : 25) : 0 } };
  });

  // ── Streaks + energy points + course level ─────────────────────

  registerLensAction("education", "gamification-status", (ctx, _a, _p = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const points = ensureEduBucket(s, "energyPoints", userId);
    const totalPoints = points.reduce((sum, p) => sum + p.amount, 0);
    // Streak: count consecutive days with at least one activity
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const day = 86400000;
    const datesWithActivity = new Set(points.map(p => new Date(p.timestamp).toISOString().slice(0, 10)));
    let streak = 0;
    for (let d = 0; d < 365; d++) {
      const check = new Date(today.getTime() - d * day).toISOString().slice(0, 10);
      if (datesWithActivity.has(check)) streak++;
      else if (d > 0) break;
    }
    // Course level = number of skills at proficient+
    const skills = ensureEduBucket(s, "skills", userId);
    const proficientCount = skills.filter(k => k.mastery === "proficient" || k.mastery === "mastered").length;
    const level = Math.floor(proficientCount / 5) + 1;
    return {
      ok: true,
      result: {
        totalPoints,
        streak,
        level,
        skillPoints: proficientCount,
        nextLevelAt: level * 5,
        recentPoints: points.slice(-10).reverse(),
      },
    };
  });

  registerLensAction("education", "points-award", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const amount = Math.max(0, Math.min(10000, Number(params.amount) || 0));
    const source = String(params.source || "manual");
    if (amount <= 0) return { ok: false, error: "amount must be > 0" };
    ensureEduBucket(s, "energyPoints", userId).push({ amount, source, timestamp: new Date().toISOString() });
    saveStateIfAvailable();
    return { ok: true, result: { amount, source } };
  });

  // ── Certificates ──────────────────────────────────────────────

  registerLensAction("education", "certificates-list", (ctx, _a, _p = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const certs = ensureEduBucket(s, "certificates", userId);
    return { ok: true, result: { certificates: certs } };
  });

  registerLensAction("education", "certificates-issue", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    if (!courseId) return { ok: false, error: "courseId required" };
    const course = ensureEduBucket(s, "courses", userId).find(c => c.id === courseId);
    if (!course) return { ok: false, error: "course not found" };
    const lessons = course.lessons || [];
    const progress = ensureEduBucket(s, "lessonProgress", userId);
    const completed = progress.filter(p => p.courseId === courseId).length;
    if (completed < lessons.length) return { ok: false, error: `course incomplete (${completed}/${lessons.length} lessons)` };
    const cert = {
      id: uidEdu("cert"), courseId,
      courseTitle: course.title,
      issuedAt: new Date().toISOString(),
      institution: course.institution,
      instructor: course.instructor,
      verificationCode: `CERT-${Math.random().toString(36).slice(2, 6).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
    };
    ensureEduBucket(s, "certificates", userId).push(cert);
    saveStateIfAvailable();
    return { ok: true, result: { certificate: cert } };
  });

  // ── Assignments + peer review (Coursera-style) ─────────────────

  registerLensAction("education", "assignments-list", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = params.courseId ? String(params.courseId) : null;
    const all = ensureEduBucket(s, "assignments", userId);
    const filtered = courseId ? all.filter(a => a.courseId === courseId) : all;
    return { ok: true, result: { assignments: filtered } };
  });

  registerLensAction("education", "assignments-create", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    const title = String(params.title || "").trim();
    if (!courseId || !title) return { ok: false, error: "courseId and title required" };
    const assignment = {
      id: uidEdu("asgn"), courseId, title,
      description: String(params.description || ""),
      dueAt: params.dueAt || null,
      peerReviewCount: Math.max(0, Number(params.peerReviewCount) || 0),
      rubric: Array.isArray(params.rubric) ? params.rubric : [],
      maxPoints: Math.max(1, Number(params.maxPoints) || 100),
      createdAt: new Date().toISOString(),
    };
    ensureEduBucket(s, "assignments", userId).push(assignment);
    saveStateIfAvailable();
    return { ok: true, result: { assignment } };
  });

  registerLensAction("education", "assignments-submit", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const assignmentId = String(params.assignmentId || "");
    const text = String(params.text || "").trim();
    if (!assignmentId || !text) return { ok: false, error: "assignmentId and text required" };
    const assignment = ensureEduBucket(s, "assignments", userId).find(a => a.id === assignmentId);
    if (!assignment) return { ok: false, error: "assignment not found" };
    const submission = {
      id: uidEdu("sub"), assignmentId, text,
      submittedAt: new Date().toISOString(),
      grade: null,
      peerReviews: [],
      status: assignment.peerReviewCount > 0 ? "awaiting_peer_review" : "submitted",
    };
    ensureEduBucket(s, "submissions", userId).push(submission);
    saveStateIfAvailable();
    return { ok: true, result: { submission } };
  });

  registerLensAction("education", "assignments-peer-review", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const submissionId = String(params.submissionId || "");
    const score = Math.max(0, Number(params.score) || 0);
    const feedback = String(params.feedback || "").trim();
    if (!submissionId || !feedback) return { ok: false, error: "submissionId and feedback required" };
    const submission = ensureEduBucket(s, "submissions", userId).find(sb => sb.id === submissionId);
    if (!submission) return { ok: false, error: "submission not found" };
    submission.peerReviews.push({ reviewerId: userId, score, feedback, reviewedAt: new Date().toISOString() });
    saveStateIfAvailable();
    return { ok: true, result: { submission } };
  });

  // ── Lesson notes ──────────────────────────────────────────────

  registerLensAction("education", "notes-list", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const lessonId = params.lessonId ? String(params.lessonId) : null;
    const all = ensureEduBucket(s, "lessonNotes", userId);
    const notes = lessonId ? all.filter(n => n.lessonId === lessonId) : all;
    return { ok: true, result: { notes } };
  });

  registerLensAction("education", "notes-save", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const lessonId = String(params.lessonId || "");
    const text = String(params.text || "").trim();
    const timestampSec = params.timestampSec != null ? Number(params.timestampSec) : null;
    if (!lessonId || !text) return { ok: false, error: "lessonId and text required" };
    const note = {
      id: uidEdu("note"), lessonId, text,
      videoTimestampSec: timestampSec,
      createdAt: new Date().toISOString(),
    };
    ensureEduBucket(s, "lessonNotes", userId).push(note);
    saveStateIfAvailable();
    return { ok: true, result: { note } };
  });

  registerLensAction("education", "notes-delete", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const notes = ensureEduBucket(s, "lessonNotes", userId);
    const idx = notes.findIndex(n => n.id === id);
    if (idx < 0) return { ok: false, error: "note not found" };
    notes.splice(idx, 1);
    saveStateIfAvailable();
    return { ok: true, result: { id, deleted: true } };
  });

  // ── Course discussions ────────────────────────────────────────

  registerLensAction("education", "discussions-list", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = params.courseId ? String(params.courseId) : null;
    const all = ensureEduBucket(s, "discussions", userId);
    const filtered = courseId ? all.filter(d => d.courseId === courseId) : all;
    return { ok: true, result: { discussions: filtered.slice().reverse() } };
  });

  registerLensAction("education", "discussions-post", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courseId = String(params.courseId || "");
    const text = String(params.text || "").trim();
    const replyTo = params.replyTo ? String(params.replyTo) : null;
    if (!courseId || !text) return { ok: false, error: "courseId and text required" };
    const post = {
      id: uidEdu("disc"), courseId, text, replyTo,
      author: userId,
      upvotes: 0,
      createdAt: new Date().toISOString(),
    };
    ensureEduBucket(s, "discussions", userId).push(post);
    saveStateIfAvailable();
    return { ok: true, result: { post } };
  });

  registerLensAction("education", "discussions-upvote", (ctx, _a, params = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const id = String(params.id || "");
    const post = ensureEduBucket(s, "discussions", userId).find(p => p.id === id);
    if (!post) return { ok: false, error: "post not found" };
    post.upvotes++;
    saveStateIfAvailable();
    return { ok: true, result: { upvotes: post.upvotes } };
  });

  // ── Dashboard summary (ClassroomShell data source) ─────────────

  registerLensAction("education", "dashboard-summary", (ctx, _a, _p = {}) => {
    const s = getEduState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = eduActor(ctx);
    const courses = ensureEduBucket(s, "courses", userId);
    const enrollments = ensureEduBucket(s, "enrollments", userId);
    const progress = ensureEduBucket(s, "lessonProgress", userId);
    const skills = ensureEduBucket(s, "skills", userId);
    const certificates = ensureEduBucket(s, "certificates", userId);
    const points = ensureEduBucket(s, "energyPoints", userId);
    const today = new Date().toISOString().slice(0, 10);
    const pointsToday = points.filter(p => p.timestamp.startsWith(today)).reduce((sum, p) => sum + p.amount, 0);
    const datesWithActivity = new Set(points.map(p => new Date(p.timestamp).toISOString().slice(0, 10)));
    const todayDate = new Date(); todayDate.setHours(0, 0, 0, 0);
    let streak = 0;
    for (let d = 0; d < 365; d++) {
      const check = new Date(todayDate.getTime() - d * 86400000).toISOString().slice(0, 10);
      if (datesWithActivity.has(check)) streak++;
      else if (d > 0) break;
    }
    const proficientSkills = skills.filter(k => k.mastery === "proficient" || k.mastery === "mastered").length;
    const masteredSkills = skills.filter(k => k.mastery === "mastered").length;
    return {
      ok: true,
      result: {
        totalCourses: courses.length,
        enrolledCount: enrollments.length,
        completedLessons: progress.length,
        totalSkills: skills.length,
        proficientSkills,
        masteredSkills,
        certificates: certificates.length,
        totalPoints: points.reduce((sum, p) => sum + p.amount, 0),
        pointsToday,
        streak,
        level: Math.floor(proficientSkills / 5) + 1,
      },
    };
  });
};

function saveStateIfAvailable() {
  if (typeof globalThis._concordSaveStateDebounced === "function") {
    try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
  }
}

function extractJsonForQuiz(text) {
  if (!text) return null;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const first = body.indexOf("{");
  const last = body.lastIndexOf("}");
  if (first < 0 || last <= first) return null;
  try { return JSON.parse(body.slice(first, last + 1)); } catch { return null; }
}
