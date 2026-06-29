// server/domains/meditation.js
// Domain actions for meditation sessions: track picker, timer + streak
// management, session log. Shadows Calm / Headspace / Insight Timer.

export default function registerMeditationActions(registerLensAction) {
  /**
   * pickTrack — return a deterministic Calm-shape track for a goal.
   *   params.goal: 'focus' | 'sleep' | 'anxiety' | 'gratitude' | 'breath'
   *   params.minutes: integer 1–60
   *   Returns: { trackId, title, narrator, durationMinutes, goal, vibe }
   */
  registerLensAction("meditation", "pickTrack", (_ctx, _artifact, params = {}) => {
    const goal = (params.goal || "focus").toLowerCase();
    const minutes = Math.min(60, Math.max(1, parseInt(params.minutes, 10) || 10));
    const tracks = {
      focus:    [{ title: "Single-pointed attention",   narrator: "Tara Brach",       vibe: "steady" }, { title: "Open monitoring", narrator: "Sharon Salzberg", vibe: "spacious" }],
      sleep:    [{ title: "Body scan for sleep",        narrator: "Jon Kabat-Zinn",  vibe: "soft"   }, { title: "Yoga nidra",      narrator: "Tracee Stanley",  vibe: "deep"     }],
      anxiety:  [{ title: "Soften, soothe, allow",      narrator: "Kristin Neff",    vibe: "warm"   }, { title: "Grounding breath", narrator: "Pema Chödrön",    vibe: "stable"   }],
      gratitude:[{ title: "Five gratitudes",            narrator: "Rick Hanson",     vibe: "open"   }],
      breath:   [{ title: "Box breathing",              narrator: "—",                vibe: "rhythmic" }, { title: "4-7-8 breath",   narrator: "—",               vibe: "rhythmic" }],
    };
    const pool = tracks[goal] || tracks.focus;
    const pick = pool[(minutes + goal.length) % pool.length];
    return {
      ok: true,
      result: {
        trackId: `med-${goal}-${minutes}-${pool.indexOf(pick)}`,
        title: pick.title,
        narrator: pick.narrator,
        durationMinutes: minutes,
        goal,
        vibe: pick.vibe,
      },
    };
  });

  /**
   * sessionLog — append a completed meditation session to the user's
   * meditation_sessions artifact.
   *   params.trackId, params.minutes, params.completedAt, params.rating?
   */
  registerLensAction("meditation", "sessionLog", (_ctx, artifact, params = {}) => {
    const sessions = artifact.data?.sessions || [];
    const entry = {
      id: `sess-${Date.now()}`,
      trackId: params.trackId || "unknown",
      minutes: parseInt(params.minutes, 10) || 0,
      completedAt: params.completedAt || new Date().toISOString(),
      rating: params.rating ? Math.min(5, Math.max(1, parseInt(params.rating, 10))) : null,
    };
    sessions.push(entry);
    artifact.data = { ...artifact.data, sessions };
    return { ok: true, result: { entry, total: sessions.length } };
  });

  /**
   * streakSummary — compute the current and longest streak across the
   * user's meditation_sessions log.
   */
  registerLensAction("meditation", "streakSummary", (_ctx, artifact, _params) => {
    const sessions = artifact.data?.sessions || [];
    if (sessions.length === 0) {
      return { ok: true, result: { currentStreak: 0, longestStreak: 0, totalSessions: 0, totalMinutes: 0 } };
    }
    const days = new Set(sessions.map((s) => (s.completedAt || "").slice(0, 10)).filter(Boolean));
    const sortedDays = [...days].sort();
    const today = new Date().toISOString().slice(0, 10);
    let current = 0;
    let cursor = today;
    while (days.has(cursor)) {
      current++;
      const d = new Date(cursor);
      d.setDate(d.getDate() - 1);
      cursor = d.toISOString().slice(0, 10);
    }
    let longest = 0;
    let run = 1;
    for (let i = 1; i < sortedDays.length; i++) {
      const prev = new Date(sortedDays[i - 1]);
      prev.setDate(prev.getDate() + 1);
      if (prev.toISOString().slice(0, 10) === sortedDays[i]) run++;
      else { longest = Math.max(longest, run); run = 1; }
    }
    longest = Math.max(longest, run);
    const totalMinutes = sessions.reduce((s, x) => s + (parseInt(x.minutes, 10) || 0), 0);
    return {
      ok: true,
      result: {
        currentStreak: current,
        longestStreak: longest,
        totalSessions: sessions.length,
        totalMinutes,
        lastSessionAt: sessions[sessions.length - 1]?.completedAt || null,
      },
    };
  });

  /**
   * dailyPrompt — return a deterministic mindful-presence prompt for
   * the current ISO date (no LLM call).
   */
  registerLensAction("meditation", "dailyPrompt", (_ctx, _artifact, _params) => {
    const prompts = [
      "Where is your attention drawn first when you sit down?",
      "What is the texture of your breath right now?",
      "Which sound in your environment have you been ignoring?",
      "What is one body part you can soften by 10%?",
      "When did you last feel completely at ease?",
      "What thought keeps returning today — and what does it want from you?",
      "Notice three sensations you usually filter out.",
    ];
    const day = new Date().toISOString().slice(0, 10);
    let hash = 0;
    for (let i = 0; i < day.length; i++) hash = ((hash << 5) - hash + day.charCodeAt(i)) | 0;
    const prompt = prompts[Math.abs(hash) % prompts.length];
    return { ok: true, result: { date: day, prompt } };
  });

  // ─── Calm / Headspace 2026 session substrate (per-user, STATE) ───────

  const LIBRARY = [
    { id: "g-focus-10", title: "Single-Pointed Focus", category: "guided", durationMin: 10, narrator: "Tara Brach", goal: "focus" },
    { id: "g-anx-8", title: "Soften, Soothe, Allow", category: "guided", durationMin: 8, narrator: "Kristin Neff", goal: "anxiety" },
    { id: "g-grat-5", title: "Five Gratitudes", category: "guided", durationMin: 5, narrator: "Rick Hanson", goal: "gratitude" },
    { id: "g-body-15", title: "Full Body Scan", category: "guided", durationMin: 15, narrator: "Jon Kabat-Zinn", goal: "relax" },
    { id: "g-morn-7", title: "Morning Intention", category: "guided", durationMin: 7, narrator: "Sharon Salzberg", goal: "focus" },
    { id: "b-box-5", title: "Box Breathing", category: "breathwork", durationMin: 5, pattern: "box", goal: "calm" },
    { id: "b-478-4", title: "4-7-8 Wind Down", category: "breathwork", durationMin: 4, pattern: "478", goal: "sleep" },
    { id: "b-coh-6", title: "Coherent Breathing", category: "breathwork", durationMin: 6, pattern: "coherent", goal: "calm" },
    { id: "s-rain-30", title: "A Walk in Light Rain", category: "sleep_story", durationMin: 30, narrator: "Calm Voices", goal: "sleep" },
    { id: "s-train-45", title: "The Midnight Train", category: "sleep_story", durationMin: 45, narrator: "Calm Voices", goal: "sleep" },
    { id: "s-nidra-20", title: "Yoga Nidra Descent", category: "sleep_story", durationMin: 20, narrator: "Tracee Stanley", goal: "sleep" },
    { id: "sc-rain", title: "Rainfall", category: "soundscape", durationMin: 60, goal: "sleep" },
    { id: "sc-ocean", title: "Ocean Waves", category: "soundscape", durationMin: 60, goal: "relax" },
    { id: "sc-white", title: "White Noise", category: "soundscape", durationMin: 480, goal: "sleep" },
    { id: "sc-forest", title: "Forest at Dawn", category: "soundscape", durationMin: 60, goal: "focus" },
    { id: "sos-panic-3", title: "SOS: Acute Panic Reset", category: "sos", durationMin: 3, goal: "anxiety" },
    { id: "sos-night-3", title: "Nighttime SOS", category: "sos", durationMin: 3, goal: "sleep" },
  ];
  const BREATH_PATTERNS = {
    box: { name: "Box Breathing", cycleSeconds: 16, phases: [{ label: "inhale", sec: 4 }, { label: "hold", sec: 4 }, { label: "exhale", sec: 4 }, { label: "hold", sec: 4 }] },
    "478": { name: "4-7-8 Breathing", cycleSeconds: 19, phases: [{ label: "inhale", sec: 4 }, { label: "hold", sec: 7 }, { label: "exhale", sec: 8 }] },
    coherent: { name: "Coherent Breathing", cycleSeconds: 11, phases: [{ label: "inhale", sec: 5.5 }, { label: "exhale", sec: 5.5 }] },
  };

  function getMedState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.meditationLens) STATE.meditationLens = {};
    const s = STATE.meditationLens;
    if (!(s.sessions instanceof Map)) s.sessions = new Map(); // userId -> Array<completed>
    if (!(s.moods instanceof Map)) s.moods = new Map();       // userId -> Array<mood>
    return s;
  }
  function saveMed() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const medId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const medNow = () => new Date().toISOString();
  const medActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const medList = (m, k) => { if (!m.has(k)) m.set(k, []); return m.get(k); };

  registerLensAction("meditation", "library", (_ctx, _a, params = {}) => {
    // Fail-closed on a poisoned maxMinutes — a NaN/Infinity filter bound is meaningless.
    if (params.maxMinutes !== undefined && params.maxMinutes !== null && params.maxMinutes !== "") {
      const mm = Number(params.maxMinutes);
      if (!Number.isFinite(mm)) return { ok: false, error: "invalid_maxMinutes" };
    }
    let items = [...LIBRARY];
    if (params.category) items = items.filter((x) => x.category === String(params.category));
    if (params.goal) items = items.filter((x) => x.goal === String(params.goal));
    if (params.maxMinutes) items = items.filter((x) => x.durationMin <= Number(params.maxMinutes));
    return {
      ok: true,
      result: {
        sessions: items, count: items.length,
        categories: [...new Set(LIBRARY.map((x) => x.category))],
      },
    };
  });

  registerLensAction("meditation", "play", (ctx, _a, params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const track = LIBRARY.find((x) => x.id === params.sessionId);
    if (!track) return { ok: false, error: "session not found in library" };
    const mood = params.mood != null && Number.isFinite(Number(params.mood))
      ? Math.max(1, Math.min(5, Math.round(Number(params.mood)))) : null;
    const entry = {
      id: medId("ms"),
      sessionId: track.id,
      title: track.title,
      category: track.category,
      durationMin: track.durationMin,
      moodAfter: mood,
      completedAt: medNow(),
    };
    medList(s.sessions, medActor(ctx)).push(entry);
    saveMed();
    return { ok: true, result: { session: entry } };
  });

  registerLensAction("meditation", "history", (ctx, _a, _params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = [...medList(s.sessions, medActor(ctx))].reverse().slice(0, 50);
    return { ok: true, result: { sessions, count: sessions.length } };
  });

  registerLensAction("meditation", "streak", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = medList(s.sessions, medActor(ctx));
    const days = new Set(sessions.map((x) => x.completedAt.slice(0, 10)));
    let current = 0;
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (days.has(d)) current++;
      else if (i === 0) continue;
      else break;
    }
    return {
      ok: true,
      result: {
        currentStreak: current,
        totalSessions: sessions.length,
        totalMinutes: sessions.reduce((n, x) => n + x.durationMin, 0),
        daysPracticed: days.size,
        practicedToday: days.has(new Date().toISOString().slice(0, 10)),
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "breathwork", (_ctx, _a, params = {}) => {
    const key = ["box", "478", "coherent"].includes(String(params.pattern)) ? String(params.pattern) : "box";
    // Fail-closed on poisoned numerics — reject NaN/Infinity/1e308 instead of silently clamping.
    if (params.cycles !== undefined && params.cycles !== null && params.cycles !== "") {
      const c = Number(params.cycles);
      if (!Number.isFinite(c)) return { ok: false, error: "invalid_cycles" };
    }
    const cycles = Math.max(1, Math.min(60, Math.round(Number(params.cycles) || 8)));
    const p = BREATH_PATTERNS[key];
    return { ok: true, result: { pattern: key, ...p, cycles, totalSeconds: p.cycleSeconds * cycles } };
  });

  registerLensAction("meditation", "mood-checkin", (ctx, _a, params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const mood = Math.max(1, Math.min(5, Math.round(Number(params.mood) || 3)));
    const entry = {
      id: medId("md"),
      mood,
      note: String(params.note || "").trim().slice(0, 280),
      at: medNow(),
    };
    medList(s.moods, medActor(ctx)).push(entry);
    saveMed();
    return { ok: true, result: { checkin: entry } };
  });

  registerLensAction("meditation", "mood-history", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const moods = medList(s.moods, medActor(ctx));
    const recent = [...moods].reverse().slice(0, 30);
    const avg = moods.length > 0 ? Math.round((moods.reduce((n, m) => n + m.mood, 0) / moods.length) * 10) / 10 : null;
    return { ok: true, result: { moods: recent, averageMood: avg, count: moods.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "meditation-dashboard", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = medActor(ctx);
    const sessions = medList(s.sessions, userId);
    const days = new Set(sessions.map((x) => x.completedAt.slice(0, 10)));
    let streak = 0;
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (days.has(d)) streak++;
      else if (i === 0) continue;
      else break;
    }
    const byCategory = {};
    for (const x of sessions) byCategory[x.category] = (byCategory[x.category] || 0) + 1;
    return {
      ok: true,
      result: {
        totalSessions: sessions.length,
        totalMinutes: sessions.reduce((n, x) => n + x.durationMin, 0),
        currentStreak: streak,
        byCategory,
        moodCheckins: medList(s.moods, userId).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Audio playback — synthesized ambient soundscape descriptors ─────
  // Licensed audio is excluded by design; instead we ship deterministic
  // Web-Audio synthesis recipes the client renders locally (noise tint +
  // oscillator layers + LFO). One descriptor per soundscape / category.

  const SOUNDSCAPES = {
    "sc-rain":   { noise: "pink",  cutoffHz: 1800, layers: [{ type: "noise", gain: 0.42, lfoHz: 0.08, lfoDepth: 0.12 }], droplets: true,  label: "Rainfall" },
    "sc-ocean":  { noise: "brown", cutoffHz: 900,  layers: [{ type: "noise", gain: 0.5,  lfoHz: 0.12, lfoDepth: 0.3 }],  swell: true,     label: "Ocean Waves" },
    "sc-white":  { noise: "white", cutoffHz: 8000, layers: [{ type: "noise", gain: 0.3,  lfoHz: 0,    lfoDepth: 0 }],                     label: "White Noise" },
    "sc-forest": { noise: "pink",  cutoffHz: 4200, layers: [{ type: "noise", gain: 0.28, lfoHz: 0.05, lfoDepth: 0.1 }], birdsong: true,  label: "Forest at Dawn" },
  };
  // Tone bed for guided / sleep / breathwork / sos — a calm drone the
  // client layers under the (silent, text-paced) session.
  const TONE_BEDS = {
    guided:      { drone: [110, 165, 220], gain: 0.16, noise: "pink",  noiseGain: 0.06 },
    sleep_story: { drone: [73.4, 110, 146.8], gain: 0.2, noise: "brown", noiseGain: 0.1 },
    breathwork:  { drone: [98, 147, 196], gain: 0.14, noise: "pink",  noiseGain: 0.04 },
    sos:         { drone: [130.8, 196], gain: 0.12, noise: "pink",  noiseGain: 0.05 },
  };

  registerLensAction("meditation", "soundscapeConfig", (_ctx, _a, params = {}) => {
    const sessionId = String(params.sessionId || "");
    const track = sessionId ? LIBRARY.find((x) => x.id === sessionId) : null;
    if (sessionId && !track) return { ok: false, error: "session not found in library" };
    if (track && SOUNDSCAPES[track.id]) {
      return { ok: true, result: { kind: "soundscape", sessionId: track.id, ...SOUNDSCAPES[track.id] } };
    }
    if (track) {
      const bed = TONE_BEDS[track.category] || TONE_BEDS.guided;
      return { ok: true, result: { kind: "tone_bed", sessionId: track.id, category: track.category, ...bed } };
    }
    // Bare-pattern request (e.g. from the breathwork pacer)
    const cat = String(params.category || "guided");
    const bed = TONE_BEDS[cat] || TONE_BEDS.guided;
    return { ok: true, result: { kind: "tone_bed", category: cat, ...bed } };
  });

  // ─── Multi-session courses / programs ───────────────────────────────
  // Structured day-by-day learning paths. Enrollment + per-day progress
  // are persisted per user in STATE.

  const COURSES = [
    {
      id: "course-basics-7",
      title: "Meditation Basics",
      subtitle: "A 7-day on-ramp to a daily sit",
      goal: "focus",
      days: [
        { day: 1, title: "Arriving", sessionId: "g-morn-7", note: "Just notice you are here." },
        { day: 2, title: "The breath as anchor", sessionId: "g-focus-10", note: "Return, gently, every time." },
        { day: 3, title: "Box breathing", sessionId: "b-box-5", note: "Let the count carry you." },
        { day: 4, title: "Body awareness", sessionId: "g-body-15", note: "Scan from crown to feet." },
        { day: 5, title: "Working with anxiety", sessionId: "g-anx-8", note: "Soften toward what is hard." },
        { day: 6, title: "Coherent breathing", sessionId: "b-coh-6", note: "Find the 5.5-second wave." },
        { day: 7, title: "Gratitude close", sessionId: "g-grat-5", note: "Name what held you this week." },
      ],
    },
    {
      id: "course-sleep-5",
      title: "Sleep Deeper",
      subtitle: "A 5-night wind-down program",
      goal: "sleep",
      days: [
        { day: 1, title: "Letting the day go", sessionId: "b-478-4", note: "Exhale longer than you inhale." },
        { day: 2, title: "A walk in light rain", sessionId: "s-rain-30", note: "Let the story carry you under." },
        { day: 3, title: "Yoga nidra descent", sessionId: "s-nidra-20", note: "Stay just at the edge of sleep." },
        { day: 4, title: "The midnight train", sessionId: "s-train-45", note: "Rhythm of the rails." },
        { day: 5, title: "Nighttime SOS", sessionId: "sos-night-3", note: "A reset for the 3am wake." },
      ],
    },
    {
      id: "course-stress-10",
      title: "Stress Less",
      subtitle: "A 10-day course for an overloaded mind",
      goal: "anxiety",
      days: [
        { day: 1, title: "Naming the load", sessionId: "g-anx-8", note: "What is heavy right now?" },
        { day: 2, title: "Grounding breath", sessionId: "b-box-5", note: "Four corners, steady." },
        { day: 3, title: "SOS reset", sessionId: "sos-panic-3", note: "A 3-minute circuit-breaker." },
        { day: 4, title: "Full body scan", sessionId: "g-body-15", note: "Where do you hold tension?" },
        { day: 5, title: "Coherent breathing", sessionId: "b-coh-6", note: "Slow the nervous system." },
        { day: 6, title: "Single-pointed focus", sessionId: "g-focus-10", note: "One thing at a time." },
        { day: 7, title: "Morning intention", sessionId: "g-morn-7", note: "Set the tone early." },
        { day: 8, title: "4-7-8 wind down", sessionId: "b-478-4", note: "Down-regulate on demand." },
        { day: 9, title: "Gratitude shift", sessionId: "g-grat-5", note: "Redirect the spotlight." },
        { day: 10, title: "Integration", sessionId: "g-focus-10", note: "Carry one practice forward." },
      ],
    },
  ];

  function courseEnrollMap(s) {
    if (!(s.courseEnrollments instanceof Map)) s.courseEnrollments = new Map(); // userId -> Map(courseId -> {completedDays:[], startedAt})
    return s.courseEnrollments;
  }

  registerLensAction("meditation", "courses", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userEnroll = courseEnrollMap(s).get(medActor(ctx)) || new Map();
    const list = COURSES.map((c) => {
      const e = userEnroll.get(c.id);
      return {
        id: c.id, title: c.title, subtitle: c.subtitle, goal: c.goal,
        dayCount: c.days.length,
        enrolled: !!e,
        completedDays: e ? e.completedDays.length : 0,
        startedAt: e ? e.startedAt : null,
      };
    });
    return { ok: true, result: { courses: list, count: list.length } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "enrollCourse", (ctx, _a, params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return { ok: false, error: "course not found" };
    const map = courseEnrollMap(s);
    const userId = medActor(ctx);
    if (!map.has(userId)) map.set(userId, new Map());
    const userEnroll = map.get(userId);
    if (!userEnroll.has(course.id)) {
      userEnroll.set(course.id, { completedDays: [], startedAt: medNow() });
      saveMed();
    }
    return { ok: true, result: { courseId: course.id, enrolled: true } };
  });

  registerLensAction("meditation", "courseProgress", (ctx, _a, params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return { ok: false, error: "course not found" };
    const userEnroll = courseEnrollMap(s).get(medActor(ctx)) || new Map();
    const e = userEnroll.get(course.id) || { completedDays: [], startedAt: null };
    const completed = new Set(e.completedDays);
    const days = course.days.map((d) => ({ ...d, completed: completed.has(d.day) }));
    const nextDay = days.find((d) => !d.completed) || null;
    return {
      ok: true,
      result: {
        courseId: course.id,
        title: course.title,
        subtitle: course.subtitle,
        goal: course.goal,
        startedAt: e.startedAt,
        enrolled: userEnroll.has(course.id),
        days,
        completedCount: completed.size,
        dayCount: days.length,
        nextDay: nextDay ? nextDay.day : null,
        finished: completed.size >= days.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "completeCourseDay", (ctx, _a, params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const course = COURSES.find((c) => c.id === params.courseId);
    if (!course) return { ok: false, error: "course not found" };
    const day = parseInt(params.day, 10);
    const dayDef = course.days.find((d) => d.day === day);
    if (!dayDef) return { ok: false, error: "day not in course" };
    const map = courseEnrollMap(s);
    const userId = medActor(ctx);
    if (!map.has(userId)) map.set(userId, new Map());
    const userEnroll = map.get(userId);
    if (!userEnroll.has(course.id)) userEnroll.set(course.id, { completedDays: [], startedAt: medNow() });
    const e = userEnroll.get(course.id);
    if (!e.completedDays.includes(day)) e.completedDays.push(day);
    // Also log the underlying session into the practice ledger.
    const track = LIBRARY.find((x) => x.id === dayDef.sessionId);
    if (track) {
      medList(s.sessions, userId).push({
        id: medId("ms"),
        sessionId: track.id,
        title: track.title,
        category: track.category,
        durationMin: track.durationMin,
        moodAfter: null,
        completedAt: medNow(),
        courseId: course.id,
        courseDay: day,
      });
    }
    saveMed();
    return {
      ok: true,
      result: {
        courseId: course.id,
        day,
        completedCount: e.completedDays.length,
        finished: e.completedDays.length >= course.days.length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Reminders / scheduled practice ─────────────────────────────────

  function reminderMap(s) {
    if (!(s.reminders instanceof Map)) s.reminders = new Map(); // userId -> Array<reminder>
    return s.reminders;
  }
  const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

  registerLensAction("meditation", "setReminder", (ctx, _a, params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const time = String(params.time || "");
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return { ok: false, error: "time must be HH:MM (24h)" };
    let days = Array.isArray(params.days) ? params.days.map((d) => String(d).toLowerCase()).filter((d) => DOW.includes(d)) : [];
    if (days.length === 0) days = [...DOW];
    const entry = {
      id: medId("rm"),
      time,
      days,
      label: String(params.label || "Time to meditate").trim().slice(0, 80),
      enabled: true,
      createdAt: medNow(),
    };
    medList(reminderMap(s), medActor(ctx)).push(entry);
    saveMed();
    return { ok: true, result: { reminder: entry } };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "reminders", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = medList(reminderMap(s), medActor(ctx));
    const now = new Date();
    const todayKey = DOW[now.getDay()];
    // Compute the next reminder fire, considering only enabled ones.
    let next = null;
    for (const r of list) {
      if (!r.enabled) continue;
      const [h, m] = r.time.split(":").map(Number);
      for (let off = 0; off < 8; off++) {
        const d = new Date(now);
        d.setDate(d.getDate() + off);
        if (!r.days.includes(DOW[d.getDay()])) continue;
        d.setHours(h, m, 0, 0);
        if (d.getTime() <= now.getTime()) continue;
        if (!next || d.getTime() < next.at) next = { reminderId: r.id, label: r.label, at: d.getTime(), iso: d.toISOString() };
        break;
      }
    }
    return {
      ok: true,
      result: {
        reminders: [...list].reverse(),
        count: list.length,
        nextFire: next,
        dueToday: list.filter((r) => r.enabled && r.days.includes(todayKey)).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  registerLensAction("meditation", "toggleReminder", (ctx, _a, params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = medList(reminderMap(s), medActor(ctx));
    const r = list.find((x) => x.id === params.reminderId);
    if (!r) return { ok: false, error: "reminder not found" };
    r.enabled = params.enabled != null ? !!params.enabled : !r.enabled;
    saveMed();
    return { ok: true, result: { reminderId: r.id, enabled: r.enabled } };
  });

  registerLensAction("meditation", "deleteReminder", (ctx, _a, params = {}) => {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const list = medList(reminderMap(s), medActor(ctx));
    const idx = list.findIndex((x) => x.id === params.reminderId);
    if (idx < 0) return { ok: false, error: "reminder not found" };
    list.splice(idx, 1);
    saveMed();
    return { ok: true, result: { deleted: params.reminderId, count: list.length } };
  });

  // ─── Sleep timer + sleep-story mode with fade-out ───────────────────

  registerLensAction("meditation", "sleepTimerConfig", (_ctx, _a, params = {}) => {
    const minutes = Math.max(1, Math.min(480, Math.round(Number(params.minutes) || 20)));
    const fadeSeconds = Math.max(5, Math.min(300, Math.round(Number(params.fadeSeconds) || 45)));
    const sessionId = String(params.sessionId || "");
    let track = null;
    if (sessionId) {
      track = LIBRARY.find((x) => x.id === sessionId);
      if (!track) return { ok: false, error: "session not found in library" };
    }
    const totalSeconds = minutes * 60;
    const fadeStartSeconds = Math.max(0, totalSeconds - fadeSeconds);
    return {
      ok: true,
      result: {
        sessionId: track ? track.id : null,
        sleepStory: track ? track.category === "sleep_story" : false,
        minutes,
        totalSeconds,
        fadeSeconds,
        fadeStartSeconds,
        // Eased volume curve points the client can interpolate against.
        fadeCurve: [
          { atSeconds: fadeStartSeconds, volume: 1 },
          { atSeconds: fadeStartSeconds + fadeSeconds * 0.5, volume: 0.45 },
          { atSeconds: totalSeconds, volume: 0 },
        ],
      },
    };
  });

  // ─── Personalized recommendations — mood + history adaptive ─────────

  registerLensAction("meditation", "recommendations", (ctx, _a, params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = medActor(ctx);
    const sessions = medList(s.sessions, userId);
    const moods = medList(s.moods, userId);
    // Fail-closed: an explicitly-supplied non-finite hour is rejected (absent → current hour).
    if (params.hour !== undefined && params.hour !== null && params.hour !== "" && !Number.isFinite(Number(params.hour))) {
      return { ok: false, error: "invalid_hour" };
    }
    const hour = Number.isFinite(Number(params.hour)) ? Math.max(0, Math.min(23, Math.round(Number(params.hour)))) : new Date().getHours();
    const recentMood = moods.length ? moods[moods.length - 1].mood : null;
    const playedIds = new Set(sessions.map((x) => x.sessionId));
    const catCount = {};
    for (const x of sessions) catCount[x.category] = (catCount[x.category] || 0) + 1;

    // Goal inference: low mood → anxiety; late hours → sleep;
    // morning → focus; otherwise lean toward a balanced session.
    let goal, reason;
    if (recentMood != null && recentMood <= 2) {
      goal = "anxiety"; reason = "Your last check-in was low — something soothing.";
    } else if (hour >= 21 || hour < 5) {
      goal = "sleep"; reason = "It's late — a wind-down before bed.";
    } else if (hour >= 5 && hour < 11) {
      goal = "focus"; reason = "Morning is a strong time to set your attention.";
    } else if (recentMood != null && recentMood >= 4) {
      goal = "gratitude"; reason = "You're in a good place — savour it.";
    } else {
      goal = "calm"; reason = "A balanced session to reset the middle of your day.";
    }

    const scored = LIBRARY
      .map((t) => {
        let score = 0;
        if (t.goal === goal) score += 5;
        if (!playedIds.has(t.id)) score += 2;          // favour fresh tracks
        if ((catCount[t.category] || 0) === 0) score += 1; // nudge toward unexplored categories
        if (recentMood != null && recentMood <= 2 && t.category === "sos") score += 3;
        if ((hour >= 21 || hour < 5) && (t.category === "sleep_story" || t.category === "soundscape")) score += 2;
        return { track: t, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4)
      .map((x) => ({ ...x.track, matchScore: x.score }));

    return {
      ok: true,
      result: {
        goal,
        reason,
        basedOn: { recentMood, totalSessions: sessions.length, hour },
        recommendations: scored,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Milestones / achievements ──────────────────────────────────────

  const MILESTONE_DEFS = [
    { id: "first-sit", label: "First Sit", kind: "sessions", threshold: 1, icon: "🌱", blurb: "You showed up." },
    { id: "ten-sessions", label: "Ten Sessions", kind: "sessions", threshold: 10, icon: "🪴", blurb: "A practice is forming." },
    { id: "fifty-sessions", label: "Fifty Sessions", kind: "sessions", threshold: 50, icon: "🌳", blurb: "Deeply rooted." },
    { id: "streak-3", label: "Three-Day Spark", kind: "streak", threshold: 3, icon: "✨", blurb: "Three days running." },
    { id: "streak-7", label: "Week of Calm", kind: "streak", threshold: 7, icon: "🔥", blurb: "A full week unbroken." },
    { id: "streak-30", label: "Month of Stillness", kind: "streak", threshold: 30, icon: "🏔️", blurb: "Thirty days — extraordinary." },
    { id: "min-60", label: "First Hour", kind: "minutes", threshold: 60, icon: "⏳", blurb: "An hour of presence banked." },
    { id: "min-600", label: "Ten Hours Deep", kind: "minutes", threshold: 600, icon: "💎", blurb: "Ten hours of practice." },
    { id: "explorer", label: "Explorer", kind: "categories", threshold: 4, icon: "🧭", blurb: "Sampled four kinds of practice." },
  ];

  function computeStreak(sessions) {
    const days = new Set(sessions.map((x) => x.completedAt.slice(0, 10)));
    let streak = 0;
    for (let i = 0; i < 366; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      if (days.has(d)) streak++;
      else if (i === 0) continue;
      else break;
    }
    return streak;
  }

  registerLensAction("meditation", "milestones", (ctx, _a, _params = {}) => {
  try {
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const sessions = medList(s.sessions, medActor(ctx));
    const totalSessions = sessions.length;
    const totalMinutes = sessions.reduce((n, x) => n + x.durationMin, 0);
    const streak = computeStreak(sessions);
    const categories = new Set(sessions.map((x) => x.category)).size;
    const metrics = { sessions: totalSessions, minutes: totalMinutes, streak, categories };

    const badges = MILESTONE_DEFS.map((m) => {
      const value = metrics[m.kind] || 0;
      return {
        id: m.id,
        label: m.label,
        icon: m.icon,
        blurb: m.blurb,
        kind: m.kind,
        threshold: m.threshold,
        progress: Math.min(1, value / m.threshold),
        value,
        unlocked: value >= m.threshold,
      };
    });
    const unlocked = badges.filter((b) => b.unlocked);
    const nextUp = badges
      .filter((b) => !b.unlocked)
      .sort((a, b) => b.progress - a.progress)[0] || null;
    return {
      ok: true,
      result: {
        badges,
        unlockedCount: unlocked.length,
        totalCount: badges.length,
        nextUp,
        metrics,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});
}
