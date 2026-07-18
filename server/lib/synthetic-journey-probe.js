// server/lib/synthetic-journey-probe.js
//
// E6 / Track C-L5 — synthetic-journey probe (post-deploy drift monitor).
//
// Two checks, both reusable as a scheduled probe (run via
// scripts/synthetic-journey-probe.mjs, cron'd in synthetic-journey.yml):
//
//  1) runJourneyProbe()    — reuses the authored first-cycle journey logic
//     (tutorial-first-cycle.js#deriveFirstCycleProgress) against an in-memory
//     replica of System B's real schema (world_quests/player_quests/
//     quest_objectives/player_quest_progress): completes the 8 first-cycle
//     quests and asserts the derivation reaches `complete`. Catches a
//     "journey break" (a quest-chain regression that strands new players)
//     without a live server.
//
//     Prior to 2026-07, this seeded the dead `quest_progress` (singular)
//     table — the derivation no longer reads that table at all (it had zero
//     production writers; see docs/QUESTS_ENGINE_INVESTIGATION.md), so this
//     probe was itself masking the real break instead of catching it: it
//     kept reporting green against a schema no live code path used.
//
//  2) runSsePulseCheck()   — asserts the SSE transport streams INCREMENTALLY:
//     the four proxy-chain headers are set, headers are flushed, and heartbeat
//     frames arrive over time (not buffered into one blob at the end). In
//     live mode (baseUrl given) it opens a real SSE endpoint and asserts the
//     first frame arrives within a latency budget + multiple frames stream.
//     This is the "SSE buffering" post-deploy drift the L5 tier names.
//
// Neither throws — a probe must report a structured verdict, never crash.

import Database from "better-sqlite3";
import { startSSE } from "./sse.js";
import { deriveFirstCycleProgress, FIRST_CYCLE_QUEST_IDS } from "./tutorial-first-cycle.js";

// Minimal replica of the real System B schema (migrations 042 + 068) —
// only the columns deriveFirstCycleProgress's getActiveQuests /
// getCompletedQuests / getQuestProgress calls actually touch.
const SYSTEM_B_DDL = `
  CREATE TABLE world_quests (
    id             TEXT PRIMARY KEY,
    world_id       TEXT NOT NULL,
    giver_npc_id   TEXT,
    title          TEXT NOT NULL,
    description    TEXT,
    objectives_json TEXT DEFAULT '[]',
    reward_json    TEXT DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'available',
    created_at     INTEGER NOT NULL DEFAULT (unixepoch()),
    accepted_by    TEXT,
    completed_at   INTEGER
  );
  CREATE TABLE player_quests (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    quest_id     TEXT NOT NULL,
    world_id     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active',
    completed_at INTEGER,
    rewarded_at  INTEGER,
    accepted_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, world_id, quest_id)
  );
  CREATE TABLE quest_objectives (
    id             TEXT PRIMARY KEY,
    quest_id       TEXT NOT NULL,
    type           TEXT NOT NULL,
    target         TEXT NOT NULL,
    required_count INTEGER DEFAULT 1,
    description    TEXT,
    order_index    INTEGER DEFAULT 0
  );
  CREATE TABLE player_quest_progress (
    id            TEXT PRIMARY KEY,
    user_id       TEXT NOT NULL,
    world_id      TEXT NOT NULL,
    quest_id      TEXT NOT NULL,
    objective_id  TEXT NOT NULL,
    current_count INTEGER DEFAULT 0,
    completed_at  INTEGER,
    UNIQUE(user_id, world_id, quest_id, objective_id)
  );
  CREATE TABLE quest_rewards (
    id          TEXT PRIMARY KEY,
    quest_id    TEXT NOT NULL,
    reward_type TEXT NOT NULL,
    reward_key  TEXT,
    amount      INTEGER DEFAULT 100
  );`;

/**
 * In-memory replay of the authored first-cycle journey. Completes every
 * first-cycle quest and asserts the derivation reports `complete`.
 * @returns {{ok:boolean, complete?:boolean, currentPhase?:string, phasesTotal?:number, durationMs:number, error?:string}}
 */
export function runJourneyProbe() {
  const t0 = Date.now();
  let db;
  try {
    db = new Database(":memory:");
    db.exec(SYSTEM_B_DDL);
    const userId = "probe_user";
    const worldId = "concordia-hub";
    const insertQuest = db.prepare(`
      INSERT INTO world_quests (id, world_id, title, status) VALUES (?, ?, ?, 'available')
    `);
    const insertPlayerQuest = db.prepare(`
      INSERT INTO player_quests (id, user_id, quest_id, world_id, status, completed_at)
      VALUES (?, ?, ?, ?, 'completed', unixepoch())
    `);
    for (const qid of FIRST_CYCLE_QUEST_IDS) {
      insertQuest.run(qid, worldId, qid);
      insertPlayerQuest.run(`pq_${qid}`, userId, qid, worldId);
    }

    const r = deriveFirstCycleProgress({ db, userId, worldId }) || {};
    const complete = r.complete === true && r.currentPhase === "complete";
    return {
      ok: complete,
      complete: r.complete === true,
      currentPhase: r.currentPhase,
      phasesTotal: Array.isArray(r.phases) ? r.phases.length : 0,
      durationMs: Date.now() - t0,
      ...(complete ? {} : { error: `journey did not reach complete (phase=${r.currentPhase})` }),
    };
  } catch (err) {
    return { ok: false, durationMs: Date.now() - t0, error: String(err?.message || err) };
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// Minimal Express-response stub mirroring tests/sse.test.js#mockRes.
function makeMockRes() {
  const headers = {};
  const writes = [];
  const listeners = {};
  const res = {
    headers, writes, _flushed: false,
    setHeader: (k, v) => { headers[String(k).toLowerCase()] = v; },
    flushHeaders: () => { res._flushed = true; },
    write: (s) => { writes.push(s); return true; },
    on: (ev, fn) => { listeners[ev] = fn; },
    _fire: (ev) => listeners[ev]?.(),
  };
  return res;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * SSE incremental-stream + heartbeat check.
 * @param {object} [opts]
 * @param {string} [opts.baseUrl]  if set, run LIVE against `${baseUrl}${path}`.
 * @param {string} [opts.path]     live SSE path (default /api/chat-agent/stream — but any event-stream works).
 * @param {number} [opts.firstByteBudgetMs] live first-frame latency budget (default 2000).
 * @param {number} [opts.windowMs] live observation window (default 5000).
 * @returns {Promise<{ok:boolean, mode:string, headersOk?:boolean, heartbeats?:number, frames?:number, firstByteMs?:number|null, error?:string}>}
 */
export async function runSsePulseCheck({ baseUrl, path = "/api/chat-agent/stream", firstByteBudgetMs = 2000, windowMs = 5000, fetchImpl } = {}) {
  // ── Self-contained mode: exercise the transport directly. ────────────────
  if (!baseUrl) {
    try {
      const res = makeMockRes();
      let flushed = false;
      res.flushHeaders = () => { flushed = true; };
      const stop = startSSE(res, { heartbeatMs: 10 });
      // Simulate an incremental producer (status → tokens → done).
      const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      send("status", { phase: "started" });
      await sleep(15);
      send("token", { chunk: "hello" });
      await sleep(20); // allow ≥2 heartbeats at 10ms cadence
      send("done", { ok: true });
      stop();
      const heartbeats = res.writes.filter((w) => w === ":keepalive\n\n").length;
      const frames = res.writes.filter((w) => w.startsWith("event:")).length;
      const headersOk =
        res.headers["content-type"] === "text/event-stream" &&
        res.headers["cache-control"] === "no-cache, no-transform" &&
        res.headers["x-accel-buffering"] === "no" &&
        flushed;
      const ok = headersOk && heartbeats >= 2 && frames >= 3;
      return { ok, mode: "self", headersOk, heartbeats, frames, ...(ok ? {} : { error: `headersOk=${headersOk} heartbeats=${heartbeats} frames=${frames}` }) };
    } catch (err) {
      return { ok: false, mode: "self", error: String(err?.message || err) };
    }
  }

  // ── Live mode: stream a real endpoint, assert incremental delivery. ──────
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") return { ok: false, mode: "live", error: "no_fetch" };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), windowMs);
  try {
    const r = await doFetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ message: "probe: say hi", maxTurns: 1 }),
      signal: ctrl.signal,
    });
    const ctype = String(r.headers?.get?.("content-type") || "");
    if (!r.body || !ctype.includes("text/event-stream")) {
      return { ok: false, mode: "live", error: `not an event-stream (status=${r.status}, content-type=${ctype})` };
    }
    let frames = 0;
    let firstByteMs = null;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    while (Date.now() - t0 < windowMs) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      if (firstByteMs === null && chunk.trim()) firstByteMs = Date.now() - t0;
      frames += (chunk.match(/^(event:|data:|:)/gm) || []).length;
      if (frames >= 2 && firstByteMs !== null) break; // proven incremental
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const ok = frames >= 2 && firstByteMs !== null && firstByteMs <= firstByteBudgetMs;
    return { ok, mode: "live", frames, firstByteMs, ...(ok ? {} : { error: `frames=${frames} firstByteMs=${firstByteMs} budget=${firstByteBudgetMs}` }) };
  } catch (err) {
    return { ok: false, mode: "live", error: String(err?.name === "AbortError" ? "no_incremental_frames_in_window" : (err?.message || err)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Run both checks; structured verdict for a scheduled probe. */
export async function runSyntheticJourneyProbe({ baseUrl } = {}) {
  const journey = runJourneyProbe();
  const sse = await runSsePulseCheck({ baseUrl });
  return { ok: !!(journey.ok && sse.ok), journey, sse, at: Date.now() };
}

export default runSyntheticJourneyProbe;
