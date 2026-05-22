// server/domains/experience.js
//
// Experience lens — UX-research suite, category leader: Maze / UserTesting.
//
// Two macro families coexist:
//  1. Artifact-bound analytical macros (journeyMap / usabilityScore /
//     heuristicEval / personaBuilder) — operate on the generic artifact store.
//  2. Stateful UX-research macros — unmoderated usability test runner,
//     click/heatmap + first-click studies, card-sorting / tree-testing,
//     survey builder w/ branching, participant recruitment / panel,
//     highlight reels, and prototype-embed interaction analytics.
//
// Stateful macros persist per-user data in globalThis._concordSTATE.experienceLens
// (Maps keyed by userId). Every handler returns { ok, result?, error? } and
// never throws.
export default function registerExperienceActions(registerLensAction) {
  // ─────────────────────────────────────────────────────────────────────
  // Artifact-bound analytical macros (unchanged behaviour)
  // ─────────────────────────────────────────────────────────────────────
  registerLensAction("experience", "journeyMap", (ctx, artifact, _params) => {
    const stages = artifact.data?.stages || [];
    if (stages.length === 0) return { ok: true, result: { message: "Add journey stages with touchpoints and emotions." } };
    const mapped = stages.map((s, i) => ({ stage: s.name || `Stage ${i + 1}`, touchpoints: s.touchpoints || [], emotion: s.emotion || "neutral", painPoints: s.painPoints || [], opportunities: s.opportunities || [], satisfactionScore: parseInt(s.satisfaction) || 50 }));
    const avgSatisfaction = Math.round(mapped.reduce((sum, s) => sum + s.satisfactionScore, 0) / mapped.length);
    const lowestPoint = [...mapped].sort((a, b) => a.satisfactionScore - b.satisfactionScore)[0];
    return { ok: true, result: { stages: mapped, totalStages: mapped.length, avgSatisfaction, lowestPoint: lowestPoint?.stage, totalPainPoints: mapped.reduce((s, m) => s + m.painPoints.length, 0), totalOpportunities: mapped.reduce((s, m) => s + m.opportunities.length, 0) } };
  });
  registerLensAction("experience", "usabilityScore", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const taskSuccess = parseFloat(data.taskSuccessRate) || 0;
    const timeOnTask = parseFloat(data.avgTimeSeconds) || 0;
    const errors = parseInt(data.errorCount) || 0;
    const satisfaction = parseFloat(data.satisfactionScore) || 0;
    const sus = Math.round(taskSuccess * 25 + Math.max(0, 100 - timeOnTask / 2) * 0.25 + Math.max(0, 100 - errors * 10) * 0.25 + satisfaction * 0.25);
    return { ok: true, result: { taskSuccessRate: taskSuccess, avgTimeSeconds: timeOnTask, errorCount: errors, satisfactionScore: satisfaction, susScore: Math.min(100, sus), grade: sus >= 80 ? "A" : sus >= 68 ? "B" : sus >= 50 ? "C" : "D", benchmark: "Industry average SUS score is 68" } };
  });
  registerLensAction("experience", "heuristicEval", (ctx, artifact, _params) => {
    const heuristics = ["Visibility of system status", "Match between system and real world", "User control and freedom", "Consistency and standards", "Error prevention", "Recognition rather than recall", "Flexibility and efficiency", "Aesthetic and minimalist design", "Help users recognize errors", "Help and documentation"];
    const evaluations = artifact.data?.evaluations || [];
    const scored = heuristics.map((h, i) => { const ev = evaluations[i] || {}; return { heuristic: h, score: parseInt(ev.score) || 0, severity: parseInt(ev.severity) || 0, notes: ev.notes || "", finding: ev.finding || "" }; });
    const avgScore = scored.reduce((s, h) => s + h.score, 0) / scored.length;
    return { ok: true, result: { heuristics: scored, avgScore: Math.round(avgScore * 10) / 10, criticalIssues: scored.filter(h => h.severity >= 4).length, evaluated: evaluations.length, total: heuristics.length } };
  });
  registerLensAction("experience", "personaBuilder", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    return { ok: true, result: { persona: { name: data.name || artifact.title, age: data.age || "30-40", occupation: data.occupation || "Professional", goals: data.goals || [], frustrations: data.frustrations || [], behaviors: data.behaviors || [], techSavvy: data.techSavvy || "moderate", quote: data.quote || "" }, completeness: Math.round(([data.name, data.age, data.occupation, (data.goals || []).length, (data.frustrations || []).length].filter(Boolean).length / 5) * 100) } };
  });

  // ─────────────────────────────────────────────────────────────────────
  // Stateful UX-research substrate
  // ─────────────────────────────────────────────────────────────────────
  function xState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.experienceLens) STATE.experienceLens = {};
    const x = STATE.experienceLens;
    if (!(x.tests instanceof Map)) x.tests = new Map();        // userId -> Array<test>
    if (!(x.runs instanceof Map)) x.runs = new Map();          // userId -> Array<test run>
    if (!(x.heatmaps instanceof Map)) x.heatmaps = new Map();  // userId -> Array<heatmap study>
    if (!(x.sorts instanceof Map)) x.sorts = new Map();        // userId -> Array<card-sort study>
    if (!(x.surveys instanceof Map)) x.surveys = new Map();    // userId -> Array<survey>
    if (!(x.responses instanceof Map)) x.responses = new Map();// userId -> Array<survey response>
    if (!(x.panel instanceof Map)) x.panel = new Map();        // userId -> Array<participant>
    if (!(x.clips instanceof Map)) x.clips = new Map();        // userId -> Array<highlight clip>
    if (!(x.protos instanceof Map)) x.protos = new Map();      // userId -> Array<prototype embed>
    return x;
  }
  function save() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const gid = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clean = (v, max = 600) => String(v == null ? "" : v).trim().slice(0, max);
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const arr = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  const list = (v) => Array.isArray(v) ? v : [];

  // ── Helper: register a per-user collection CRUD-lite pattern inline ───

  // ════════════════════════════════════════════════════════════════════
  // 1. Unmoderated usability test runner
  //    A test = ordered task prompts. A run = a participant executing the
  //    test, with per-task recorded events (clicks/screens), success and
  //    timing. Playback-ready: events carry timestamps.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "createTest", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const tasks = list(params.tasks).map((t, i) => ({
        id: gid("task"),
        order: i,
        prompt: clean(typeof t === "string" ? t : t.prompt, 400),
        successCriteria: clean(typeof t === "object" ? t.successCriteria : "", 300),
      })).filter(t => t.prompt);
      if (!tasks.length) return { ok: false, error: "at least one task prompt required" };
      const test = {
        id: gid("uxt"),
        name: clean(params.name || "Untitled usability test", 160),
        description: clean(params.description, 600),
        targetUrl: clean(params.targetUrl, 400),
        tasks,
        createdAt: Date.now(),
      };
      arr(x.tests, uid(ctx)).unshift(test);
      save();
      return { ok: true, result: { test } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listTests", (ctx, _a, _params = {}) => {
    try {
      const x = xState();
      const tests = arr(x.tests, uid(ctx));
      const runs = arr(x.runs, uid(ctx));
      const withStats = tests.map(t => {
        const tRuns = runs.filter(r => r.testId === t.id);
        const completed = tRuns.filter(r => r.status === "completed");
        const successes = completed.reduce((s, r) => s + r.tasks.filter(tr => tr.success).length, 0);
        const totalTasks = completed.reduce((s, r) => s + r.tasks.length, 0);
        return {
          ...t,
          runCount: tRuns.length,
          completedRuns: completed.length,
          successRate: totalTasks ? Math.round((successes / totalTasks) * 100) : 0,
        };
      });
      return { ok: true, result: { tests: withStats, count: withStats.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "recordRun", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const tests = arr(x.tests, uid(ctx));
      const test = tests.find(t => t.id === params.testId);
      if (!test) return { ok: false, error: "test not found" };
      // params.tasks: [{ taskId, success, durationMs, events:[{t,kind,x,y,target}] }]
      const taskResults = test.tasks.map((task) => {
        const submitted = list(params.tasks).find(tr => tr.taskId === task.id) || {};
        const events = list(submitted.events).map(ev => ({
          t: num(ev.t),
          kind: clean(ev.kind || "click", 32),
          x: num(ev.x),
          y: num(ev.y),
          target: clean(ev.target, 200),
        }));
        return {
          taskId: task.id,
          prompt: task.prompt,
          success: !!submitted.success,
          durationMs: num(submitted.durationMs),
          clickCount: events.filter(e => e.kind === "click").length,
          events,
        };
      });
      const run = {
        id: gid("uxr"),
        testId: test.id,
        testName: test.name,
        participant: clean(params.participant || "Anonymous", 120),
        status: "completed",
        tasks: taskResults,
        totalDurationMs: taskResults.reduce((s, t) => s + t.durationMs, 0),
        successCount: taskResults.filter(t => t.success).length,
        createdAt: Date.now(),
      };
      arr(x.runs, uid(ctx)).unshift(run);
      save();
      return { ok: true, result: { run } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listRuns", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      let runs = arr(x.runs, uid(ctx));
      if (params.testId) runs = runs.filter(r => r.testId === params.testId);
      // Lightweight playback summary per run (full events kept).
      return { ok: true, result: { runs, count: runs.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 2. Click / heatmap tester — first-click + click density studies
  //    A study collects click points (normalized 0..1 coords). Macro
  //    aggregates a grid heatmap + first-click success against a defined
  //    target region.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "createHeatmapStudy", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const study = {
        id: gid("hm"),
        name: clean(params.name || "First-click study", 160),
        question: clean(params.question || "Where would you click to complete the task?", 400),
        imageUrl: clean(params.imageUrl, 400),
        // success target region in normalized coords {x,y,w,h}
        target: params.target ? {
          x: Math.min(1, Math.max(0, num(params.target.x))),
          y: Math.min(1, Math.max(0, num(params.target.y))),
          w: Math.min(1, Math.max(0, num(params.target.w, 0.2))),
          h: Math.min(1, Math.max(0, num(params.target.h, 0.2))),
        } : null,
        clicks: [],
        createdAt: Date.now(),
      };
      arr(x.heatmaps, uid(ctx)).unshift(study);
      save();
      return { ok: true, result: { study } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "recordClick", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const study = arr(x.heatmaps, uid(ctx)).find(s => s.id === params.studyId);
      if (!study) return { ok: false, error: "study not found" };
      const cx = Math.min(1, Math.max(0, num(params.x)));
      const cy = Math.min(1, Math.max(0, num(params.y)));
      study.clicks.push({ x: cx, y: cy, t: Date.now(), durationMs: num(params.durationMs) });
      save();
      return { ok: true, result: { studyId: study.id, totalClicks: study.clicks.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "heatmapResults", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const study = arr(x.heatmaps, uid(ctx)).find(s => s.id === params.studyId);
      if (!study) return { ok: false, error: "study not found" };
      const GRID = 10;
      const grid = Array.from({ length: GRID }, () => new Array(GRID).fill(0));
      let hits = 0;
      let totalDuration = 0;
      for (const c of study.clicks) {
        const gx = Math.min(GRID - 1, Math.floor(c.x * GRID));
        const gy = Math.min(GRID - 1, Math.floor(c.y * GRID));
        grid[gy][gx] += 1;
        totalDuration += num(c.durationMs);
        if (study.target) {
          const inX = c.x >= study.target.x && c.x <= study.target.x + study.target.w;
          const inY = c.y >= study.target.y && c.y <= study.target.y + study.target.h;
          if (inX && inY) hits += 1;
        }
      }
      const max = grid.flat().reduce((m, v) => Math.max(m, v), 0);
      const total = study.clicks.length;
      return {
        ok: true,
        result: {
          studyId: study.id,
          name: study.name,
          totalClicks: total,
          grid,
          gridMax: max,
          firstClickSuccessRate: study.target && total ? Math.round((hits / total) * 100) : null,
          avgDecisionMs: total ? Math.round(totalDuration / total) : 0,
          target: study.target,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 3. Card-sorting / tree-testing — IA validation
  //    open/closed card sort: participants group cards into categories.
  //    Aggregation: category-membership agreement matrix + popular
  //    category names.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "createCardSort", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const cards = list(params.cards).map(c => clean(typeof c === "string" ? c : c.label, 120)).filter(Boolean);
      if (!cards.length) return { ok: false, error: "at least one card required" };
      const study = {
        id: gid("cs"),
        name: clean(params.name || "Card sort study", 160),
        kind: params.kind === "closed" ? "closed" : "open", // closed = fixed categories
        cards,
        categories: list(params.categories).map(c => clean(typeof c === "string" ? c : c.label, 120)).filter(Boolean),
        submissions: [], // [{ participant, groups:[{category, cards:[]}] }]
        createdAt: Date.now(),
      };
      arr(x.sorts, uid(ctx)).unshift(study);
      save();
      return { ok: true, result: { study } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "submitCardSort", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const study = arr(x.sorts, uid(ctx)).find(s => s.id === params.studyId);
      if (!study) return { ok: false, error: "study not found" };
      const groups = list(params.groups).map(g => ({
        category: clean(g.category, 120),
        cards: list(g.cards).map(c => clean(c, 120)).filter(Boolean),
      })).filter(g => g.category && g.cards.length);
      if (!groups.length) return { ok: false, error: "no card groups submitted" };
      study.submissions.push({
        participant: clean(params.participant || "Anonymous", 120),
        groups,
        at: Date.now(),
      });
      save();
      return { ok: true, result: { studyId: study.id, submissionCount: study.submissions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "cardSortResults", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const study = arr(x.sorts, uid(ctx)).find(s => s.id === params.studyId);
      if (!study) return { ok: false, error: "study not found" };
      const subs = study.submissions;
      // category popularity
      const catCount = {};
      // card -> category vote tally
      const cardCat = {};
      for (const card of study.cards) cardCat[card] = {};
      for (const sub of subs) {
        for (const g of sub.groups) {
          catCount[g.category] = (catCount[g.category] || 0) + 1;
          for (const card of g.cards) {
            if (!cardCat[card]) cardCat[card] = {};
            cardCat[card][g.category] = (cardCat[card][g.category] || 0) + 1;
          }
        }
      }
      // per-card agreement: most-common category share
      const cardAgreement = study.cards.map(card => {
        const votes = Object.entries(cardCat[card] || {});
        const totalVotes = votes.reduce((s, [, v]) => s + v, 0);
        const top = votes.sort((a, b) => b[1] - a[1])[0];
        return {
          card,
          topCategory: top ? top[0] : null,
          agreement: totalVotes && top ? Math.round((top[1] / totalVotes) * 100) : 0,
          votes: totalVotes,
        };
      });
      const overallAgreement = cardAgreement.length
        ? Math.round(cardAgreement.reduce((s, c) => s + c.agreement, 0) / cardAgreement.length)
        : 0;
      const popularCategories = Object.entries(catCount)
        .sort((a, b) => b[1] - a[1])
        .map(([category, uses]) => ({ category, uses }));
      return {
        ok: true,
        result: {
          studyId: study.id,
          name: study.name,
          kind: study.kind,
          submissions: subs.length,
          overallAgreement,
          cardAgreement,
          popularCategories,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 4. Survey builder with branching logic + NPS/CSAT templates
  //    questions: [{ id, kind, prompt, options?, branch?:{ answer -> goToId } }]
  //    kinds: single | multi | nps | csat | text | rating
  // ════════════════════════════════════════════════════════════════════
  const SURVEY_TEMPLATES = {
    nps: [
      { kind: "nps", prompt: "How likely are you to recommend us to a friend or colleague?" },
      { kind: "text", prompt: "What is the primary reason for your score?" },
    ],
    csat: [
      { kind: "csat", prompt: "How satisfied are you with your experience?" },
      { kind: "text", prompt: "What could we do to improve?" },
    ],
    ces: [
      { kind: "rating", prompt: "How easy was it to complete your task?", options: ["Very hard", "Hard", "Neutral", "Easy", "Very easy"] },
      { kind: "text", prompt: "Tell us more about your effort." },
    ],
  };

  registerLensAction("experience", "surveyTemplates", (_ctx, _a, _params = {}) => {
    return {
      ok: true,
      result: {
        templates: Object.entries(SURVEY_TEMPLATES).map(([id, questions]) => ({
          id,
          label: id.toUpperCase(),
          questionCount: questions.length,
        })),
      },
    };
  });

  registerLensAction("experience", "createSurvey", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      let rawQuestions = list(params.questions);
      if (!rawQuestions.length && params.template && SURVEY_TEMPLATES[params.template]) {
        rawQuestions = SURVEY_TEMPLATES[params.template];
      }
      const questions = rawQuestions.map((q, i) => ({
        id: q.id || gid("q"),
        order: i,
        kind: ["single", "multi", "nps", "csat", "text", "rating"].includes(q.kind) ? q.kind : "single",
        prompt: clean(q.prompt, 400),
        options: list(q.options).map(o => clean(o, 160)).filter(Boolean),
        branch: q.branch && typeof q.branch === "object" ? q.branch : null,
      })).filter(q => q.prompt);
      if (!questions.length) return { ok: false, error: "survey needs at least one question" };
      const survey = {
        id: gid("sv"),
        name: clean(params.name || "Untitled survey", 160),
        template: params.template && SURVEY_TEMPLATES[params.template] ? params.template : null,
        questions,
        createdAt: Date.now(),
      };
      arr(x.surveys, uid(ctx)).unshift(survey);
      save();
      return { ok: true, result: { survey } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listSurveys", (ctx, _a, _params = {}) => {
    try {
      const x = xState();
      const surveys = arr(x.surveys, uid(ctx));
      const responses = arr(x.responses, uid(ctx));
      const withStats = surveys.map(s => ({
        ...s,
        responseCount: responses.filter(r => r.surveyId === s.id).length,
      }));
      return { ok: true, result: { surveys: withStats, count: withStats.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Resolve the next question given an answer + branching rules.
  registerLensAction("experience", "surveyNext", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const survey = arr(x.surveys, uid(ctx)).find(s => s.id === params.surveyId);
      if (!survey) return { ok: false, error: "survey not found" };
      const idx = survey.questions.findIndex(q => q.id === params.questionId);
      if (idx < 0) return { ok: false, error: "question not found" };
      const q = survey.questions[idx];
      const ans = clean(params.answer, 200);
      let nextId = null;
      if (q.branch && q.branch[ans]) nextId = q.branch[ans];
      let next;
      if (nextId) next = survey.questions.find(qq => qq.id === nextId) || null;
      else next = survey.questions[idx + 1] || null;
      return { ok: true, result: { next, done: !next } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "submitSurveyResponse", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const survey = arr(x.surveys, uid(ctx)).find(s => s.id === params.surveyId);
      if (!survey) return { ok: false, error: "survey not found" };
      const answers = {};
      const submitted = params.answers && typeof params.answers === "object" ? params.answers : {};
      for (const q of survey.questions) {
        if (q.id in submitted) answers[q.id] = submitted[q.id];
      }
      const response = {
        id: gid("sr"),
        surveyId: survey.id,
        respondent: clean(params.respondent || "Anonymous", 120),
        answers,
        at: Date.now(),
      };
      arr(x.responses, uid(ctx)).unshift(response);
      save();
      return { ok: true, result: { response, responseCount: arr(x.responses, uid(ctx)).filter(r => r.surveyId === survey.id).length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "surveyResults", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const survey = arr(x.surveys, uid(ctx)).find(s => s.id === params.surveyId);
      if (!survey) return { ok: false, error: "survey not found" };
      const responses = arr(x.responses, uid(ctx)).filter(r => r.surveyId === survey.id);
      const perQuestion = survey.questions.map(q => {
        const vals = responses.map(r => r.answers[q.id]).filter(v => v !== undefined && v !== null && v !== "");
        const out = { questionId: q.id, prompt: q.prompt, kind: q.kind, answered: vals.length };
        if (q.kind === "nps") {
          const scores = vals.map(v => num(v)).filter(v => v >= 0 && v <= 10);
          const promoters = scores.filter(v => v >= 9).length;
          const detractors = scores.filter(v => v <= 6).length;
          out.nps = scores.length ? Math.round(((promoters - detractors) / scores.length) * 100) : 0;
          out.promoters = promoters;
          out.passives = scores.length - promoters - detractors;
          out.detractors = detractors;
        } else if (q.kind === "csat" || q.kind === "rating") {
          const scores = vals.map(v => num(v)).filter(Number.isFinite);
          out.avgScore = scores.length ? Math.round((scores.reduce((s, v) => s + v, 0) / scores.length) * 10) / 10 : 0;
          const top = q.kind === "csat" ? 5 : (q.options.length || 5);
          const satisfied = scores.filter(v => v >= top - 1).length;
          out.satisfactionPct = scores.length ? Math.round((satisfied / scores.length) * 100) : 0;
        } else if (q.kind === "single" || q.kind === "multi") {
          const tally = {};
          for (const v of vals) {
            for (const item of (Array.isArray(v) ? v : [v])) {
              const k = clean(item, 160);
              tally[k] = (tally[k] || 0) + 1;
            }
          }
          out.distribution = Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([option, count]) => ({ option, count }));
        } else {
          out.samples = vals.slice(0, 25).map(v => clean(v, 400));
        }
        return out;
      });
      return {
        ok: true,
        result: { surveyId: survey.id, name: survey.name, responseCount: responses.length, perQuestion },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 5. Participant recruitment / panel + screener questionnaires
  //    A panel of recruited participants. A screener is a set of
  //    criteria; matchPanel returns participants that satisfy all rules.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "addParticipant", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const name = clean(params.name, 120);
      if (!name) return { ok: false, error: "participant name required" };
      const participant = {
        id: gid("pp"),
        name,
        email: clean(params.email, 200),
        // arbitrary screener attributes, e.g. { age: 34, device: "mobile", role: "designer" }
        attributes: params.attributes && typeof params.attributes === "object" ? params.attributes : {},
        tags: list(params.tags).map(t => clean(t, 60)).filter(Boolean),
        status: "available",
        invitedCount: 0,
        addedAt: Date.now(),
      };
      arr(x.panel, uid(ctx)).unshift(participant);
      save();
      return { ok: true, result: { participant } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listPanel", (ctx, _a, _params = {}) => {
    try {
      const x = xState();
      const panel = arr(x.panel, uid(ctx));
      return {
        ok: true,
        result: {
          panel,
          count: panel.length,
          available: panel.filter(p => p.status === "available").length,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // Screener: rules = [{ attribute, op, value }] ; op in eq|neq|gte|lte|in
  registerLensAction("experience", "screenPanel", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const panel = arr(x.panel, uid(ctx));
      const rules = list(params.rules).map(r => ({
        attribute: clean(r.attribute, 60),
        op: ["eq", "neq", "gte", "lte", "in"].includes(r.op) ? r.op : "eq",
        value: r.value,
      })).filter(r => r.attribute);
      const passes = (p, rule) => {
        const v = p.attributes ? p.attributes[rule.attribute] : undefined;
        switch (rule.op) {
          case "eq": return String(v) === String(rule.value);
          case "neq": return String(v) !== String(rule.value);
          case "gte": return num(v) >= num(rule.value);
          case "lte": return num(v) <= num(rule.value);
          case "in": return list(rule.value).map(String).includes(String(v));
          default: return false;
        }
      };
      const matched = panel.filter(p => rules.every(r => passes(p, r)));
      return {
        ok: true,
        result: {
          rules,
          matched,
          matchCount: matched.length,
          totalPanel: panel.length,
          qualifyRate: panel.length ? Math.round((matched.length / panel.length) * 100) : 0,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "inviteParticipants", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const panel = arr(x.panel, uid(ctx));
      const ids = list(params.participantIds).map(String);
      let invited = 0;
      for (const p of panel) {
        if (ids.includes(p.id)) {
          p.status = "invited";
          p.invitedCount = (p.invitedCount || 0) + 1;
          p.lastInvitedTo = clean(params.studyName, 160) || p.lastInvitedTo || null;
          invited += 1;
        }
      }
      if (!invited) return { ok: false, error: "no matching participants to invite" };
      save();
      return { ok: true, result: { invited, studyName: clean(params.studyName, 160) } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 6. Highlight reels / clip sharing from session recordings
  //    A clip = a labelled time-range cut from a usability run, with a
  //    shareable token. A reel = an ordered set of clips.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "createClip", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const runId = clean(params.runId, 80);
      if (!runId) return { ok: false, error: "runId required" };
      const startMs = Math.max(0, num(params.startMs));
      const endMs = Math.max(startMs + 1, num(params.endMs, startMs + 1000));
      const clip = {
        id: gid("clip"),
        runId,
        taskId: clean(params.taskId, 80),
        label: clean(params.label || "Highlight", 200),
        note: clean(params.note, 600),
        startMs,
        endMs,
        durationMs: endMs - startMs,
        sentiment: ["positive", "neutral", "negative"].includes(params.sentiment) ? params.sentiment : "neutral",
        shareToken: gid("share"),
        createdAt: Date.now(),
      };
      arr(x.clips, uid(ctx)).unshift(clip);
      save();
      return {
        ok: true,
        result: { clip, shareUrl: `/share/clip/${clip.shareToken}` },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listClips", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      let clips = arr(x.clips, uid(ctx));
      if (params.runId) clips = clips.filter(c => c.runId === params.runId);
      const bySentiment = { positive: 0, neutral: 0, negative: 0 };
      for (const c of clips) bySentiment[c.sentiment] = (bySentiment[c.sentiment] || 0) + 1;
      return {
        ok: true,
        result: {
          clips,
          count: clips.length,
          bySentiment,
          totalDurationMs: clips.reduce((s, c) => s + c.durationMs, 0),
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "buildReel", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const all = arr(x.clips, uid(ctx));
      const ids = list(params.clipIds).map(String);
      const ordered = ids.map(id => all.find(c => c.id === id)).filter(Boolean);
      if (!ordered.length) return { ok: false, error: "no clips selected for reel" };
      const reel = {
        id: gid("reel"),
        name: clean(params.name || "Highlight reel", 160),
        clips: ordered,
        clipCount: ordered.length,
        totalDurationMs: ordered.reduce((s, c) => s + c.durationMs, 0),
        shareToken: gid("share"),
      };
      return { ok: true, result: { reel, shareUrl: `/share/reel/${reel.shareToken}` } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  // ════════════════════════════════════════════════════════════════════
  // 7. Prototype embed (Figma) with interaction analytics overlay
  //    Register an embedded prototype URL, record interaction events on
  //    its frames, and aggregate a funnel + hotspot analytics overlay.
  // ════════════════════════════════════════════════════════════════════
  registerLensAction("experience", "createPrototype", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const embedUrl = clean(params.embedUrl, 600);
      if (!embedUrl) return { ok: false, error: "embedUrl required" };
      const frames = list(params.frames).map((f, i) => ({
        id: f.id || gid("frame"),
        order: i,
        name: clean(typeof f === "string" ? f : f.name, 160) || `Frame ${i + 1}`,
      }));
      const proto = {
        id: gid("proto"),
        name: clean(params.name || "Prototype", 160),
        provider: clean(params.provider || "figma", 40),
        embedUrl,
        frames,
        interactions: [], // [{ frameId, kind, x, y, t, fromFrame }]
        createdAt: Date.now(),
      };
      arr(x.protos, uid(ctx)).unshift(proto);
      save();
      return { ok: true, result: { prototype: proto } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "listPrototypes", (ctx, _a, _params = {}) => {
    try {
      const x = xState();
      const protos = arr(x.protos, uid(ctx)).map(p => ({
        ...p,
        interactionCount: p.interactions.length,
      }));
      return { ok: true, result: { prototypes: protos, count: protos.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "recordInteraction", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const proto = arr(x.protos, uid(ctx)).find(p => p.id === params.prototypeId);
      if (!proto) return { ok: false, error: "prototype not found" };
      proto.interactions.push({
        frameId: clean(params.frameId, 80),
        kind: clean(params.kind || "tap", 32),
        x: Math.min(1, Math.max(0, num(params.x))),
        y: Math.min(1, Math.max(0, num(params.y))),
        fromFrame: clean(params.fromFrame, 80),
        misclick: !!params.misclick,
        t: Date.now(),
      });
      save();
      return { ok: true, result: { prototypeId: proto.id, interactionCount: proto.interactions.length } };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });

  registerLensAction("experience", "prototypeAnalytics", (ctx, _a, params = {}) => {
    try {
      const x = xState();
      const proto = arr(x.protos, uid(ctx)).find(p => p.id === params.prototypeId);
      if (!proto) return { ok: false, error: "prototype not found" };
      const ix = proto.interactions;
      // funnel: how many interactions reach each frame (by order)
      const funnel = proto.frames.map(f => {
        const onFrame = ix.filter(i => i.frameId === f.id);
        return {
          frameId: f.id,
          name: f.name,
          order: f.order,
          interactions: onFrame.length,
          misclicks: onFrame.filter(i => i.misclick).length,
        };
      });
      // hotspots: 6x6 click density per frame
      const G = 6;
      const hotspots = proto.frames.map(f => {
        const grid = Array.from({ length: G }, () => new Array(G).fill(0));
        for (const i of ix.filter(e => e.frameId === f.id)) {
          const gx = Math.min(G - 1, Math.floor(i.x * G));
          const gy = Math.min(G - 1, Math.floor(i.y * G));
          grid[gy][gx] += 1;
        }
        return { frameId: f.id, name: f.name, grid };
      });
      const totalIx = ix.length;
      const totalMisclicks = ix.filter(i => i.misclick).length;
      return {
        ok: true,
        result: {
          prototypeId: proto.id,
          name: proto.name,
          totalInteractions: totalIx,
          misclickRate: totalIx ? Math.round((totalMisclicks / totalIx) * 100) : 0,
          funnel,
          hotspots,
        },
      };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  });
}
