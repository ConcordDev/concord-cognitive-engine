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
}
