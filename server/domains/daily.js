// server/domains/daily.js
//
// Day One 2026-parity journaling. Pure-compute productivity helpers
// (daily summary, habit streaks, focus timer, weekly review) PLUS a
// real per-user journaling substrate: multiple journals, dated entries
// with mood + tags, on-this-day, search, mood trend and streaks.

import { guardAnonWrites } from "../lib/lens-authz.js";
export default function registerDailyActions(registerLensAction) {
  registerLensAction = guardAnonWrites(registerLensAction); // anonymous callers can read, not write (lib/lens-authz.js)
  registerLensAction("daily", "dailySummary", (ctx, artifact, params = {}) => {
    const data = artifact.data || {};
    const userId = dyActor(ctx);
    const date = dyExplicitDay(params?.date) || dyExplicitDay(data.date) || dyToday();
    // D2: the action reads the caller's real records — the union journal
    // for the day and the day's session artifacts — not only arrays
    // riding the artifact it was run against (the pre-build shape, kept
    // as a fallback merge for callers that still carry them).
    const dayEntries = dyUnionEntries(userId).filter((e) => e.date === date);
    const legacyEntries = Array.isArray(data.entries) ? data.entries : [];
    const entries = [...dayEntries, ...legacyEntries];
    const sessions = [
      ...dyArtifacts(userId, "session").map((a) => a.data || {})
        .filter((s2) => String(s2.startedAt || s2.date || "").startsWith(date)),
      ...(Array.isArray(data.sessions) ? data.sessions : []),
    ];
    const tasks = data.tasks || [];
    const completedTasks = tasks.filter(t => t.completed || t.status === "completed").length;
    const totalMinutes = sessions.reduce((s, ses) => s + (parseInt(ses.duration) || 0), 0);
    const dayMood = [...dayEntries].reverse().find((e) => e.mood != null)?.mood;
    const mood = dayMood !== undefined ? dayMood : (data.mood !== undefined ? data.mood : null);
    return { ok: true, result: { date, entriesLogged: entries.length, sessionsCompleted: sessions.length, totalFocusMinutes: totalMinutes, tasksCompleted: completedTasks, totalTasks: tasks.length, completionRate: tasks.length > 0 ? Math.round((completedTasks / tasks.length) * 100) : 0, mood: mood !== null ? mood : "not-recorded", productivityScore: Math.min(100, Math.round(completedTasks * 15 + totalMinutes / 5 + entries.length * 10)) } };
  });
  registerLensAction("daily", "habitStreak", (ctx, artifact, _params) => {
    // D2: habits + check-ins come from the caller's real records (the
    // domain store), merged with any legacy arrays on the artifact.
    const userId = dyActor(ctx);
    const s = getDailyState();
    const legacyHabits = artifact.data?.habits || [];
    const history = [...(artifact.data?.history || [])];
    if (s) {
      const checkins = dyList(s.checkins, userId);
      const byDate = new Map();
      for (const c of checkins) {
        const habit = dyList(s.habits, userId).find((h) => h.id === c.habitId);
        if (!habit) continue;
        if (!byDate.has(c.date)) byDate.set(c.date, []);
        byDate.get(c.date).push(habit.name);
      }
      for (const [date, names] of byDate) history.push({ date, habits: names });
    }
    const habits = [
      ...legacyHabits,
      ...(s ? dyList(s.habits, userId).filter((h) => !h.archived).map((h) => h.name) : []),
    ];
    const analyzed = [...new Set(habits.map((h) => (typeof h === "string" ? h : h.name || String(h))))].map((name) => {
      const completions = history.filter(d => (d.habits || []).includes(name));
      let currentStreak = 0; const now = new Date();
      for (let i = 0; i < 365; i++) { const date = new Date(now.getTime() - i * 86400000).toISOString().split("T")[0]; if (completions.some(c => c.date === date)) currentStreak++; else break; }
      const legacy = legacyHabits.find((h) => (typeof h === "object" ? h.name : h) === name);
      return { habit: name, currentStreak, longestStreak: Math.max(currentStreak, parseInt(legacy?.longestStreak) || 0), totalCompletions: completions.length, status: currentStreak >= 7 ? "strong" : currentStreak >= 3 ? "building" : currentStreak >= 1 ? "starting" : "broken" };
    });
    return { ok: true, result: { habits: analyzed, activeHabits: analyzed.filter(h => h.currentStreak > 0).length, totalHabits: analyzed.length, bestStreak: analyzed.sort((a, b) => b.currentStreak - a.currentStreak)[0] } };
  });
  registerLensAction("daily", "focusTimer", (ctx, artifact, _params) => {
    const userId = dyActor(ctx);
    const today = new Date().toISOString().split("T")[0];
    // D2: today's sessions are the caller's session artifacts for today,
    // merged with any legacy sessions array on the artifact.
    const sessions = [
      ...dyArtifacts(userId, "session").map((a) => a.data || {}),
      ...(artifact.data?.sessions || []),
    ];
    const todaySessions = sessions.filter(s => (s.date || s.startedAt || "").startsWith(today));
    const totalMinutes = todaySessions.reduce((s, ses) => s + (parseInt(ses.duration) || 25), 0);
    const categories = {};
    for (const s of todaySessions) { const cat = s.category || s.project || "General"; categories[cat] = (categories[cat] || 0) + (parseInt(s.duration) || 25); }
    return { ok: true, result: { date: today, sessionsToday: todaySessions.length, totalMinutes, totalHours: Math.round(totalMinutes / 60 * 10) / 10, byCategory: categories, pomodorosCompleted: Math.floor(totalMinutes / 25), targetMinutes: 240, progress: Math.round((totalMinutes / 240) * 100) } };
  });
  registerLensAction("daily", "weeklyReview", (ctx, artifact, params = {}) => {
    // D2: the review week is built from the caller's real records — the
    // union journal + session artifacts over the last 7 days — merged
    // with any legacy per-day rows on the artifact. The empty message
    // now stands only when the week truly holds nothing.
    const userId = dyActor(ctx);
    const end = dyExplicitDay(params?.date) || dyToday();
    const byDate = new Map();
    const row = (date) => { if (!byDate.has(date)) byDate.set(date, { date, tasksCompleted: 0, focusMinutes: 0, moods: [], entries: 0 }); return byDate.get(date); };
    for (const d of artifact.data?.days || []) {
      if (!d?.date) continue;
      const r = row(d.date);
      r.tasksCompleted += parseInt(d.tasksCompleted) || 0;
      r.focusMinutes += parseInt(d.focusMinutes) || 0;
      if (d.mood !== undefined && Number.isFinite(Number(d.mood))) r.moods.push(Number(d.mood));
    }
    for (const e of dyUnionEntries(userId)) { const r = row(e.date); r.entries += 1; if (e.mood != null) r.moods.push(e.mood); }
    for (const a of dyArtifacts(userId, "session")) {
      const d = a.data || {};
      const date = String(d.startedAt || d.date || "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) row(date).focusMinutes += parseInt(d.duration) || 0;
    }
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const r = byDate.get(dyShiftDay(end, -i));
      if (r && (r.entries > 0 || r.focusMinutes > 0 || r.tasksCompleted > 0)) days.push(r);
    }
    if (days.length === 0) return { ok: true, result: { message: "Log daily data to generate weekly review." } };
    const totalTasks = days.reduce((s, d) => s + d.tasksCompleted, 0);
    const totalFocus = days.reduce((s, d) => s + d.focusMinutes, 0);
    const allMoods = days.flatMap((d) => d.moods);
    const avgMood = allMoods.length > 0 ? Math.round((allMoods.reduce((a, b) => a + b, 0) / allMoods.length) * 10) / 10 : null;
    const bestDay = [...days].sort((a, b) => (b.focusMinutes + b.entries * 10) - (a.focusMinutes + a.entries * 10))[0];
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
  // A client-supplied calendar day (profile zone or browser local). UTC
  // `dyToday()` is only the fallback when the caller did not say which day
  // "today" is — otherwise an evening west of UTC files and reads tomorrow.
  const dyExplicitDay = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const dyClientToday = (params) => dyExplicitDay(params?.today) || dyToday();
  const dyShiftDay = (iso, delta) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + delta));
    return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  };
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

  // ─── Cross-store read-back (D1/D2) ──────────────────────────────────
  // The Today panel writes the generic lens-artifact store
  // (STATE.lensArtifacts — domain "daily", types entry/session/reminder);
  // the Studio writes this domain store. The journal's read-back — the
  // Studio timeline, dashboard, streak grid, the four Daily Actions and
  // the full export — reads the UNION of both stores, so a day written
  // on either surface is the same day everywhere it is read back. The
  // write paths and both stores are untouched; nothing migrates.
  function dyArtifacts(userId, type) {
    const STATE = globalThis._concordSTATE;
    if (!STATE || !(STATE.lensArtifacts instanceof Map)) return [];
    const out = [];
    for (const a of STATE.lensArtifacts.values()) {
      if (a && a.domain === "daily" && a.ownerId === userId && a.type === type) out.push(a);
    }
    return out;
  }
  const DY_MOOD_LABELS = ["Frustrated", "Meh", "Neutral", "Good vibes", "On fire"];
  function dyTodayEntry(a) {
    const d = a.data || {};
    const parts = [];
    if (d.notes) parts.push(String(d.notes));
    if (d.workedOn) parts.push(`Worked on: ${d.workedOn}`);
    if (d.learned) parts.push(`Learned: ${d.learned}`);
    if (d.goals) parts.push(`Goals: ${d.goals}`);
    const moodIdx = Number.isInteger(d.mood) ? d.mood : null;
    return {
      id: `today:${a.id}`,
      journalId: null,
      title: d.date || a.title || "",
      body: parts.join("\n\n"),
      mood: moodIdx != null && moodIdx >= 0 && moodIdx <= 4 ? moodIdx + 1 : null,
      moodLabel: moodIdx != null ? (DY_MOOD_LABELS[moodIdx] || null) : null,
      tags: [],
      media: [],
      template: null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(d.date || "") ? d.date : String(a.createdAt || "").slice(0, 10),
      weather: null,
      location: null,
      source: "today",
      createdAt: a.createdAt || dyNow(),
      updatedAt: a.updatedAt || a.createdAt || dyNow(),
    };
  }
  function dyUnionEntries(userId) {
    const s = getDailyState();
    const own = s ? dyList(s.entries, userId) : [];
    return [...own, ...dyArtifacts(userId, "entry").map(dyTodayEntry)];
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
    const askedJournal = params.journalId != null && String(params.journalId) !== "";
    const journal = askedJournal ? journals.find((j) => j.id === params.journalId) : null;
    if (askedJournal && !journal) return { ok: false, error: "journal not found" };
    const journalId = journal ? journal.id : journals[0].id;
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
    const userId = dyActor(ctx);
    let entries = [...dyList(s.entries, userId)];
    // D1: the timeline reads the union — Today-panel entries join the
    // list (labelled source: "today") unless a journal filter scopes
    // the read to the Studio's own books.
    if (!params.journalId) entries = [...entries, ...dyArtifacts(userId, "entry").map(dyTodayEntry)];
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

  registerLensAction("daily", "on-this-day", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const ref = dyExplicitDay(params.date) || dyExplicitDay(params.today) || dyToday();
    const md = ref.slice(5); // MM-DD
    const year = ref.slice(0, 4);
    const entries = dyUnionEntries(dyActor(ctx))
      .filter((e) => e.date.slice(5) === md && e.date.slice(0, 4) !== year)
      .sort((a, b) => b.date.localeCompare(a.date));
    return { ok: true, result: { entries, count: entries.length, monthDay: md } };
  });

  registerLensAction("daily", "entry-search", (ctx, _a, params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = dyClean(params.query, 100).toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const entries = dyUnionEntries(dyActor(ctx))
      .filter((e) => e.body.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.tags.some((t) => t.includes(q)))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((e) => ({ id: e.id, title: e.title, date: e.date, excerpt: e.body.slice(0, 160), mood: e.mood, source: e.source || "studio" }));
    return { ok: true, result: { entries, count: entries.length } };
  });

  registerLensAction("daily", "mood-trend", (ctx, _a, _params = {}) => {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const withMood = dyUnionEntries(dyActor(ctx)).filter((e) => e.mood != null);
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

  registerLensAction("daily", "daily-dashboard", (ctx, _a, params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const entries = dyUnionEntries(userId);
    const dates = new Set(entries.map((e) => e.date));
    const today = dyClientToday(params);
    // current journaling streak ending today or yesterday, in calendar days
    let streak = 0;
    for (let i = 0; i < 366; i++) {
      const d = dyShiftDay(today, -i);
      if (dates.has(d)) streak += 1;
      else if (i === 0) continue; // today not yet written is OK
      else break;
    }
    const thisMonth = today.slice(0, 7);
    return {
      ok: true,
      result: {
        totalEntries: entries.length,
        journals: ensureDefaultJournal(s, userId).length,
        daysJournaled: dates.size,
        currentStreak: streak,
        entriesThisMonth: entries.filter((e) => e.date.startsWith(thisMonth)).length,
        wroteToday: dates.has(today),
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
    const entries = dyUnionEntries(dyActor(ctx));
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

  registerLensAction("daily", "habit-list", (ctx, _a, params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const habits = dyList(s.habits, userId).filter((h) => !h.archived);
    const checkins = dyList(s.checkins, userId);
    const today = dyClientToday(params);
    const weekStart = dyShiftDay(today, -6);
    const enriched = habits.map((h) => {
      const hc = checkins.filter((c) => c.habitId === h.id).map((c) => c.date);
      const set = new Set(hc);
      // current streak counting only days the habit was due
      let streak = 0;
      for (let i = 0; i < 366; i++) {
        const date = dyShiftDay(today, -i);
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

  // ─── Full own-records export (D4) ─────────────────────────────────────
  // Every record the caller owns in this lens, from BOTH stores, in
  // labelled sections: Studio entries, Today entries, sessions, habits
  // and reminders. This is the export whose contents are the journal —
  // the header bundle (the generic corpus export) is a different object.

  registerLensAction("daily", "export-journal", (ctx, _a, _params = {}) => {
  try {
    const s = getDailyState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = dyActor(ctx);
    const studioEntries = [...dyList(s.entries, userId)].sort((a, b) => a.date.localeCompare(b.date));
    const todayEntries = dyArtifacts(userId, "entry").map(dyTodayEntry).sort((a, b) => a.date.localeCompare(b.date));
    const sessions = dyArtifacts(userId, "session").map((a) => a.data || {})
      .sort((a, b) => String(a.startedAt || "").localeCompare(String(b.startedAt || "")));
    const habits = dyList(s.habits, userId);
    const checkins = dyList(s.checkins, userId);
    const reminders = dyArtifacts(userId, "reminder").map((a) => a.data || {})
      .sort((a, b) => String(a.dueAt || "").localeCompare(String(b.dueAt || "")));
    const MOOD_LABEL = ["", "Difficult", "Low", "Neutral", "Good", "Great"];
    const lines = [];
    lines.push(`# My Daily Journal — everything`);
    lines.push("");
    lines.push(`Exported ${dyNow()} · your own records only: ${studioEntries.length} Studio entries · ${todayEntries.length} Today entries · ${sessions.length} sessions · ${habits.length} habits · ${reminders.length} reminders`);
    lines.push("");
    lines.push(`## Journal entries (Studio)`);
    lines.push("");
    if (studioEntries.length === 0) lines.push("(none)");
    for (const e of studioEntries) {
      lines.push(`### ${e.date}${e.title ? ` — ${e.title}` : ""}`);
      if (e.mood != null) lines.push(`Mood: ${MOOD_LABEL[e.mood] || e.mood}`);
      lines.push("");
      lines.push(e.body);
      lines.push("");
    }
    lines.push(`## Today entries`);
    lines.push("");
    if (todayEntries.length === 0) lines.push("(none)");
    for (const e of todayEntries) {
      lines.push(`### ${e.date}`);
      if (e.moodLabel) lines.push(`Mood: ${e.moodLabel}`);
      lines.push("");
      lines.push(e.body || "(no notes)");
      lines.push("");
    }
    lines.push(`## Sessions`);
    lines.push("");
    if (sessions.length === 0) lines.push("(none)");
    for (const s2 of sessions) {
      lines.push(`- ${String(s2.startedAt || "").slice(0, 10)} · ${s2.project || s2.title || "Session"} · ${s2.duration ?? "?"}m${s2.category ? ` · ${s2.category}` : ""}`);
    }
    lines.push("");
    lines.push(`## Habits`);
    lines.push("");
    if (habits.length === 0) lines.push("(none)");
    for (const h of habits) {
      const n = checkins.filter((c) => c.habitId === h.id).length;
      lines.push(`- ${h.name} · ${n} check-in${n === 1 ? "" : "s"} · target ${h.targetPerWeek}/week${h.archived ? " · archived" : ""}`);
    }
    lines.push("");
    lines.push(`## Reminders`);
    lines.push("");
    if (reminders.length === 0) lines.push("(none)");
    for (const r of reminders) {
      lines.push(`- ${r.title || "Reminder"} · due ${r.dueAt || "?"} · ${r.completed ? "done" : "pending"}`);
    }
    lines.push("");
    const markdown = lines.join("\n");
    return {
      ok: true,
      result: {
        markdown,
        format: "markdown",
        filename: `daily-journal-export-${dyToday()}.md`,
        bytes: Buffer.byteLength(markdown, "utf8"),
        counts: { studioEntries: studioEntries.length, todayEntries: todayEntries.length, sessions: sessions.length, habits: habits.length, reminders: reminders.length },
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
          visibility: "public", visibilityScope: "global", // public external feed (lib/public-feed-sources.js)
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
