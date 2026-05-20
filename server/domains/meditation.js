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
  });

  registerLensAction("meditation", "breathwork", (_ctx, _a, params = {}) => {
    const key = ["box", "478", "coherent"].includes(String(params.pattern)) ? String(params.pattern) : "box";
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
    const s = getMedState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const moods = medList(s.moods, medActor(ctx));
    const recent = [...moods].reverse().slice(0, 30);
    const avg = moods.length > 0 ? Math.round((moods.reduce((n, m) => n + m.mood, 0) / moods.length) * 10) / 10 : null;
    return { ok: true, result: { moods: recent, averageMood: avg, count: moods.length } };
  });

  registerLensAction("meditation", "meditation-dashboard", (ctx, _a, _params = {}) => {
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
  });
}
