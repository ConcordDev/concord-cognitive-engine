// server/domains/cognitive-replay.js
//
// Cognitive Replay lens — a Spotify-Wrapped / RescueTime-style scrubber
// over the user's cognitive timeline. The base `chat.timeline` macro
// already exposes per-turn events; this domain adds the aggregate,
// filter, summary, heatmap, compare and snapshot layers that turn a raw
// event list into a real personal-activity timeline app.
//
// Every value is computed from the live session corpus on
// globalThis._concordSTATE.sessions (the same source chat.timeline
// reads) — no synthesized or seeded data. Shareable snapshots persist
// per-user in globalThis._concordSTATE.cognitiveReplay (a Map keyed by
// userId), debounce-saved like the rest of STATE.
//
// NEW DOMAIN FILE: cognitive-replay.js

import crypto from "node:crypto";

export default function registerCognitiveReplayActions(registerLensAction) {

  // ── persistent per-user state ──────────────────────────────────────
  function getReplayState() {
    const STATE = globalThis._concordSTATE || (globalThis._concordSTATE = {});
    if (!STATE.cognitiveReplay) STATE.cognitiveReplay = {};
    const s = STATE.cognitiveReplay;
    // snapshots: userId -> Array<snapshot>
    if (!(s.snapshots instanceof Map)) s.snapshots = new Map();
    return s;
  }
  function saveReplayState() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }

  const uid = (ctx) => ctx?.actor?.userId || ctx?.userId || null;
  const param = (artifact, params, key) =>
    (params && params[key] !== undefined ? params[key]
      : (artifact?.data && artifact.data[key] !== undefined ? artifact.data[key]
        : undefined));
  const DAY_MS = 86400000;
  const HOUR_MS = 3600000;

  // Fail-CLOSED reject of poisoned numeric inputs (NaN/Infinity/1e308/negative)
  // BEFORE any aggregation. The `Number(x) || default` pattern silently masks a
  // poisoned value (and a poisoned fromTs=Infinity even survives `|| null`),
  // producing a misleading ok:true; this rejects it with an honest error. Reads
  // through `param()` so both params and artifact.data inputs are guarded. An
  // absent field is fine (the macro uses its default).
  const POISON_MAX = 1e15; // timestamps are ms epoch (~1.7e12), so allow large
  function badNumericField(artifact, params, keys) {
    for (const k of keys) {
      const raw = param(artifact, params, k);
      if (raw === undefined || raw === null || raw === "") continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > POISON_MAX) return k;
    }
    return null;
  }

  // ── pull the live event corpus for a user ──────────────────────────
  // Mirrors chat.timeline's sweep so the lens shares one source of
  // truth. Returns chronologically-sorted events (oldest → newest).
  function collectEvents(userId, { sessionId = null, limit = 2000 } = {}) {
    const STATE = globalThis._concordSTATE;
    const events = [];
    if (!STATE?.sessions || typeof STATE.sessions.entries !== "function") return events;
    for (const [sid, sess] of STATE.sessions.entries()) {
      if (!sess || sess.userId !== userId) continue;
      if (sessionId && sid !== sessionId) continue;
      const msgs = Array.isArray(sess.messages) ? sess.messages : [];
      for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        const meta = m?.meta || {};
        events.push({
          eventId: `${sid}:${i}`,
          sessionId: sid,
          turnIndex: i,
          ts: m?.ts || m?.timestamp || null,
          role: m?.role || "unknown",
          brainsUsed: Array.isArray(meta.brainsUsed) ? meta.brainsUsed
            : (Array.isArray(meta.brains) ? meta.brains : []),
          toolCalls: Array.isArray(meta.toolCalls) ? meta.toolCalls : [],
          dtusCited: Array.isArray(meta.dtusCited) ? meta.dtusCited : [],
          tokenCount: Number.isFinite(meta.tokenCount) ? meta.tokenCount : null,
          contentPreview: typeof m?.content === "string" ? m.content.slice(0, 240) : null,
        });
      }
    }
    events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    if (events.length > limit) return events.slice(events.length - limit);
    return events;
  }

  function dayKey(ts) {
    if (!ts) return "unknown";
    return new Date(ts).toISOString().slice(0, 10);
  }

  // Shared aggregation over an event array.
  function aggregate(events) {
    let totalTokens = 0;
    let totalToolCalls = 0;
    let totalCitations = 0;
    const brainCounts = {};
    const toolCounts = {};
    const sessions = new Set();
    const perDay = {};
    let firstTs = null;
    let lastTs = null;
    for (const e of events) {
      totalTokens += e.tokenCount || 0;
      totalToolCalls += e.toolCalls.length;
      totalCitations += e.dtusCited.length;
      if (e.sessionId) sessions.add(e.sessionId);
      for (const b of e.brainsUsed) brainCounts[b] = (brainCounts[b] || 0) + 1;
      for (const t of e.toolCalls) {
        const name = (t && (t.name || t.tool || t.type)) || "tool";
        toolCounts[name] = (toolCounts[name] || 0) + 1;
      }
      if (e.ts) {
        const dk = dayKey(e.ts);
        if (!perDay[dk]) perDay[dk] = { turns: 0, tokens: 0 };
        perDay[dk].turns += 1;
        perDay[dk].tokens += e.tokenCount || 0;
        if (firstTs == null || e.ts < firstTs) firstTs = e.ts;
        if (lastTs == null || e.ts > lastTs) lastTs = e.ts;
      }
    }
    const brainRank = Object.entries(brainCounts).sort((a, b) => b[1] - a[1]);
    const toolRank = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
    const dayRank = Object.entries(perDay).sort((a, b) => b[1].turns - a[1].turns);
    return {
      turns: events.length,
      sessions: sessions.size,
      totalTokens,
      totalToolCalls,
      totalCitations,
      brainCounts,
      toolCounts,
      perDay,
      topBrain: brainRank[0] ? { brain: brainRank[0][0], turns: brainRank[0][1] } : null,
      topTool: toolRank[0] ? { tool: toolRank[0][0], count: toolRank[0][1] } : null,
      busiestDay: dayRank[0] ? { day: dayRank[0][0], turns: dayRank[0][1].turns } : null,
      avgTokensPerTurn: events.length ? Math.round(totalTokens / events.length) : 0,
      firstTs,
      lastTs,
      spanDays: (firstTs != null && lastTs != null)
        ? Math.max(1, Math.round((lastTs - firstTs) / DAY_MS) + 1) : 0,
    };
  }

  // ── 1. stats — aggregate stats over a date range ───────────────────
  registerLensAction("cognitive-replay", "stats", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const badField = badNumericField(artifact, params, ["sinceDays"]);
      if (badField) return { ok: false, error: `invalid_${badField}` };
      const sinceDays = Math.min(365, Math.max(1, Number(param(artifact, params, "sinceDays")) || 7));
      const all = collectEvents(userId);
      const cutoff = Date.now() - sinceDays * DAY_MS;
      const events = all.filter((e) => !e.ts || e.ts >= cutoff);
      const agg = aggregate(events);
      return {
        ok: true,
        result: {
          sinceDays,
          turns: agg.turns,
          sessions: agg.sessions,
          totalTokens: agg.totalTokens,
          avgTokensPerTurn: agg.avgTokensPerTurn,
          totalToolCalls: agg.totalToolCalls,
          totalCitations: agg.totalCitations,
          topBrain: agg.topBrain,
          topTool: agg.topTool,
          busiestDay: agg.busiestDay,
          brainCounts: agg.brainCounts,
          firstTs: agg.firstTs,
          lastTs: agg.lastTs,
          spanDays: agg.spanDays,
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Aggregate cognitive stats: tokens, top brain, busiest day, sessions." });

  // ── 2. filter — filtered timeline ──────────────────────────────────
  registerLensAction("cognitive-replay", "filter", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const badField = badNumericField(artifact, params, ["fromTs", "toTs", "limit"]);
      if (badField) return { ok: false, error: `invalid_${badField}` };
      const brain = param(artifact, params, "brain");
      const tool = param(artifact, params, "tool");
      const role = param(artifact, params, "role");
      const sessionId = param(artifact, params, "sessionId");
      const fromTs = Number(param(artifact, params, "fromTs")) || null;
      const toTs = Number(param(artifact, params, "toTs")) || null;
      const limit = Math.min(1000, Math.max(1, Number(param(artifact, params, "limit")) || 300));

      let events = collectEvents(userId, { sessionId: sessionId || null });
      if (brain) events = events.filter((e) => e.brainsUsed.includes(brain));
      if (role) events = events.filter((e) => e.role === role);
      if (tool) {
        events = events.filter((e) => e.toolCalls.some((t) =>
          ((t && (t.name || t.tool || t.type)) || "tool") === tool));
      }
      if (fromTs) events = events.filter((e) => e.ts && e.ts >= fromTs);
      if (toTs) events = events.filter((e) => e.ts && e.ts <= toTs);
      const total = events.length;
      if (events.length > limit) events = events.slice(events.length - limit);

      // Surface the facet values the UI needs for filter dropdowns.
      const allAgg = aggregate(collectEvents(userId, { sessionId: sessionId || null }));
      return {
        ok: true,
        result: {
          events,
          count: events.length,
          totalMatching: total,
          facets: {
            brains: Object.keys(allAgg.brainCounts).sort(),
            tools: Object.keys(allAgg.toolCounts).sort(),
            roles: ["user", "assistant", "system"],
          },
          appliedFilters: { brain: brain || null, tool: tool || null, role: role || null, sessionId: sessionId || null, fromTs, toTs },
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Timeline events filtered by brain / tool / role / session / date range." });

  // ── 3. wrapped — Spotify-Wrapped-style summary cards ───────────────
  registerLensAction("cognitive-replay", "wrapped", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const badField = badNumericField(artifact, params, ["sinceDays"]);
      if (badField) return { ok: false, error: `invalid_${badField}` };
      const sinceDays = Math.min(365, Math.max(1, Number(param(artifact, params, "sinceDays")) || 7));
      const cutoff = Date.now() - sinceDays * DAY_MS;
      const events = collectEvents(userId).filter((e) => !e.ts || e.ts >= cutoff);
      const agg = aggregate(events);

      // Personality archetype derived from the brain that did most work.
      const ARCHETYPE = {
        conscious: "The Deep Thinker", subconscious: "The Dreamer",
        utility: "The Quick Operator", repair: "The Debugger",
        vision: "The Observer",
      };
      const archetype = agg.topBrain ? (ARCHETYPE[agg.topBrain.brain] || "The Generalist") : "The Generalist";

      // Most productive hour-of-day.
      const hourCounts = new Array(24).fill(0);
      for (const e of events) if (e.ts) hourCounts[new Date(e.ts).getHours()] += 1;
      let peakHour = 0;
      for (let h = 1; h < 24; h++) if (hourCounts[h] > hourCounts[peakHour]) peakHour = h;

      const cards = [
        { id: "turns", title: "Turns of thought", value: agg.turns, caption: `across ${agg.sessions} session${agg.sessions === 1 ? "" : "s"}` },
        { id: "tokens", title: "Tokens processed", value: agg.totalTokens, caption: `~${agg.avgTokensPerTurn} per turn` },
        { id: "brain", title: "Your dominant brain", value: agg.topBrain ? agg.topBrain.brain : "—", caption: agg.topBrain ? `${agg.topBrain.turns} activations` : "no activity" },
        { id: "archetype", title: "Your cognitive archetype", value: archetype, caption: agg.topBrain ? `powered by the ${agg.topBrain.brain} brain` : "start a chat to discover yours" },
        { id: "busiest", title: "Busiest day", value: agg.busiestDay ? agg.busiestDay.day : "—", caption: agg.busiestDay ? `${agg.busiestDay.turns} turns` : "no activity" },
        { id: "peak-hour", title: "Peak thinking hour", value: agg.turns ? `${String(peakHour).padStart(2, "0")}:00` : "—", caption: agg.turns ? `${hourCounts[peakHour]} turns happened then` : "no activity" },
        { id: "citations", title: "Knowledge cited", value: agg.totalCitations, caption: `DTUs referenced` },
        { id: "tools", title: "Tools invoked", value: agg.totalToolCalls, caption: agg.topTool ? `favourite: ${agg.topTool.tool}` : "no tools used" },
      ];
      return { ok: true, result: { sinceDays, archetype, peakHour, cards } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Wrapped-style summary cards — your week (or window) in cognition." });

  // ── 4. heatmap — calendar / hour activity intensity ────────────────
  registerLensAction("cognitive-replay", "heatmap", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const sinceDays = Math.min(365, Math.max(7, Number(param(artifact, params, "sinceDays")) || 28));
      const cutoff = Date.now() - sinceDays * DAY_MS;
      const events = collectEvents(userId).filter((e) => e.ts && e.ts >= cutoff);

      // Calendar: one cell per day in the window.
      const startDay = new Date(cutoff);
      startDay.setHours(0, 0, 0, 0);
      const days = [];
      const byDay = {};
      for (const e of events) {
        const dk = dayKey(e.ts);
        if (!byDay[dk]) byDay[dk] = { turns: 0, tokens: 0 };
        byDay[dk].turns += 1;
        byDay[dk].tokens += e.tokenCount || 0;
      }
      for (let t = startDay.getTime(); t <= Date.now(); t += DAY_MS) {
        const dk = new Date(t).toISOString().slice(0, 10);
        const cell = byDay[dk] || { turns: 0, tokens: 0 };
        days.push({ day: dk, weekday: new Date(t).getDay(), turns: cell.turns, tokens: cell.tokens });
      }
      const maxDayTurns = days.reduce((m, d) => Math.max(m, d.turns), 0);

      // Hour-of-week grid: 7 weekdays × 24 hours.
      const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
      for (const e of events) {
        const d = new Date(e.ts);
        grid[d.getDay()][d.getHours()] += 1;
      }
      let maxCell = 0;
      for (const row of grid) for (const v of row) if (v > maxCell) maxCell = v;

      return {
        ok: true,
        result: { sinceDays, days, maxDayTurns, hourGrid: grid, maxCell, totalActiveDays: days.filter((d) => d.turns > 0).length },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Calendar + hour-of-week heatmap of cognitive activity intensity." });

  // ── 5. event — single-event detail + jump-to-conversation link ─────
  registerLensAction("cognitive-replay", "event", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const eventId = param(artifact, params, "eventId");
      if (!eventId) return { ok: false, error: "missing_eventId" };
      const colon = String(eventId).lastIndexOf(":");
      if (colon < 0) return { ok: false, error: "bad_eventId" };
      const sessionId = String(eventId).slice(0, colon);
      const turnIndex = Number(String(eventId).slice(colon + 1));
      const events = collectEvents(userId, { sessionId });
      const event = events.find((e) => e.eventId === eventId) || null;
      if (!event) return { ok: false, error: "event_not_found" };
      // The deep-link the UI uses to jump back to that conversation.
      const jumpTo = { lens: "chat", sessionId, turnIndex, url: `/lenses/chat?session=${encodeURIComponent(sessionId)}&turn=${turnIndex}` };
      return { ok: true, result: { event, jumpTo } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Full event detail + a deep-link to jump to that conversation turn." });

  // ── 6. compare — two time windows side by side ─────────────────────
  registerLensAction("cognitive-replay", "compare", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      // windowDays defaults to 7; windowA is the most recent window,
      // windowB the one immediately before it.
      const windowDays = Math.min(180, Math.max(1, Number(param(artifact, params, "windowDays")) || 7));
      const aStart = Number(param(artifact, params, "aStart")) || (Date.now() - windowDays * DAY_MS);
      const aEnd = Number(param(artifact, params, "aEnd")) || Date.now();
      const bStart = Number(param(artifact, params, "bStart")) || (aStart - windowDays * DAY_MS);
      const bEnd = Number(param(artifact, params, "bEnd")) || aStart;
      const all = collectEvents(userId);
      const inWin = (e, s, en) => e.ts && e.ts >= s && e.ts < en;
      const aAgg = aggregate(all.filter((e) => inWin(e, aStart, aEnd)));
      const bAgg = aggregate(all.filter((e) => inWin(e, bStart, bEnd)));
      const delta = (a, b) => ({ a, b, change: a - b, pct: b ? Math.round(((a - b) / b) * 100) : (a ? 100 : 0) });
      return {
        ok: true,
        result: {
          windowA: { start: aStart, end: aEnd, ...summarise(aAgg) },
          windowB: { start: bStart, end: bEnd, ...summarise(bAgg) },
          deltas: {
            turns: delta(aAgg.turns, bAgg.turns),
            tokens: delta(aAgg.totalTokens, bAgg.totalTokens),
            sessions: delta(aAgg.sessions, bAgg.sessions),
            citations: delta(aAgg.totalCitations, bAgg.totalCitations),
            toolCalls: delta(aAgg.totalToolCalls, bAgg.totalToolCalls),
          },
        },
      };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Compare two cognitive time windows — turns, tokens, brains, deltas." });

  function summarise(agg) {
    return {
      turns: agg.turns, sessions: agg.sessions, totalTokens: agg.totalTokens,
      totalToolCalls: agg.totalToolCalls, totalCitations: agg.totalCitations,
      topBrain: agg.topBrain, brainCounts: agg.brainCounts,
    };
  }

  // ── 7. snapshot — create / list / get a shareable replay snapshot ──
  registerLensAction("cognitive-replay", "snapshot-create", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const sinceDays = Math.min(365, Math.max(1, Number(param(artifact, params, "sinceDays")) || 7));
      const title = String(param(artifact, params, "title") || `Cognition · last ${sinceDays}d`).trim().slice(0, 120);
      const cutoff = Date.now() - sinceDays * DAY_MS;
      const events = collectEvents(userId).filter((e) => !e.ts || e.ts >= cutoff);
      const agg = aggregate(events);
      if (agg.turns === 0) return { ok: false, error: "no_activity_to_snapshot" };

      const s = getReplayState();
      const shareId = crypto.randomBytes(8).toString("hex");
      const snapshot = {
        shareId,
        title,
        ownerId: userId,
        createdAt: Date.now(),
        sinceDays,
        // Frozen aggregate — a snapshot is immutable so the share link
        // shows the cognition state at capture time, not now.
        stats: {
          turns: agg.turns, sessions: agg.sessions, totalTokens: agg.totalTokens,
          avgTokensPerTurn: agg.avgTokensPerTurn, totalToolCalls: agg.totalToolCalls,
          totalCitations: agg.totalCitations, topBrain: agg.topBrain,
          busiestDay: agg.busiestDay, brainCounts: agg.brainCounts,
        },
      };
      const list = s.snapshots.get(userId) || [];
      list.unshift(snapshot);
      if (list.length > 50) list.length = 50;
      s.snapshots.set(userId, list);
      saveReplayState();
      return { ok: true, result: { shareId, snapshot, shareUrl: `/lenses/cognitive-replay?snapshot=${shareId}` } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Capture an immutable, shareable snapshot of your cognitive week." });

  registerLensAction("cognitive-replay", "snapshot-list", (ctx, _artifact, _params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const s = getReplayState();
      const list = s.snapshots.get(userId) || [];
      return { ok: true, result: { snapshots: list, count: list.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "List the caller's saved cognitive snapshots." });

  registerLensAction("cognitive-replay", "snapshot-get", (ctx, artifact, params) => {
    try {
      const shareId = param(artifact, params, "shareId");
      if (!shareId) return { ok: false, error: "missing_shareId" };
      const s = getReplayState();
      // Snapshots are shareable — scan every user's list by shareId so a
      // recipient who isn't the owner can still open the link.
      for (const list of s.snapshots.values()) {
        const hit = (list || []).find((sn) => sn.shareId === shareId);
        if (hit) return { ok: true, result: { snapshot: hit } };
      }
      return { ok: false, error: "snapshot_not_found" };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Open a shared cognitive snapshot by its share id." });

  registerLensAction("cognitive-replay", "snapshot-delete", (ctx, artifact, params) => {
    try {
      const userId = uid(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const shareId = param(artifact, params, "shareId");
      if (!shareId) return { ok: false, error: "missing_shareId" };
      const s = getReplayState();
      const list = s.snapshots.get(userId) || [];
      const next = list.filter((sn) => sn.shareId !== shareId);
      if (next.length === list.length) return { ok: false, error: "snapshot_not_found" };
      s.snapshots.set(userId, next);
      saveReplayState();
      return { ok: true, result: { deleted: shareId, remaining: next.length } };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }, { note: "Delete one of the caller's own cognitive snapshots." });
}
