// server/domains/mentalhealth.js
//
// Pure-compute mental-health helpers (mood tracking, coping strategies,
// wellness score, journal prompts) plus authoritative crisis hotline
// reference + real CDC BRFSS mental-health prevalence data.

export default function registerMentalhealthActions(registerLensAction) {
  registerLensAction("mental-health", "moodTracker", (ctx, artifact, _params) => { const entries = artifact.data?.entries || []; if (entries.length === 0) return { ok: true, result: { message: "Log mood entries to track patterns." } }; const scores = entries.map(e => parseInt(e.mood || e.score) || 5); const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length * 10) / 10; const trend = scores.length >= 3 ? (scores[scores.length-1] > scores[0] ? "improving" : scores[scores.length-1] < scores[0] ? "declining" : "stable") : "insufficient-data"; return { ok: true, result: { entries: scores.length, avgMood: avg, trend, lowest: Math.min(...scores), highest: Math.max(...scores), variance: Math.round(Math.sqrt(scores.reduce((s,v) => s + Math.pow(v-avg,2),0)/scores.length)*10)/10 } }; });
  registerLensAction("mental-health", "copingStrategies", (ctx, artifact, _params) => { const triggers = artifact.data?.triggers || []; const strategies = { anxiety: ["Deep breathing (4-7-8)", "Progressive muscle relaxation", "Grounding (5-4-3-2-1 senses)", "Journaling"], depression: ["Physical activity", "Social connection", "Routine building", "Gratitude practice"], stress: ["Time management", "Boundary setting", "Mindfulness meditation", "Nature walk"], anger: ["Timeout technique", "Counting to 10", "Physical exercise", "Writing it out"], grief: ["Allow the feelings", "Memory sharing", "Support group", "Self-compassion"] }; const matched = triggers.flatMap(t => strategies[(t.type || t).toLowerCase()] || strategies.stress); return { ok: true, result: { triggers: triggers.length, strategies: [...new Set(matched)], categories: Object.keys(strategies), note: "These are general wellness suggestions, not medical advice" } }; });
  registerLensAction("mental-health", "wellnessScore", (ctx, artifact, _params) => { const data = artifact.data || {}; const sleep = parseFloat(data.sleepHours) || 7; const exercise = parseFloat(data.exerciseMinutes) || 0; const social = parseInt(data.socialInteractions) || 0; const mood = parseInt(data.moodScore) || 5; const score = Math.min(100, Math.round(Math.min(sleep/8,1)*25 + Math.min(exercise/30,1)*25 + Math.min(social/3,1)*25 + (mood/10)*25)); return { ok: true, result: { wellnessScore: score, breakdown: { sleep: `${sleep}h (target: 7-9h)`, exercise: `${exercise}min (target: 30min)`, social: `${social} interactions`, mood: `${mood}/10` }, areas: score < 60 ? [sleep < 7 ? "Improve sleep" : null, exercise < 20 ? "Increase activity" : null, social < 2 ? "Reach out to someone" : null].filter(Boolean) : ["Keep up the good work"] } }; });
  registerLensAction("mental-health", "journalPrompt", (ctx, artifact, _params) => { const mood = (artifact.data?.currentMood || "neutral").toLowerCase(); const prompts = { happy: ["What made today great?", "Who contributed to your happiness?", "How can you create more moments like this?"], sad: ["What are you feeling right now?", "What would you tell a friend feeling this way?", "Name three things you are grateful for"], anxious: ["What is within your control right now?", "What would your future self say about this?", "Describe your safe place in detail"], neutral: ["What are you looking forward to?", "What did you learn today?", "Describe your ideal tomorrow"], angry: ["What boundary was crossed?", "What need is not being met?", "How would you handle this differently next time?"] }; const selected = prompts[mood] || prompts.neutral; return { ok: true, result: { mood, prompts: selected, instruction: "Write freely for 10 minutes without judgment", reminder: "Journaling is for you — there are no wrong answers" } }; });

  /**
   * crisis-hotlines — Authoritative US + international crisis hotline
   * reference. Stable static data from 988lifeline.org and verified
   * national hotline registries — these are real published contacts,
   * not synthesized. Verified 2026-05-16.
   *
   * params: { country?: ISO-2 (default "US") }
   */
  registerLensAction("mental-health", "crisis-hotlines", (_ctx, _artifact, params = {}) => {
    const country = String(params.country || "US").toUpperCase();
    const HOTLINES = {
      US: {
        primary: { name: "988 Suicide and Crisis Lifeline", phone: "988", text: "988", chat: "https://988lifeline.org/chat/", availability: "24/7", languages: ["en", "es"] },
        veterans: { name: "Veterans Crisis Line", phone: "988 + Press 1", text: "838255", chat: "https://www.veteranscrisisline.net/get-help-now/chat/" },
        spanish: { name: "Línea de Vida 988", phone: "988 + Press 2", url: "https://988lineadevida.org" },
        lgbtq: { name: "Trevor Project (LGBTQ+ youth)", phone: "1-866-488-7386", text: "678-678", chat: "https://www.thetrevorproject.org/get-help/" },
        trans: { name: "Trans Lifeline", phone: "877-565-8860" },
        domestic: { name: "National Domestic Violence Hotline", phone: "1-800-799-7233", text: "Text START to 88788", chat: "https://www.thehotline.org/" },
        sa: { name: "RAINN National Sexual Assault Hotline", phone: "1-800-656-4673", chat: "https://hotline.rainn.org/online" },
        teen: { name: "Crisis Text Line (teens)", text: "Text HOME to 741741" },
      },
      UK: {
        primary: { name: "Samaritans", phone: "116 123", availability: "24/7" },
        nhs: { name: "NHS 111 (mental health option)", phone: "111" },
      },
      CA: {
        primary: { name: "9-8-8 Suicide Crisis Helpline", phone: "988", text: "988", availability: "24/7" },
        kids: { name: "Kids Help Phone", phone: "1-800-668-6868", text: "Text CONNECT to 686868" },
      },
      AU: {
        primary: { name: "Lifeline Australia", phone: "13 11 14", chat: "https://www.lifeline.org.au/crisis-chat/" },
        kids: { name: "Kids Helpline", phone: "1800 55 1800" },
      },
    };
    const hotlines = HOTLINES[country];
    if (!hotlines) {
      return {
        ok: true,
        result: {
          country, available: false,
          fallback: "Visit https://findahelpline.com to find verified crisis hotlines for your country.",
          source: "concord-mental-health-reference",
        },
      };
    }
    return {
      ok: true,
      result: {
        country, available: true, hotlines,
        disclaimer: "If you or someone you know is in immediate danger, call your local emergency number (911 US, 999 UK, 112 EU). This is not medical advice.",
        source: "988lifeline.org + verified national hotline registries",
      },
    };
  });

  /**
   * cdc-mental-health-stats — Real CDC PLACES mental-health prevalence
   * data (BRFSS Frequent Mental Distress + Depression). Free via
   * data.cdc.gov SODA API, no key required.
   *
   * params: { year?: 2014+, locationAbbr?: 2-letter US state (default "US") }
   */
  registerLensAction("mental-health", "cdc-mental-health-stats", async (_ctx, _artifact, params = {}) => {
    const year = Number(params.year) || new Date().getFullYear() - 2;
    const stateAbbr = String(params.locationAbbr || "US").toUpperCase();
    if (!/^[A-Z]{2}$/.test(stateAbbr)) return { ok: false, error: "locationAbbr must be 2-letter code (e.g. 'CA', 'US' for national)" };
    try {
      const url = `https://data.cdc.gov/resource/dttw-5yxu.json?$where=year='${year}' AND stateabbr='${stateAbbr}'&$select=year,stateabbr,statedesc,measureid,data_value,low_confidence_limit,high_confidence_limit&$limit=200`;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`cdc ${r.status}`);
      const data = await r.json();
      const measures = (Array.isArray(data) ? data : [])
        .filter((row) => row.measureid === "MHLTH" || row.measureid === "DEPRESSION")
        .map((row) => ({
          measure: row.measureid === "MHLTH" ? "frequent-mental-distress" : "depression-prevalence",
          value: parseFloat(row.data_value),
          confidenceLow: parseFloat(row.low_confidence_limit),
          confidenceHigh: parseFloat(row.high_confidence_limit),
          stateName: row.statedesc,
        }));
      return {
        ok: true,
        result: {
          year, stateAbbr, measures, count: measures.length,
          disclaimer: "BRFSS is a self-reported survey; figures are estimates with confidence intervals. Not a clinical diagnosis dataset.",
          source: "cdc-brfss-places",
        },
      };
    } catch (e) {
      return { ok: false, error: `cdc unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  // ─── Calm + Headspace 2026 parity — mindfulness companion ───────────
  // Meditation sessions, courses, mood + sleep tracking, breathing
  // exercises, gratitude journaling, streaks. Not medical advice.

  function getMhState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.mentalHealthLens) STATE.mentalHealthLens = {};
    const s = STATE.mentalHealthLens;
    for (const k of ["sessions", "courses", "moods", "breathing", "sleep", "gratitude", "goal"]) {
      if (!(s[k] instanceof Map)) s[k] = new Map();
    }
    return s;
  }
  function saveMhState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const mhId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const mhNow = () => new Date().toISOString();
  const mhAid = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const mhListB = (map, k) => { if (!map.has(k)) map.set(k, []); return map.get(k); };
  const mhNum = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const mhClean = (v, max = 500) => String(v == null ? "" : v).trim().slice(0, max);
  const mhDay = (v) => mhClean(v, 10).slice(0, 10);
  const MH_DAY = 86400000;
  const SESSION_TYPES = ["meditation", "sleep", "breathing", "focus", "body_scan", "movement"];

  // Real evidence-based breathing patterns (seconds per phase).
  const BREATHING_PATTERNS = [
    { id: "box", name: "Box breathing", inhale: 4, hold1: 4, exhale: 4, hold2: 4, use: "Calm under acute stress" },
    { id: "478", name: "4-7-8 breathing", inhale: 4, hold1: 7, exhale: 8, hold2: 0, use: "Falling asleep" },
    { id: "coherent", name: "Coherent breathing", inhale: 5.5, hold1: 0, exhale: 5.5, hold2: 0, use: "Heart-rate variability" },
    { id: "equal", name: "Equal breathing", inhale: 4, hold1: 0, exhale: 4, hold2: 0, use: "Everyday balance" },
    { id: "physiological_sigh", name: "Physiological sigh", inhale: 2, hold1: 1, exhale: 6, hold2: 0, use: "Fast stress relief" },
  ];

  function streakFromDates(dateset) {
    if (!dateset.size) return 0;
    let streak = 0;
    const d = new Date();
    if (!dateset.has(d.toISOString().slice(0, 10))) d.setUTCDate(d.getUTCDate() - 1);
    while (dateset.has(d.toISOString().slice(0, 10))) { streak += 1; d.setUTCDate(d.getUTCDate() - 1); }
    return streak;
  }

  // ── Meditation sessions ─────────────────────────────────────────────
  registerLensAction("mental-health", "session-log", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const type = SESSION_TYPES.includes(String(params.type).toLowerCase())
      ? String(params.type).toLowerCase() : "meditation";
    const durationMin = Math.max(1, Math.round(mhNum(params.durationMin, 10)));
    const session = {
      id: mhId("ses"), type, durationMin,
      title: mhClean(params.title, 120) || null,
      notes: mhClean(params.notes, 500) || null,
      date: mhDay(params.date) || mhDay(mhNow()),
      at: mhNow(),
    };
    mhListB(s.sessions, mhAid(ctx)).push(session);
    saveMhState();
    return { ok: true, result: { session } };
  });

  registerLensAction("mental-health", "session-history", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let sessions = [...(s.sessions.get(mhAid(ctx)) || [])];
    if (params.type) sessions = sessions.filter((x) => x.type === String(params.type).toLowerCase());
    sessions.sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { sessions: sessions.slice(0, 60), count: sessions.length } };
  });

  registerLensAction("mental-health", "session-stats", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = s.sessions.get(mhAid(ctx)) || [];
    const totalMin = sessions.reduce((a, x) => a + x.durationMin, 0);
    const byType = {};
    for (const x of sessions) byType[x.type] = (byType[x.type] || 0) + x.durationMin;
    const streak = streakFromDates(new Set(sessions.map((x) => x.date)));
    return {
      ok: true,
      result: { totalSessions: sessions.length, totalMinutes: totalMin, byType, streak },
    };
  });

  registerLensAction("mental-health", "mindfulness-minutes", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = s.sessions.get(mhAid(ctx)) || [];
    const weekAgo = new Date(Date.now() - 7 * MH_DAY).toISOString().slice(0, 10);
    const today = mhDay(mhNow());
    return {
      ok: true,
      result: {
        allTime: sessions.reduce((a, x) => a + x.durationMin, 0),
        thisWeek: sessions.filter((x) => x.date >= weekAgo).reduce((a, x) => a + x.durationMin, 0),
        today: sessions.filter((x) => x.date === today).reduce((a, x) => a + x.durationMin, 0),
      },
    };
  });

  // ── Courses ─────────────────────────────────────────────────────────
  registerLensAction("mental-health", "course-create", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = mhClean(params.name, 120);
    if (!name) return { ok: false, error: "course name required" };
    const course = {
      id: mhId("crs"), name,
      category: mhClean(params.category, 40).toLowerCase() || "foundations",
      totalSessions: Math.max(1, Math.round(mhNum(params.totalSessions, 10))),
      completedSessions: 0, createdAt: mhNow(),
    };
    mhListB(s.courses, mhAid(ctx)).push(course);
    saveMhState();
    return { ok: true, result: { course } };
  });

  registerLensAction("mental-health", "course-list", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const courses = (s.courses.get(mhAid(ctx)) || []).map((c) => ({
      ...c,
      progressPct: Math.round((c.completedSessions / c.totalSessions) * 100),
      complete: c.completedSessions >= c.totalSessions,
    }));
    return { ok: true, result: { courses, count: courses.length } };
  });

  registerLensAction("mental-health", "course-detail", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const course = (s.courses.get(mhAid(ctx)) || []).find((c) => c.id === params.id);
    if (!course) return { ok: false, error: "course not found" };
    return {
      ok: true,
      result: {
        course: {
          ...course,
          progressPct: Math.round((course.completedSessions / course.totalSessions) * 100),
          complete: course.completedSessions >= course.totalSessions,
        },
      },
    };
  });

  registerLensAction("mental-health", "course-complete-session", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mhAid(ctx);
    const course = (s.courses.get(userId) || []).find((c) => c.id === params.id);
    if (!course) return { ok: false, error: "course not found" };
    if (course.completedSessions >= course.totalSessions) {
      return { ok: false, error: "course already complete" };
    }
    course.completedSessions += 1;
    // a completed course session also counts as a meditation session
    mhListB(s.sessions, userId).push({
      id: mhId("ses"), type: "meditation",
      durationMin: Math.max(1, Math.round(mhNum(params.durationMin, 10))),
      title: `${course.name} — session ${course.completedSessions}`,
      notes: null, date: mhDay(mhNow()), at: mhNow(),
    });
    saveMhState();
    return {
      ok: true,
      result: {
        course, complete: course.completedSessions >= course.totalSessions,
        progressPct: Math.round((course.completedSessions / course.totalSessions) * 100),
      },
    };
  });

  registerLensAction("mental-health", "course-delete", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = s.courses.get(mhAid(ctx)) || [];
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "course not found" };
    arr.splice(i, 1);
    saveMhState();
    return { ok: true, result: { deleted: params.id } };
  });

  // ── Mood ────────────────────────────────────────────────────────────
  registerLensAction("mental-health", "mood-log", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const mood = Math.round(mhNum(params.mood));
    if (mood < 1 || mood > 5) return { ok: false, error: "mood must be 1–5" };
    const entry = {
      id: mhId("mood"), mood,
      energy: Math.max(0, Math.min(5, Math.round(mhNum(params.energy)))) || null,
      label: mhClean(params.label, 40).toLowerCase() || null,
      note: mhClean(params.note, 500) || null,
      date: mhDay(params.date) || mhDay(mhNow()),
      at: mhNow(),
    };
    mhListB(s.moods, mhAid(ctx)).push(entry);
    saveMhState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("mental-health", "mood-history", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Math.round(mhNum(params.days, 30))));
    const cutoff = new Date(Date.now() - days * MH_DAY).toISOString().slice(0, 10);
    const series = (s.moods.get(mhAid(ctx)) || [])
      .filter((m) => m.date >= cutoff)
      .sort((a, b) => a.at.localeCompare(b.at));
    return { ok: true, result: { series, count: series.length } };
  });

  registerLensAction("mental-health", "mood-insights", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const moods = (s.moods.get(mhAid(ctx)) || []).slice().sort((a, b) => a.at.localeCompare(b.at));
    if (!moods.length) return { ok: true, result: { entries: 0, average: null, trend: "no_data", distribution: {} } };
    const avg = moods.reduce((a, m) => a + m.mood, 0) / moods.length;
    const distribution = {};
    for (let i = 1; i <= 5; i++) distribution[i] = moods.filter((m) => m.mood === i).length;
    let trend = "stable";
    if (moods.length >= 4) {
      const half = Math.floor(moods.length / 2);
      const early = moods.slice(0, half).reduce((a, m) => a + m.mood, 0) / half;
      const late = moods.slice(half).reduce((a, m) => a + m.mood, 0) / (moods.length - half);
      trend = late > early + 0.3 ? "improving" : late < early - 0.3 ? "declining" : "stable";
    }
    return {
      ok: true,
      result: { entries: moods.length, average: Math.round(avg * 100) / 100, trend, distribution },
    };
  });

  // ── Breathing ───────────────────────────────────────────────────────
  registerLensAction("mental-health", "breathing-patterns", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { patterns: BREATHING_PATTERNS } };
  });

  registerLensAction("mental-health", "breathing-log", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const pattern = BREATHING_PATTERNS.find((p) => p.id === String(params.patternId));
    if (!pattern) return { ok: false, error: "unknown breathing pattern" };
    const rounds = Math.max(1, Math.round(mhNum(params.rounds, 5)));
    const cycleSec = pattern.inhale + pattern.hold1 + pattern.exhale + pattern.hold2;
    const entry = {
      id: mhId("brt"), patternId: pattern.id, patternName: pattern.name,
      rounds, durationSec: Math.round(cycleSec * rounds),
      date: mhDay(mhNow()), at: mhNow(),
    };
    mhListB(s.breathing, mhAid(ctx)).push(entry);
    saveMhState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("mental-health", "breathing-stats", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = s.breathing.get(mhAid(ctx)) || [];
    const byPattern = {};
    for (const e of list) byPattern[e.patternName] = (byPattern[e.patternName] || 0) + 1;
    return {
      ok: true,
      result: {
        sessions: list.length,
        totalMinutes: Math.round(list.reduce((a, e) => a + e.durationSec, 0) / 60),
        byPattern,
      },
    };
  });

  // ── Sleep ───────────────────────────────────────────────────────────
  registerLensAction("mental-health", "sleep-log", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const hoursSlept = mhNum(params.hoursSlept);
    if (hoursSlept <= 0 || hoursSlept > 24) return { ok: false, error: "hoursSlept must be 0–24" };
    const entry = {
      id: mhId("slp"),
      hoursSlept: Math.round(hoursSlept * 10) / 10,
      quality: Math.max(1, Math.min(5, Math.round(mhNum(params.quality, 3)))),
      bedtime: mhClean(params.bedtime, 5) || null,
      wakeTime: mhClean(params.wakeTime, 5) || null,
      date: mhDay(params.date) || mhDay(mhNow()),
      at: mhNow(),
    };
    mhListB(s.sleep, mhAid(ctx)).push(entry);
    saveMhState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("mental-health", "sleep-history", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const days = Math.max(1, Math.min(365, Math.round(mhNum(params.days, 14))));
    const cutoff = new Date(Date.now() - days * MH_DAY).toISOString().slice(0, 10);
    const series = (s.sleep.get(mhAid(ctx)) || [])
      .filter((x) => x.date >= cutoff)
      .sort((a, b) => a.date.localeCompare(b.date));
    const avgHours = series.length ? Math.round((series.reduce((a, x) => a + x.hoursSlept, 0) / series.length) * 10) / 10 : null;
    const avgQuality = series.length ? Math.round((series.reduce((a, x) => a + x.quality, 0) / series.length) * 10) / 10 : null;
    return { ok: true, result: { series, avgHours, avgQuality, nights: series.length } };
  });

  // ── Gratitude journal ───────────────────────────────────────────────
  registerLensAction("mental-health", "gratitude-add", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const items = Array.isArray(params.entries)
      ? params.entries.map((x) => mhClean(x, 200)).filter(Boolean).slice(0, 10) : [];
    if (!items.length) return { ok: false, error: "at least one gratitude entry required" };
    const entry = { id: mhId("grt"), items, date: mhDay(mhNow()), at: mhNow() };
    mhListB(s.gratitude, mhAid(ctx)).push(entry);
    saveMhState();
    return { ok: true, result: { entry } };
  });

  registerLensAction("mental-health", "gratitude-list", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = [...(s.gratitude.get(mhAid(ctx)) || [])].sort((a, b) => b.at.localeCompare(a.at));
    return { ok: true, result: { entries, count: entries.length } };
  });

  // ── Goal ────────────────────────────────────────────────────────────
  registerLensAction("mental-health", "goal-set", (ctx, _a, params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const dailyMinutes = Math.max(1, Math.round(mhNum(params.dailyMinutes, 10)));
    s.goal.set(mhAid(ctx), { dailyMinutes, updatedAt: mhNow() });
    saveMhState();
    return { ok: true, result: { dailyMinutes } };
  });

  registerLensAction("mental-health", "goal-status", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mhAid(ctx);
    const goal = s.goal.get(userId) || { dailyMinutes: 10 };
    const today = mhDay(mhNow());
    const todayMin = (s.sessions.get(userId) || [])
      .filter((x) => x.date === today)
      .reduce((a, x) => a + x.durationMin, 0);
    return {
      ok: true,
      result: {
        dailyMinutes: goal.dailyMinutes,
        todayMinutes: todayMin,
        pct: Math.round((todayMin / goal.dailyMinutes) * 100),
        met: todayMin >= goal.dailyMinutes,
        isDefault: !s.goal.has(userId),
      },
    };
  });

  // ── Dashboard ───────────────────────────────────────────────────────
  registerLensAction("mental-health", "wellness-dashboard", (ctx, _a, _params = {}) => {
    const s = getMhState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = mhAid(ctx);
    const sessions = s.sessions.get(userId) || [];
    const moods = s.moods.get(userId) || [];
    const sleep = s.sleep.get(userId) || [];
    const weekAgo = new Date(Date.now() - 7 * MH_DAY).toISOString().slice(0, 10);
    const recentMood = moods.length ? moods[moods.length - 1].mood : null;
    return {
      ok: true,
      result: {
        streak: streakFromDates(new Set(sessions.map((x) => x.date))),
        sessionsThisWeek: sessions.filter((x) => x.date >= weekAgo).length,
        minutesThisWeek: sessions.filter((x) => x.date >= weekAgo).reduce((a, x) => a + x.durationMin, 0),
        latestMood: recentMood,
        moodEntries: moods.length,
        avgSleepHours: sleep.length
          ? Math.round((sleep.slice(-7).reduce((a, x) => a + x.hoursSlept, 0) / Math.min(7, sleep.length)) * 10) / 10
          : null,
        activeCourses: (s.courses.get(userId) || []).filter((c) => c.completedSessions < c.totalSessions).length,
        gratitudeEntries: (s.gratitude.get(userId) || []).length,
      },
    };
  });
}
