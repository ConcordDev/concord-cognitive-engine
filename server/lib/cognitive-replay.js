// server/lib/cognitive-replay.js
//
// Cognitive Replay (#3) — a "thinking Wrapped" over the REAL recorded
// deliberations in agent_reasoning_traces (mig 327). It doesn't simulate or
// fabricate; it reads what an agent actually attended to, what surprised it,
// and how its awareness trended, and composes a grounded retrospective. Pure,
// bounded reads (a handful of aggregate queries — no N+1). Never throws.

/**
 * Build a replay for an agent over a window.
 * @param {object} db
 * @param {string} agentId
 * @param {object} [opts]
 * @param {number} [opts.sinceTs]  unix seconds lower bound (default: all time)
 * @param {number} [opts.topN=5]   how many top themes/moments to surface
 * @returns {{ok, agentId, total, byReason, avgAwareness, awarenessTrend, topAttended, surpriseMoments, narrative}}
 */
export function replayForAgent(db, agentId, { sinceTs = 0, topN = 5 } = {}) {
  const aid = String(agentId || "");
  const base = { ok: true, agentId: aid, total: 0, byReason: {}, avgAwareness: 0, awarenessTrend: "flat", topAttended: [], surpriseMoments: [], narrative: "" };
  if (!db || !aid) return { ...base, ok: false, reason: "missing_agent" };
  const since = Number(sinceTs) || 0;
  const n = Math.min(Math.max(Number(topN) || 5, 1), 25);

  try {
    const agg = db.prepare(
      `SELECT COUNT(*) AS total, AVG(awareness_index) AS avgAware, MAX(surprise) AS maxSurprise
       FROM agent_reasoning_traces WHERE agent_id = ? AND created_at >= ?`
    ).get(aid, since);
    const total = agg?.total || 0;
    if (total === 0) return base;

    const byReasonRows = db.prepare(
      `SELECT COALESCE(reason,'unspecified') AS reason, COUNT(*) AS c
       FROM agent_reasoning_traces WHERE agent_id = ? AND created_at >= ?
       GROUP BY reason ORDER BY c DESC`
    ).all(aid, since);
    const byReason = Object.fromEntries(byReasonRows.map((r) => [r.reason, r.c]));

    const topAttended = db.prepare(
      `SELECT attended AS theme, COUNT(*) AS c
       FROM agent_reasoning_traces WHERE agent_id = ? AND created_at >= ? AND attended IS NOT NULL AND attended != ''
       GROUP BY attended ORDER BY c DESC LIMIT ?`
    ).all(aid, since, n).map((r) => ({ theme: r.theme, count: r.c }));

    // The moments that mattered: highest prediction-error wakes.
    const surpriseMoments = db.prepare(
      `SELECT attended AS theme, quale, surprise, awareness_index AS awareness, reason, created_at AS at
       FROM agent_reasoning_traces WHERE agent_id = ? AND created_at >= ? AND surprise IS NOT NULL
       ORDER BY surprise DESC LIMIT ?`
    ).all(aid, since, n);

    // Awareness trend: compare the first vs last third by recency.
    const trendRows = db.prepare(
      `SELECT awareness_index AS a FROM agent_reasoning_traces
       WHERE agent_id = ? AND created_at >= ? AND awareness_index IS NOT NULL ORDER BY created_at ASC`
    ).all(aid, since).map((r) => r.a);
    const awarenessTrend = computeTrend(trendRows);
    const avgAwareness = Math.round((agg?.avgAware || 0) * 1000) / 1000;

    const narrative = composeReplayNarrative({ total, byReason, topAttended, surpriseMoments, awarenessTrend, avgAwareness });
    return { ok: true, agentId: aid, total, byReason, avgAwareness, awarenessTrend, topAttended, surpriseMoments, narrative };
  } catch (e) {
    return { ...base, ok: false, reason: "replay_failed", error: String(e?.message || e) };
  }
}

/** First-third mean vs last-third mean → rising/falling/flat. */
export function computeTrend(series) {
  if (!Array.isArray(series) || series.length < 3) return "flat";
  const k = Math.max(1, Math.floor(series.length / 3));
  const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const first = mean(series.slice(0, k));
  const last = mean(series.slice(-k));
  const delta = last - first;
  if (delta > 0.05) return "rising";
  if (delta < -0.05) return "falling";
  return "flat";
}

/** Deterministic grounded retrospective. */
export function composeReplayNarrative({ total, byReason, topAttended, surpriseMoments, awarenessTrend, avgAwareness }) {
  const topReason = Object.entries(byReason).sort((a, b) => b[1] - a[1])[0];
  const lines = [
    `Across ${total} deliberation${total === 1 ? "" : "s"}, awareness ${awarenessTrend === "flat" ? "held steady" : awarenessTrend} (mean ${avgAwareness}).`,
  ];
  if (topReason) lines.push(`Most often woken by: ${topReason[0]} (${topReason[1]}×).`);
  if (topAttended.length) lines.push(`Recurring focus: ${topAttended.slice(0, 3).map((t) => t.theme).join(", ")}.`);
  if (surpriseMoments.length) {
    const m = surpriseMoments[0];
    lines.push(`Biggest surprise: "${m.theme || m.reason}" (prediction-error ${Math.round((m.surprise || 0) * 100) / 100}).`);
  }
  return lines.join(" ");
}

export default { replayForAgent, computeTrend, composeReplayNarrative };
