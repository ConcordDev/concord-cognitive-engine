/**
 * Tier-2 contract tests for Phase 3 — Personal Beat Scheduler.
 *
 * Pinned:
 *   - kill-switch CONCORD_PERSONAL_BEATS=0 returns disabled
 *   - no-db / no-online-table early returns
 *   - scheduling: open-beat skip; confidence×novelty pick; INSERT row
 *   - TTL expiry: beats older than 24h get outcome='expired'
 *   - realiseBeat: success cascade (forward-sim + metric shift); idempotent
 *   - findOpenBeatBySubject: subject-keyed lookup
 *   - listBeatsForUser: HUD read tolerant of missing table
 *
 * Run: node --test tests/personal-beat-scheduler.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runPersonalBeatScheduler,
  realiseBeat,
  findOpenBeatBySubject,
  listBeatsForUser,
  _internal,
} from "../emergent/personal-beat-scheduler.js";

// ── Fake DB ────────────────────────────────────────────────────────────────

function makeFakeDb() {
  const tables = {
    player_beats: new Map(),
    forward_predictions: new Map(),
    world_visits: new Map(),
    player_world_metrics: new Map(),
  };

  function prepare(sql) {
    const s = sql.replace(/\s+/g, " ").trim();
    return {
      run: (...a) => runStmt(s, a),
      get: (...a) => getStmt(s, a),
      all: (...a) => allStmt(s, a),
    };
  }
  function transaction(fn) { return (...args) => fn(...args); }

  function runStmt(sql, args) {
    if (sql.startsWith("UPDATE player_beats SET completed_at = unixepoch(), outcome = 'expired'")) {
      const [cutoff] = args;
      let n = 0;
      for (const b of tables.player_beats.values()) {
        if (b.completed_at == null && b.surfaced_at < cutoff) {
          b.completed_at = Math.floor(Date.now() / 1000);
          b.outcome = "expired";
          n++;
        }
      }
      return { changes: n };
    }
    if (sql.startsWith("INSERT INTO player_beats")) {
      const [id, userId, worldId, predictionId, prose] = args;
      tables.player_beats.set(id, {
        id, user_id: userId, world_id: worldId, prediction_id: predictionId,
        prose, surfaced_at: Math.floor(Date.now() / 1000),
        completed_at: null, outcome: null,
      });
      return { changes: 1 };
    }
    if (sql.startsWith("UPDATE player_beats SET completed_at = unixepoch(), outcome = ?")) {
      const [outcome, id] = args;
      const b = tables.player_beats.get(id);
      if (b && b.completed_at == null) {
        b.completed_at = Math.floor(Date.now() / 1000);
        b.outcome = outcome;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE player_world_metrics SET concordia_alignment")) {
      const [userId, worldId] = args;
      const k = `${userId}|${worldId}`;
      const m = tables.player_world_metrics.get(k);
      if (m) {
        m.concordia_alignment = Math.min(1.0, (m.concordia_alignment || 0) + 0.05);
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE player_world_metrics SET refusal_debt")) {
      const [userId, worldId] = args;
      const k = `${userId}|${worldId}`;
      const m = tables.player_world_metrics.get(k);
      if (m) {
        m.refusal_debt = Math.min(1.0, (m.refusal_debt || 0) + 0.02);
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    if (sql.startsWith("UPDATE forward_predictions")) {
      const [outcomeJson, id] = args;
      const p = tables.forward_predictions.get(id);
      if (p && p.realised_at == null) {
        p.realised_at = Math.floor(Date.now() / 1000);
        p.reality_outcome = outcomeJson;
        return { changes: 1 };
      }
      return { changes: 0 };
    }
    return { changes: 0 };
  }

  function getStmt(sql, args) {
    if (sql.startsWith("SELECT * FROM player_beats WHERE id = ?")) {
      return tables.player_beats.get(args[0]) || null;
    }
    if (sql.startsWith("SELECT id FROM player_beats WHERE user_id = ? AND completed_at IS NULL")) {
      const [userId] = args;
      for (const b of tables.player_beats.values()) {
        if (b.user_id === userId && b.completed_at == null) return { id: b.id };
      }
      return null;
    }
    if (sql.startsWith("SELECT MAX(surfaced_at) AS last_at FROM player_beats")) {
      const [userId, _u2, subjectKind] = args;
      let lastAt = null;
      for (const b of tables.player_beats.values()) {
        if (b.user_id !== userId) continue;
        const p = tables.forward_predictions.get(b.prediction_id);
        if (!p || p.subject_kind !== subjectKind) continue;
        if (lastAt == null || b.surfaced_at > lastAt) lastAt = b.surfaced_at;
      }
      return { last_at: lastAt };
    }
    if (sql.startsWith("SELECT pb.* FROM player_beats pb JOIN forward_predictions fp")) {
      const [userId, subjectKind, subjectId] = args;
      for (const b of tables.player_beats.values()) {
        if (b.user_id !== userId || b.completed_at != null) continue;
        const p = tables.forward_predictions.get(b.prediction_id);
        if (!p) continue;
        if (p.subject_kind === subjectKind && p.subject_id === subjectId) return b;
      }
      return null;
    }
    return null;
  }

  function allStmt(sql, args) {
    if (sql.startsWith("SELECT DISTINCT user_id, world_id FROM world_visits")) {
      return Array.from(tables.world_visits.values())
        .filter(v => v.departed_at == null)
        .map(v => ({ user_id: v.user_id, world_id: v.world_id }));
    }
    if (sql.startsWith("SELECT user_id, world_id FROM player_world_metrics")) {
      return Array.from(tables.player_world_metrics.values()).map(m => ({ user_id: m.user_id, world_id: m.world_id }));
    }
    if (sql.startsWith("SELECT id, user_id, world_id, prediction_id, prose, surfaced_at, completed_at, outcome FROM player_beats")) {
      const [userId, limit] = args;
      const arr = Array.from(tables.player_beats.values())
        .filter(b => b.user_id === userId)
        .sort((a, b) => b.surfaced_at - a.surfaced_at)
        .slice(0, limit);
      return arr;
    }
    // forward-sim's getActivePredictions issues this query against
    // forward_predictions. Mirror its shape here so the scheduler can
    // discover predictions through the real module.
    if (sql.startsWith("SELECT id, world_id, subject_kind, subject_id, anticipated, confidence, composer, composed_at, expires_at FROM forward_predictions")) {
      const [userId, now, limit] = args;
      const arr = Array.from(tables.forward_predictions.values())
        .filter(p => p.user_id === userId && p.realised_at == null && p.expires_at > now)
        .sort((a, b) => b.composed_at - a.composed_at)
        .slice(0, limit);
      return arr;
    }
    return [];
  }

  return { prepare, transaction, _tables: tables };
}

// Force forward-sim's getActivePredictions to consult our fake by having
// the fake return rows that match the real shape. We patch by stashing a
// surrogate on globalThis that the fake reads.
function seedPrediction(db, opts) {
  const id = opts.id || `pred:${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);
  db._tables.forward_predictions.set(id, {
    id,
    user_id: opts.user_id,
    world_id: opts.world_id || "concordia-hub",
    subject_kind: opts.subject_kind || "quest",
    subject_id: opts.subject_id || "q:1",
    anticipated: opts.anticipated || "Something stirs in the eastern grove tomorrow.",
    confidence: opts.confidence ?? 0.7,
    composer: "deterministic",
    composed_at: now - 60,
    expires_at: now + 6 * 3600,
    realised_at: null,
    reality_outcome: null,
  });
  return id;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("runPersonalBeatScheduler — kill-switch + early returns", () => {
  it("returns disabled when CONCORD_PERSONAL_BEATS=0", async () => {
    const prev = process.env.CONCORD_PERSONAL_BEATS;
    process.env.CONCORD_PERSONAL_BEATS = "0";
    try {
      const r = await runPersonalBeatScheduler({ db: makeFakeDb() });
      assert.equal(r.ok, false);
      assert.equal(r.reason, "disabled");
    } finally {
      if (prev === undefined) delete process.env.CONCORD_PERSONAL_BEATS;
      else process.env.CONCORD_PERSONAL_BEATS = prev;
    }
  });

  it("returns no_db with no DB", async () => {
    const r = await runPersonalBeatScheduler({});
    assert.equal(r.ok, false);
    assert.equal(r.reason, "no_db");
  });

  it("returns scheduled:0 with no online users", async () => {
    const db = makeFakeDb();
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scheduled, 0);
  });
});

describe("runPersonalBeatScheduler — TTL expiry", () => {
  it("expires beats older than 24h", async () => {
    const db = makeFakeDb();
    const stale = Math.floor((Date.now() - 25 * 60 * 60 * 1000) / 1000);
    db._tables.player_beats.set("beat:stale", {
      id: "beat:stale", user_id: "user:a", world_id: "concordia-hub",
      prediction_id: "p:x", prose: "old prose", surfaced_at: stale,
      completed_at: null, outcome: null,
    });
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.ok, true);
    assert.equal(r.expired, 1);
    assert.equal(db._tables.player_beats.get("beat:stale").outcome, "expired");
  });

  it("does not expire fresh beats", async () => {
    const db = makeFakeDb();
    const fresh = Math.floor(Date.now() / 1000) - 60;
    db._tables.player_beats.set("beat:fresh", {
      id: "beat:fresh", user_id: "user:a", world_id: "concordia-hub",
      prediction_id: "p:x", prose: "fresh", surfaced_at: fresh,
      completed_at: null, outcome: null,
    });
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.expired, 0);
    assert.equal(db._tables.player_beats.get("beat:fresh").outcome, null);
  });
});

describe("runPersonalBeatScheduler — scheduling", () => {
  it("inserts a beat for an online user with an active prediction", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "concordia-hub", departed_at: null, entered_at: Date.now() });
    seedPrediction(db, { user_id: "user:a", subject_kind: "quest", subject_id: "q:eastern_grove", confidence: 0.85 });
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.ok, true);
    assert.equal(r.scheduled, 1);
    const beats = Array.from(db._tables.player_beats.values());
    assert.equal(beats.length, 1);
    assert.equal(beats[0].user_id, "user:a");
    assert.match(beats[0].prose, /eastern grove/);
  });

  it("skips users who already have an open beat", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "concordia-hub", departed_at: null, entered_at: Date.now() });
    seedPrediction(db, { user_id: "user:a", subject_id: "q:1" });
    db._tables.player_beats.set("beat:open", {
      id: "beat:open", user_id: "user:a", world_id: "concordia-hub",
      prediction_id: "p:other", prose: "still pending", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: null, outcome: null,
    });
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.scheduled, 0);
  });

  it("picks the highest confidence×novelty prediction", async () => {
    const db = makeFakeDb();
    db._tables.world_visits.set("v1", { user_id: "user:a", world_id: "concordia-hub", departed_at: null, entered_at: Date.now() });
    seedPrediction(db, { id: "low", user_id: "user:a", subject_kind: "npc", subject_id: "npc:k1", confidence: 0.3, anticipated: "low-conf prose" });
    seedPrediction(db, { id: "high", user_id: "user:a", subject_kind: "quest", subject_id: "q:big", confidence: 0.9, anticipated: "high-conf prose" });
    const r = await runPersonalBeatScheduler({ db });
    assert.equal(r.scheduled, 1);
    const beat = Array.from(db._tables.player_beats.values())[0];
    assert.equal(beat.prediction_id, "high");
  });
});

describe("realiseBeat", () => {
  it("realised cascades into prediction + bumps concordia_alignment", async () => {
    const db = makeFakeDb();
    seedPrediction(db, { id: "p:1", user_id: "user:a" });
    db._tables.player_beats.set("b:1", {
      id: "b:1", user_id: "user:a", world_id: "concordia-hub",
      prediction_id: "p:1", prose: "x", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: null, outcome: null,
    });
    db._tables.player_world_metrics.set("user:a|concordia-hub", {
      user_id: "user:a", world_id: "concordia-hub", concordia_alignment: 0.4, refusal_debt: 0,
    });

    const r = await realiseBeat(db, "b:1", "realised");
    assert.equal(r.ok, true);
    assert.equal(r.outcome, "realised");
    assert.equal(db._tables.player_beats.get("b:1").outcome, "realised");
    // Cascade — forward-sim row gets realised_at stamped.
    assert.notEqual(db._tables.forward_predictions.get("p:1").realised_at, null);
    // Metric shift.
    assert.ok(db._tables.player_world_metrics.get("user:a|concordia-hub").concordia_alignment > 0.4);
  });

  it("rejected bumps refusal_debt", async () => {
    const db = makeFakeDb();
    seedPrediction(db, { id: "p:2", user_id: "user:b" });
    db._tables.player_beats.set("b:2", {
      id: "b:2", user_id: "user:b", world_id: "concordia-hub",
      prediction_id: "p:2", prose: "x", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: null, outcome: null,
    });
    db._tables.player_world_metrics.set("user:b|concordia-hub", {
      user_id: "user:b", world_id: "concordia-hub", concordia_alignment: 0.4, refusal_debt: 0,
    });
    const r = await realiseBeat(db, "b:2", "rejected");
    assert.equal(r.ok, true);
    assert.ok(db._tables.player_world_metrics.get("user:b|concordia-hub").refusal_debt > 0);
  });

  it("idempotent — already-completed beat returns reason 'already_completed'", async () => {
    const db = makeFakeDb();
    db._tables.player_beats.set("b:done", {
      id: "b:done", user_id: "user:c", world_id: "concordia-hub",
      prediction_id: null, prose: "x", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: Math.floor(Date.now() / 1000), outcome: "realised",
    });
    const r = await realiseBeat(db, "b:done", "realised");
    assert.equal(r.ok, false);
    assert.equal(r.reason, "already_completed");
  });

  it("missing inputs returns reason 'missing_inputs'", async () => {
    const r = await realiseBeat(null, null);
    assert.equal(r.ok, false);
    assert.equal(r.reason, "missing_inputs");
  });
});

describe("findOpenBeatBySubject + listBeatsForUser", () => {
  it("findOpenBeatBySubject returns the matching open beat", () => {
    const db = makeFakeDb();
    seedPrediction(db, { id: "p:q1", user_id: "user:a", subject_kind: "quest", subject_id: "q:harvest" });
    db._tables.player_beats.set("b:q1", {
      id: "b:q1", user_id: "user:a", world_id: "concordia-hub",
      prediction_id: "p:q1", prose: "x", surfaced_at: Math.floor(Date.now() / 1000),
      completed_at: null, outcome: null,
    });
    const r = findOpenBeatBySubject(db, "user:a", "quest", "q:harvest");
    assert.ok(r);
    assert.equal(r.id, "b:q1");
  });

  it("findOpenBeatBySubject returns null on no match", () => {
    const db = makeFakeDb();
    const r = findOpenBeatBySubject(db, "user:nobody", "quest", "q:none");
    assert.equal(r, null);
  });

  it("listBeatsForUser tolerates missing tables", () => {
    const r = listBeatsForUser(null, "user:a");
    assert.deepEqual(r, []);
  });

  it("listBeatsForUser returns user's beats sorted desc by surfaced_at", () => {
    const db = makeFakeDb();
    const now = Math.floor(Date.now() / 1000);
    db._tables.player_beats.set("b:old", {
      id: "b:old", user_id: "user:x", world_id: "w", prediction_id: null,
      prose: "old", surfaced_at: now - 100, completed_at: null, outcome: null,
    });
    db._tables.player_beats.set("b:new", {
      id: "b:new", user_id: "user:x", world_id: "w", prediction_id: null,
      prose: "new", surfaced_at: now, completed_at: null, outcome: null,
    });
    const r = listBeatsForUser(db, "user:x", 10);
    assert.equal(r.length, 2);
    assert.equal(r[0].id, "b:new");
  });
});

describe("internals exposed for verification", () => {
  it("constants are sane", () => {
    assert.equal(_internal.SCHEDULER_FREQ_TICKS, 60);
    assert.equal(_internal.BEAT_TTL_MS, 24 * 60 * 60 * 1000);
    assert.ok(_internal.MAX_BEATS_PER_PASS >= 10);
  });
});
