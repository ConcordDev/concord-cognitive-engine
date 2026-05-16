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
}
