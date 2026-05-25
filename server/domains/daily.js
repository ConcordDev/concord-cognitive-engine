// server/domains/daily.js
//
// Day One 2026-parity journaling. Pure-compute productivity helpers
// (daily summary, habit streaks, focus timer, weekly review) PLUS a
// real per-user journaling substrate: multiple journals, dated entries
// with mood + tags, on-this-day, search, mood trend and streaks.

export default function registerDailyActions(registerLensAction) {
  registerLensAction("daily", "dailySummary", (ctx, artifact, _params) => {
    const data = artifact.data || {};
    const entries = data.entries || [];
    const sessions = data.sessions || [];
    const tasks = data.tasks || [];
    const completedTasks = tasks.filter(t => t.completed || t.status === "completed").length;
    const totalMinutes = sessions.reduce((s, ses) => s + (parseInt(ses.duration) || 0), 0);
    const mood = data.mood !== undefined ? data.mood : null;
    return { ok: true, result: { date: data.date || new Date().toISOString().split("T")[0], entriesLogged: entries.length, sessionsCompleted: sessions.length, totalFocusMinutes: totalMinutes, tasksCompleted: completedTasks, totalTasks: tasks.length, completionRate: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0, mood: mood !== null ? mood : "not-recorded", productivityScore: Math.min(100, Math.round(completedTasks * 15 + totalMinutes / 5 + entries.length * 10)) } };
  });
  registerLensAction("daily", "habitStreak", (ctx, artifact, _params) => {
    const habits = artifact.data?.habits || [];
    const history = artifact.data?.history || [];
    const analyzed = habits.map(h => {
      const name = h.name || h;
      const completions = history.filter(d => (d.habits || []).includes(name));
      let currentStreak = 0; const now = new Date();
      for (let i = 0; i < 365; i++) { const date = new Date(now.getTime() - i * 86400000).toISOString().split("T")[0]; if (completions.some(c => c.date === date)) currentStreak++; else break; }
      return { habit: name, currentStreak, longestStreak: Math.max(currentStreak, parseInt(h.longestStreak) || 0), totalCompletions: completions.length, status: currentStreak >= 7 ? "strong" : currentStreak >= 3 ? "building" : currentStreak >= 1 ? "starting" : "broken" };
    });
    return { ok: true, result: { habits: analyzed, activeHabits: analyzed.filter(h => h.currentStreak > 0).length, totalHabits: habits.length, bestStreak: analyzed.sort((a, b) => b.currentStreak - a.currentStreak)[0] } };
  });
  registerLensAction("daily", "focusTimer", (ctx, artifact, _params) => {
    const sessions = artifact.data?.sessions || [];
    const today = new Date().toISOString().split("T")[0];
    const todaySessions = sessions.filter(s => (s.date || s.startedAt || "").startsWith(today));
    const totalMinutes = todaySessions.reduce((s, ses) => s + (parseInt(ses.duration) || 25), 0);
    const categories = {};
    for (const s of todaySessions) { const cat = s.category || s.project || "General"; categories[cat] = (categories[cat] || 0) + (parseInt(s.duration) || 25); }
    return { ok: true, result: { date: today, sessionsToday: todaySessions.length, totalMinutes, totalHours: Math.round(totalMinutes / 60 * 10) / 10, byCategory: categories, pomodorosCompleted: Math.floor(totalMinutes / 25), targetMinutes: 240, progress: Math.round((totalMinutes / 240) * 100) } };
  });
  registerLensAction("daily", "weeklyReview", (ctx, artifact, _params) => {
    const days = artifact.data?.days || [];
    if (days.length === 0) return { ok: true, result: { message: "Log daily data to generate weekly review." } };
    const totalTasks = days.reduce((s, d) => s + (parseInt(d.tasksCompleted) || 0), 0);
    const totalFocus = days.reduce((s, d) => s + (parseInt(d.focusMinutes) || 0), 0);
    const avgMood = days.filter(d => d.mood !== undefined).length > 0 ? Math.round(days.filter(d => d.mood !== undefined).reduce((s, d) => s + d.mood, 0) / days.filter(d => d.mood !== undefined).length * 10) / 10 : null;
    const bestDay = days.sort((a, b) => (b.tasksCompleted || 0) - (a.tasksCompleted || 0))[0];
    return { ok: true, result: { daysTracked: days.length, totalTasksCompleted: totalTasks, totalFocusMinutes: totalFocus, totalFocusHours: Math.round(totalFocus / 60 * 10) / 10, avgMood, bestDay: bestDay?.date || "N/A", avgTasksPerDay: Math.round(totalTasks / Math.max(days.length, 1) * 10) / 10, avgFocusPerDay: Math.round(totalFocus / Math.max(days.length, 1)) } };
  });

  // ─── Day One-shape journaling substrate (per-user, STATE-backed) ─────

  function getDailyState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.dailyLens) STATE.dailyLens = {};
    const s = STATE.dailyLens;
    if (!(s.journals instanceof Map)) s.journals = new Map(); // userId -> Array<journal>
    if (!(s.entries instanceof Map)) s.entries = new Map();   // userId -> Array<entry>
    if (!(s.habits instanceof Map)) s.habits = new Map();     // userId -> Array<habit>
    if (!(s.checkins instanceof Map)) s.checkins = new Map(); // userId -> Array<checkin {habitId,date}>
    if (!(s.locks instanceof Map)) s.locks = new Map();       // userId -> { hash, hint }
    return s;
  }
  function saveDaily() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const dyId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const dyNow = () => new Date().toISOString();
  const dyToday = () => new Date().toISOString().slice(0, 10);
  const dyActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const dyClean = (v, max = 200) => String(v == null ? "" : v).trim().slice(0, max);
  const dyList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };
  // Deterministic non-reversible hash for passcode locks (no crypto import needed
  // in the macro layer; this is a soft client-side privacy gate, not a secret store).
  function dyHash(str) {
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
  }

  const PROMPTS = [
    "What is one thing that went well today?",
    "What are you grateful for right now?",
    "Describe a moment that made you pause today.",
    "What is on your mind that you haven't said out loud?",
    "What would make tomorrow a good day?",
    "Who did you connect with today, and how did it feel?",
    "What did you learn, or what surprised you?",
    "What is something you want to remember about this week?",
    "Where did you feel most yourself today?",
    "What is a small win worth celebrating?",
  ];

  function ensureDefaultJournal(s, userId) {
    const list = dyList(s.journals, userId);
    if (list.length === 0) {
      list.push({ id: dyId("jr"), name: "Journal", color: "#4f8ff7", createdAt: dyNow() });
    }
    return list;
  }

  registerLensAction("daily", "prompt-today", (_ctx, _a, _params = {}) => {
    const dayIdx = Math.floor(Date.now() / 86400000) % PROMPTS.length;
    return { ok: true, result: { prompt: PROMPTS[dayIdx], date: dyToday() } };
  });

  registerLensAction("daily", "journal-create", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = dyClean(params.name, 80);
    if (!name) return { ok: false, error: "journal name required" };
    const list = ensureDefaultJournal(s, dyActor(ctx));
    const journal = { id: dyId("jr"), name, color: dyClean(params.color, 9) || "#4f8ff7", createdAt: dyNow() };
    list.push(journal);
    saveDaily();
    return { ok: true, result: { journal } };
  });

  registerLensAction("daily", "journal-list", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const journals = ensureDefaultJournal(s, userId).map((j) => ({
      ...j,
      entryCount: dyList(s.entries, userId).filter((e) => e.journalId === j.id).length,
    }));
    return { ok: true, result: { journals, count: journals.length } };
  });

  registerLensAction("daily", "entry-create", (ctx, _a, params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const body = dyClean(params.body, 20000);
    if (!body) return { ok: false, error: "entry body required" };
    const journals = ensureDefaultJournal(s, userId);
    const journalId = journals.some((j) => j.id === params.journalId) ? params.journalId : journals[0].id;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : dyToday();
    const mood = params.mood != null && Number.isFinite(Number(params.mood))
      ? Math.max(1, Math.min(5, Math.round(Number(params.mood)))) : null;
    const entry = {
      id: dyId("en"),
      journalId,
      title: dyClean(params.title, 160),
      body,
      mood,
      tags: Array.isArray(params.tags) ? params.tags.map((t) => dyClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 10) : [],
      media: Array.isArray(params.media)
        ? params.media.map((m) => ({
            id: dyId("md"),
            kind: ["image", "audio", "video", "link"].includes(m?.kind) ? m.kind : "image",
            url: dyClean(m?.url, 600),
            caption: dyClean(m?.caption, 200),
          })).filter((m) => m.url).slice(0, 12)
        : [],
      template: dyClean(params.template, 40) || null,
      date,
      weather: dyClean(params.weather, 40) || null,
      location: dyClean(params.location, 80) || null,
      createdAt: dyNow(),
      updatedAt: dyNow(),
    };
    dyList(s.entries, userId).push(entry);
    saveDaily();
    return { ok: true, result: { entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("daily", "entry-list", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let entries = [...dyList(s.entries, dyActor(ctx))];
    if (params.journalId) entries = entries.filter((e) => e.journalId === params.journalId);
    if (params.tag) {
      const t = dyClean(params.tag, 30).toLowerCase();
      entries = entries.filter((e) => e.tags.includes(t));
    }
    if (params.month && /^\d{4}-\d{2}$/.test(params.month)) {
      entries = entries.filter((e) => e.date.startsWith(params.month));
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("daily", "entry-detail", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = dyList(s.entries, dyActor(ctx)).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    return { ok: true, result: { entry } };
  });

  registerLensAction("daily", "entry-update", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entry = dyList(s.entries, dyActor(ctx)).find((e) => e.id === params.id);
    if (!entry) return { ok: false, error: "entry not found" };
    if (params.body != null) entry.body = dyClean(params.body, 20000) || entry.body;
    if (params.title != null) entry.title = dyClean(params.title, 160);
    if (params.mood != null) entry.mood = Number.isFinite(Number(params.mood)) ? Math.max(1, Math.min(5, Math.round(Number(params.mood)))) : null;
    if (Array.isArray(params.tags)) entry.tags = params.tags.map((t) => dyClean(t, 30).toLowerCase()).filter(Boolean).slice(0, 10);
    if (Array.isArray(params.media)) {
      entry.media = params.media.map((m) => ({
        id: dyClean(m?.id, 40) || dyId("md"),
        kind: ["image", "audio", "video", "link"].includes(m?.kind) ? m.kind : "image",
        url: dyClean(m?.url, 600),
        caption: dyClean(m?.caption, 200),
      })).filter((m) => m.url).slice(0, 12);
    }
    entry.updatedAt = dyNow();
    saveDaily();
    return { ok: true, result: { entry } };
  });

  registerLensAction("daily", "entry-delete", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = dyList(s.entries, dyActor(ctx));
    const i = arr.findIndex((e) => e.id === params.id);
    if (i < 0) return { ok: false, error: "entry not found" };
    arr.splice(i, 1);
    saveDaily();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("daily", "on-this-day", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const md = dyToday().slice(5); // MM-DD
    const year = dyToday().slice(0, 4);
    const entries = dyList(s.entries, dyActor(ctx))
      .filter((e) => e.date.slice(5) === md && e.date.slice(0, 4) !== year)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true, result: { entries, count: entries.length, monthDay: md } };
  });

  registerLensAction("daily", "entry-search", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = dyClean(params.query, 100).toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const entries = dyList(s.entries, dyActor(ctx))
      .filter((e) => e.body.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ id: e.id, title: e.title, date: e.date, excerpt: e.body.slice(0, 160), mood: e.mood }));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("daily", "mood-trend", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const withMood = dyList(s.entries, dyActor(ctx)).filter((e) => e.mood != null);
    const byDate = {};
    for (const e of withMood) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e.mood);
    }
    const trend = Object.entries(byDate)
      .map(([date, moods]) => ({ date, avgMood: Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const avg = withMood.length > 0 ? Math.round((withMood.reduce((a, e) => a + e.mood, 0) / withMood.length) * 10) / 10 : null;
    return { ok: true, result: { trend, averageMood: avg, entriesWithMood: withMood.length } };
  });

  registerLensAction("daily", "daily-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const entries = dyList(s.entries, userId);
    const dates = new Set(entries.map((e) => e.date));
    // current journaling streak ending today or yesterday
    let streak = 0;
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (dates.has(d)) streak += 1;
      else if (i === 0) continue; // today not yet written is OK
      else break;
    }
    const thisMonth = dyToday().slice(0, 7);
    return {
      ok: true,
      result: {
        totalEntries: entries.length,
        journals: ensureDefaultJournal(s, userId).length,
        daysJournaled: dates.size,
        currentStreak: streak,
        entriesThisMonth: entries.filter((e) => e.date.startsWith(thisMonth)).length,
        wroteToday: dates.has(dyToday()),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Entry templates (gratitude, daily reflection, goals) ───────────────

  const ENTRY_TEMPLATES = [
    {
      id: "gratitude",
      name: "Gratitude",
      icon: "heart",
      description: "Three things you're thankful for.",
      tags: ["gratitude"],
      body: "Three things I am grateful for today:\n1. \n2. \n3. \n\nWhy they mattered:\n",
    },
    {
      id: "reflection",
      name: "Daily Reflection",
      icon: "moon",
      description: "Review the day and what you learned.",
      tags: ["reflection"],
      body: "Highlight of the day:\n\nA challenge I faced:\n\nWhat I learned:\n\nHow I'm feeling tonight:\n",
    },
    {
      id: "goals",
      name: "Goals",
      icon: "target",
      description: "Set intentions for tomorrow.",
      tags: ["goals", "planning"],
      body: "Top priority for tomorrow:\n\nThree things I want to get done:\n- \n- \n- \n\nOne thing I want to feel:\n",
    },
    {
      id: "morning-pages",
      name: "Morning Pages",
      icon: "sun",
      description: "Free-write to clear your head.",
      tags: ["morning"],
      body: "On my mind this morning:\n\nWhat would make today great:\n",
    },
    {
      id: "mood-checkin",
      name: "Mood Check-in",
      icon: "smile",
      description: "Track how you feel and why.",
      tags: ["mood"],
      body: "Right now I feel:\n\nWhat's driving it:\n\nOne small thing that would help:\n",
    },
  ];

  registerLensAction("daily", "templates-list", (_ctx, _a, _params = {}) => {
    return { ok: true, result: { templates: ENTRY_TEMPLATES, count: ENTRY_TEMPLATES.length } };
  });

  // ─── Tag index across all entries ───────────────────────────────────────

  registerLensAction("daily", "tags-list", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = dyList(s.entries, dyActor(ctx));
    const counts = {};
    for (const e of entries) {
      for (const t of e.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    const tags = Object.entries(counts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return { ok: true, result: { tags, count: tags.length, totalTagged: entries.filter((e) => (e.tags || []).length > 0).length } };
  });

  // ─── Calendar / heatmap view of entries (streak grid) ───────────────────

  registerLensAction("daily", "entry-heatmap", (ctx, _a, params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const entries = dyList(s.entries, dyActor(ctx));
    const days = Math.max(7, Math.min(366, Math.round(muNumDy(params.days, 365))));
    const byDate = {};
    for (const e of entries) {
      if (!byDate[e.date]) byDate[e.date] = { count: 0, moodSum: 0, moodN: 0 };
      byDate[e.date].count += 1;
      if (e.mood != null) { byDate[e.date].moodSum += e.mood; byDate[e.date].moodN += 1; }
    }
    const cells = [];
    let writtenDays = 0;
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      const d = byDate[date];
      if (d) writtenDays += 1;
      cells.push({
        date,
        count: d ? d.count : 0,
        avgMood: d && d.moodN > 0 ? Math.round((d.moodSum / d.moodN) * 10) / 10 : null,
        intensity: d ? Math.min(4, d.count) : 0,
      });
    }
    // longest streak within the window
    let longest = 0, run = 0;
    for (const c of cells) { if (c.count > 0) { run += 1; longest = Math.max(longest, run); } else run = 0; }
    return { ok: true, result: { cells, days, writtenDays, longestStreak: longest, coverage: Math.round((writtenDays / days) * 100) } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Habit builder + scheduled check-ins ────────────────────────────────

  const HABIT_FREQS = ["daily", "weekdays", "weekends", "weekly"];

  function habitDueToday(habit, date) {
    const dow = new Date(date + "T12:00:00").getDay(); // 0 Sun..6 Sat
    if (habit.frequency === "daily") return true;
    if (habit.frequency === "weekdays") return dow >= 1 && dow <= 5;
    if (habit.frequency === "weekends") return dow === 0 || dow === 6;
    if (habit.frequency === "weekly") return dow === (habit.weeklyDay ?? 1);
    return true;
  }

  registerLensAction("daily", "habit-create", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const name = dyClean(params.name, 80);
    if (!name) return { ok: false, error: "habit name required" };
    const frequency = HABIT_FREQS.includes(params.frequency) ? params.frequency : "daily";
    const habit = {
      id: dyId("hb"),
      name,
      cue: dyClean(params.cue, 160) || null,
      frequency,
      weeklyDay: frequency === "weekly" ? Math.max(0, Math.min(6, Math.round(muNumDy(params.weeklyDay, 1)))) : null,
      reminderTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(params.reminderTime) ? params.reminderTime : null,
      color: dyClean(params.color, 9) || "#f97316",
      targetPerWeek: Math.max(1, Math.min(7, Math.round(muNumDy(params.targetPerWeek, frequency === "weekly" ? 1 : 7)))),
      archived: false,
      createdAt: dyNow(),
    };
    dyList(s.habits, dyActor(ctx)).push(habit);
    saveDaily();
    return { ok: true, result: { habit } };
  });

  registerLensAction("daily", "habit-list", (ctx, _a, _params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const habits = dyList(s.habits, userId).filter((h) => !h.archived);
    const checkins = dyList(s.checkins, userId);
    const today = dyToday();
    const weekStart = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
    const enriched = habits.map((h) => {
      const hc = checkins.filter((c) => c.habitId === h.id).map((c) => c.date);
      const set = new Set(hc);
      // current streak counting only days the habit was due
      let streak = 0;
      for (let i = 0; i < 366; i++) {
        const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
        if (!habitDueToday(h, date)) continue;
        if (set.has(date)) streak += 1;
        else if (i === 0) continue; // today not yet done is OK
        else break;
      }
      const thisWeek = hc.filter((d) => d >= weekStart && d <= today).length;
      return {
        ...h,
        currentStreak: streak,
        totalCheckins: hc.length,
        doneToday: set.has(today),
        dueToday: habitDueToday(h, today),
        thisWeek,
        weekProgress: Math.min(100, Math.round((thisWeek / h.targetPerWeek) * 100)),
        status: streak >= 21 ? "locked-in" : streak >= 7 ? "strong" : streak >= 3 ? "building" : streak >= 1 ? "starting" : "new",
      };
    });
    return {
      ok: true,
      result: {
        habits: enriched,
        count: enriched.length,
        dueToday: enriched.filter((h) => h.dueToday).length,
        doneToday: enriched.filter((h) => h.doneToday).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("daily", "habit-checkin", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const habit = dyList(s.habits, userId).find((h) => h.id === params.habitId);
    if (!habit) return { ok: false, error: "habit not found" };
    const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : dyToday();
    const checkins = dyList(s.checkins, userId);
    const idx = checkins.findIndex((c) => c.habitId === habit.id && c.date === date);
    let done;
    if (idx >= 0) { checkins.splice(idx, 1); done = false; }       // toggle off
    else { checkins.push({ habitId: habit.id, date, at: dyNow() }); done = true; }
    saveDaily();
    return { ok: true, result: { habitId: habit.id, date, done } };
  });

  registerLensAction("daily", "habit-update", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const habit = dyList(s.habits, dyActor(ctx)).find((h) => h.id === params.id);
    if (!habit) return { ok: false, error: "habit not found" };
    if (params.name != null) { const n = dyClean(params.name, 80); if (n) habit.name = n; }
    if (params.cue != null) habit.cue = dyClean(params.cue, 160) || null;
    if (params.frequency != null && HABIT_FREQS.includes(params.frequency)) habit.frequency = params.frequency;
    if (params.reminderTime != null) {
      habit.reminderTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(params.reminderTime) ? params.reminderTime : null;
    }
    if (params.targetPerWeek != null) habit.targetPerWeek = Math.max(1, Math.min(7, Math.round(muNumDy(params.targetPerWeek, habit.targetPerWeek))));
    if (params.color != null) habit.color = dyClean(params.color, 9) || habit.color;
    if (params.archived != null) habit.archived = !!params.archived;
    saveDaily();
    return { ok: true, result: { habit } };
  });

  registerLensAction("daily", "habit-delete", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const arr = dyList(s.habits, userId);
    const i = arr.findIndex((h) => h.id === params.id);
    if (i < 0) return { ok: false, error: "habit not found" };
    arr.splice(i, 1);
    const checkins = dyList(s.checkins, userId);
    for (let j = checkins.length - 1; j >= 0; j--) if (checkins[j].habitId === params.id) checkins.splice(j, 1);
    saveDaily();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Encrypted/private journal lock with passcode ───────────────────────

  registerLensAction("daily", "lock-status", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lock = s.locks.get(dyActor(ctx));
    return { ok: true, result: { locked: !!lock, hint: lock?.hint || null } };
  });

  registerLensAction("daily", "lock-set", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const code = dyClean(params.passcode, 64);
    if (code.length < 4) return { ok: false, error: "passcode must be at least 4 characters" };
    const existing = s.locks.get(userId);
    if (existing && dyHash(dyClean(params.currentPasscode, 64)) !== existing.hash) {
      return { ok: false, error: "current passcode incorrect" };
    }
    s.locks.set(userId, { hash: dyHash(code), hint: dyClean(params.hint, 120) || null });
    saveDaily();
    return { ok: true, result: { locked: true, hint: dyClean(params.hint, 120) || null } };
  });

  registerLensAction("daily", "lock-verify", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const lock = s.locks.get(dyActor(ctx));
    if (!lock) return { ok: true, result: { unlocked: true, locked: false } };
    const ok = dyHash(dyClean(params.passcode, 64)) === lock.hash;
    return { ok: true, result: { unlocked: ok, locked: true, hint: ok ? null : lock.hint } };
  });

  registerLensAction("daily", "lock-remove", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const lock = s.locks.get(userId);
    if (!lock) return { ok: true, result: { locked: false } };
    if (dyHash(dyClean(params.passcode, 64)) !== lock.hash) {
      return { ok: false, error: "passcode incorrect" };
    }
    s.locks.delete(userId);
    saveDaily();
    return { ok: true, result: { locked: false } };
  });

  // ─── Export journal to Markdown archive ─────────────────────────────────

  registerLensAction("daily", "export-archive", (ctx, _a, params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    let entries = [...dyList(s.entries, userId)];
    if (params.journalId) entries = entries.filter((e) => e.journalId === params.journalId);
    if (params.tag) {
      const t = dyClean(params.tag, 30).toLowerCase();
      entries = entries.filter((e) => (e.tags || []).includes(t));
    }
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const journals = ensureDefaultJournal(s, userId);
    const journalName = (id) => journals.find((j) => j.id === id)?.name || "Journal";
    const MOOD_LABEL = ["", "Difficult", "Low", "Neutral", "Good", "Great"];
    const lines = [];
    lines.push(`# Journal Archive`);
    lines.push("");
    lines.push(`Exported ${dyNow()} · ${entries.length} entr${entries.length === 1 ? "y" : "ies"}`);
    lines.push("");
    for (const e of entries) {
      lines.push(`## ${e.date}${e.title ? ` — ${e.title}` : ""}`);
      const meta = [];
      meta.push(`*${journalName(e.journalId)}*`);
      if (e.mood != null) meta.push(`Mood: ${MOOD_LABEL[e.mood] || e.mood}`);
      if (e.location) meta.push(`Location: ${e.location}`);
      if (e.weather) meta.push(`Weather: ${e.weather}`);
      lines.push(meta.join(" · "));
      lines.push("");
      lines.push(e.body);
      lines.push("");
      if ((e.tags || []).length > 0) lines.push(`Tags: ${e.tags.map((t) => `#${t}`).join(" ")}`);
      for (const m of e.media || []) lines.push(`- [${m.kind}] ${m.caption || ""} ${m.url}`.trim());
      lines.push("");
      lines.push("---");
      lines.push("");
    }
    const markdown = lines.join("\n");
    return {
      ok: true,
      result: {
        markdown,
        format: "markdown",
        entryCount: entries.length,
        filename: `journal-archive-${dyToday()}.md`,
        bytes: Buffer.byteLength(markdown, "utf8"),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // feed — ingest inspirational quotes (ZenQuotes) as visible DTUs.
  registerLensAction("daily", "feed", async (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    if (!(s.feedSeen instanceof Set)) s.feedSeen = new Set();
    const limit = Math.max(1, Math.min(15, Math.round(muNumDy(params.limit, 8))));
    try {
      const r = await fetch("https://zenquotes.io/api/quotes");
      if (!r.ok) return { ok: false, error: `zenquotes ${r.status}` };
      const quotes = await r.json();
      if (!Array.isArray(quotes)) return { ok: false, error: "zenquotes returned no data" };
      let ingested = 0, skipped = 0;
      const dtuIds = [];
      for (const q of quotes.slice(0, limit)) {
        const key = `${q.a}::${(q.q || "").slice(0, 32)}`;
        if (s.feedSeen.has(key)) { skipped++; continue; }
        const title = `"${(q.q || "").slice(0, 90)}" — ${q.a || "Unknown"}`;
        const res = await ctx.macro.run("dtu", "create", {
          title,
          creti: `"${q.q || ""}"\n\n— ${q.a || "Unknown"}`,
          tags: ["daily", "feed", "inspiration", "quote"],
          source: "zenquotes-feed",
          meta: { author: q.a, quote: q.q },
        });
        if (res?.ok && res.dtu) { ingested++; dtuIds.push(res.dtu.id); s.feedSeen.add(key); }
      }
      saveDaily();
      return { ok: true, result: { ingested, skipped, source: "zenquotes", dtuIds } };
    } catch (e) {
      return { ok: false, error: `zenquotes unreachable: ${e instanceof Error ? e.message : String(e)}` };
    }
  });

  function muNumDy(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }
}
