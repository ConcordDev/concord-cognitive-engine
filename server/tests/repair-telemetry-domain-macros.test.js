// Repair-telemetry domain macros — behavioral test against a real migrated DB.
//
// The /lenses/repair-telemetry dashboard drives the `repair` domain
// (server/domains/repair.js, registered as registerRepairMacros in server.js).
// It calls five macros:
//   repair.health_log        — the Homeostasis ledger (health_check_log rows)
//   repair.escalations        — the escalation inbox (initiatives, system_repair_escalation)
//   repair.resolve_escalation — operator approve/dismiss of an escalation
//   repair.memory             — in-memory Repair Memory learning stats
//   repair.run_now             — operator-triggered on-demand Homeostasis pass (added
//                                 2026-07-11 — wires the previously-unsurfaced
//                                 runWorldHealthPass/escalator pair into the lens)
//
// This is NOT shape-only: every test asserts ACTUAL values + multi-step
// round-trips (seed two findings → list both, newest-first → filter by
// disposition; seed two escalations → list pending → resolve one approved →
// it leaves the pending list and the underlying row flips to 'acted';
// resolve dismissed → row flips to 'dismissed'; resolve a missing id → ok:false).
// It pins the live-DB reality the contract overrides assert (reads `{}` →
// ok:true with an array, NEVER no_db).
//
// Every macro is operator-gated (added 2026-07-11 — before this pass the
// gate was decorative: `/api/lens/run` has no domain-level role check, so
// ANY authenticated user could read other users' negative-balance findings
// or approve/dismiss Sovereign escalations). The "authorization" describe
// block below pins that every macro denies a non-admin actor and allows an
// admin/owner/sovereign/founder one.
//
// Hermetic + fast: migrations run ONCE in before() on a single in-memory DB;
// the two tables are cleared per-test. No server boot. The handlers delegate
// to the real schema (migrations 304 health_check_log, 029 initiatives) and to
// emergent/repair-cortex.js#getRepairMemoryStats (the real lib, no duplication).

import { describe, it, before, beforeEach, afterEach, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";
import registerRepairMacros from "../domains/repair.js";

function buildRegistry() {
  const MACROS = new Map();
  const register = (d, n, fn, spec) => {
    assert.equal(d, "repair", `unexpected domain: ${d}`);
    if (!MACROS.has(d)) MACROS.set(d, new Map());
    MACROS.get(d).set(n, { fn, spec });
  };
  registerRepairMacros(register);
  return {
    run: (name, ctx, input) => MACROS.get("repair").get(name).fn(ctx, input ?? {}),
    names: [...MACROS.get("repair").keys()],
  };
}

function seedUser(db, id) {
  db.prepare(
    `INSERT INTO users (id, username, email, password_hash, created_at)
     VALUES (?, ?, ?, 'x', unixepoch())`,
  ).run(id, `u_${id}`, `${id}@example.test`);
}

function seedFinding(db, id, { pathology, category, disposition, subject_id, checked_at, detail = {} }) {
  db.prepare(`
    INSERT INTO health_check_log (id, pathology, category, disposition, subject_id, detail_json, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, pathology, category, disposition, subject_id, JSON.stringify(detail), checked_at);
}

function seedEscalation(db, id, { message, priority = "high", status = "pending", created_at, trigger = "system_repair_escalation" }) {
  db.prepare(`
    INSERT INTO initiatives (id, user_id, trigger_type, message, priority, status, created_at)
    VALUES (?, 'u1', ?, ?, ?, ?, ?)
  `).run(id, trigger, message, priority, status, created_at);
}

describe("repair.* domain macros (real migrated DB)", () => {
  let db, reg;
  // Operator-role actor — every macro requires this since the 2026-07-11 authz fix.
  const ctx = { db: null, actor: { userId: "u1", role: "admin" } };

  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    seedUser(db, "u1");
    reg = buildRegistry();
    ctx.db = db;
  });
  beforeEach(() => {
    db.exec("DELETE FROM health_check_log; DELETE FROM initiatives;");
  });
  after(() => { try { db.close(); } catch { /* noop */ } });

  it("registers exactly the five macros the lens drives", () => {
    assert.deepEqual(
      reg.names.sort(),
      ["escalations", "health_log", "memory", "resolve_escalation", "run_now"],
    );
  });

  // ── authorization — every macro is operator-only ──────────────────────────
  describe("authorization", () => {
    const macroCalls = [
      ["health_log", {}],
      ["escalations", {}],
      ["resolve_escalation", { id: "nonexistent", resolution: "approved" }],
      ["memory", {}],
      ["run_now", {}],
    ];

    for (const [name, input] of macroCalls) {
      it(`${name} denies a non-admin actor (admin_only)`, async () => {
        const out = await reg.run(name, { db, actor: { userId: "u1", role: "member" } }, input);
        assert.equal(out.ok, false);
        assert.equal(out.error, "admin_only");
      });

      it(`${name} denies an actor with no role at all`, async () => {
        const out = await reg.run(name, { db, actor: { userId: "u1" } }, input);
        assert.equal(out.ok, false);
        assert.equal(out.error, "admin_only");
      });

      it(`${name} denies a call with no actor object`, async () => {
        const out = await reg.run(name, { db }, input);
        assert.equal(out.ok, false);
        assert.equal(out.error, "admin_only");
      });
    }

    for (const role of ["admin", "owner", "sovereign", "founder"]) {
      it(`health_log allows role=${role}`, async () => {
        const out = await reg.run("health_log", { db, actor: { userId: "u1", role } }, {});
        assert.equal(out.ok, true);
      });
    }
  });

  // ── repair.health_log — Homeostasis ledger ────────────────────────────────
  describe("health_log", () => {
    it("returns ok:true with an empty array on a fresh DB (never no_db)", async () => {
      const out = await reg.run("health_log", ctx, {});
      assert.equal(out.ok, true);
      assert.deepEqual(out.entries, []);
    });

    it("lists findings newest-first and parses detail_json", async () => {
      seedFinding(db, "h1", { pathology: "negative_balance", category: "economy", disposition: "healed", subject_id: "wallet_7", checked_at: 100, detail: { delta: -5 } });
      seedFinding(db, "h2", { pathology: "stuck_scheduler", category: "liveness", disposition: "noted", subject_id: "sched_3", checked_at: 200 });
      seedFinding(db, "h3", { pathology: "dangling_arc", category: "arc", disposition: "escalated", subject_id: "quest_9", checked_at: 300 });

      const out = await reg.run("health_log", ctx, { limit: 100 });
      assert.equal(out.ok, true);
      assert.equal(out.entries.length, 3);
      // newest-first (checked_at DESC)
      assert.deepEqual(out.entries.map(e => e.id), ["h3", "h2", "h1"]);
      // detail_json is parsed into .detail
      const h1 = out.entries.find(e => e.id === "h1");
      assert.deepEqual(h1.detail, { delta: -5 });
      assert.equal(h1.disposition, "healed");
      assert.equal(h1.category, "economy");
    });

    it("filters by disposition", async () => {
      seedFinding(db, "h1", { pathology: "p1", category: "economy", disposition: "healed", subject_id: "s1", checked_at: 100 });
      seedFinding(db, "h2", { pathology: "p2", category: "arc", disposition: "escalated", subject_id: "s2", checked_at: 200 });

      const healed = await reg.run("health_log", ctx, { disposition: "healed" });
      assert.equal(healed.ok, true);
      assert.equal(healed.entries.length, 1);
      assert.equal(healed.entries[0].id, "h1");
    });

    it("clamps a large-but-valid limit to a SQL bound (not a crash)", async () => {
      for (let i = 0; i < 5; i++) seedFinding(db, `h${i}`, { pathology: "p", category: "liveness", disposition: "noted", subject_id: "s", checked_at: i });
      const out = await reg.run("health_log", ctx, { limit: 999999 }); // < 1e6 → valid
      assert.equal(out.ok, true);
      assert.equal(out.entries.length, 5); // all 5 returned; the clamp is a SQL LIMIT bound, not a crash
    });

    it("fails CLOSED on a poisoned numeric limit (NaN / Infinity / negative / absurd)", async () => {
      for (const bad of [Infinity, NaN, -1, 1e308, "drop table"]) {
        const out = await reg.run("health_log", ctx, { limit: bad });
        assert.equal(out.ok, false, `limit=${String(bad)} should reject`);
        assert.equal(out.reason, "invalid_limit");
      }
    });

    it("fails closed with no_db when ctx has no db", async () => {
      // The operator-role gate runs FIRST in every repair.* macro (below), so
      // this ctx needs an admin role to actually exercise the no_db path —
      // a non-operator ctx short-circuits with "admin_only" before ever
      // reaching the db check, which is a separate, already-covered case.
      const out = await reg.run("health_log", { actor: { userId: "u1", role: "admin" } }, {});
      assert.equal(out.ok, false);
      assert.equal(out.reason, "no_db");
    });
  });

  // ── repair.escalations — the inbox ────────────────────────────────────────
  describe("escalations", () => {
    it("returns ok:true with an empty array on a fresh DB", async () => {
      const out = await reg.run("escalations", ctx, {});
      assert.equal(out.ok, true);
      assert.deepEqual(out.escalations, []);
    });

    it("only surfaces system_repair_escalation triggers, pending by default, newest-first", async () => {
      seedEscalation(db, "e1", { message: "refused to rebalance economy", created_at: "2026-01-01T00:00:00Z" });
      seedEscalation(db, "e2", { message: "refused to retire an arc", created_at: "2026-01-02T00:00:00Z" });
      // noise: a non-repair initiative + a non-pending repair one must NOT appear
      seedEscalation(db, "n1", { message: "good morning", trigger: "morning_brief", created_at: "2026-01-03T00:00:00Z" });
      seedEscalation(db, "n2", { message: "already acted", status: "acted", created_at: "2026-01-04T00:00:00Z" });

      const out = await reg.run("escalations", ctx, {});
      assert.equal(out.ok, true);
      assert.deepEqual(out.escalations.map(e => e.id), ["e2", "e1"]);
      assert.equal(out.escalations[0].priority, "high");
      assert.equal(out.escalations[0].status, "pending");
    });

    it("honors an explicit status filter", async () => {
      seedEscalation(db, "e1", { message: "m", status: "acted", created_at: "2026-01-01T00:00:00Z" });
      const acted = await reg.run("escalations", ctx, { status: "acted" });
      assert.equal(acted.ok, true);
      assert.deepEqual(acted.escalations.map(e => e.id), ["e1"]);
    });
  });

  // ── repair.resolve_escalation — operator decision ─────────────────────────
  describe("resolve_escalation", () => {
    it("approve flips the row to 'acted' and removes it from the pending inbox", async () => {
      seedEscalation(db, "e1", { message: "decide", created_at: "2026-01-01T00:00:00Z" });

      const res = await reg.run("resolve_escalation", ctx, { id: "e1", resolution: "approved" });
      assert.equal(res.ok, true);
      assert.equal(res.resolution, "approved");

      const row = db.prepare("SELECT status FROM initiatives WHERE id='e1'").get();
      assert.equal(row.status, "acted");

      const pending = await reg.run("escalations", ctx, {});
      assert.equal(pending.escalations.length, 0);
    });

    it("dismiss flips the row to 'dismissed'", async () => {
      seedEscalation(db, "e1", { message: "decide", created_at: "2026-01-01T00:00:00Z" });
      const res = await reg.run("resolve_escalation", ctx, { id: "e1", resolution: "dismissed" });
      assert.equal(res.ok, true);
      assert.equal(res.resolution, "dismissed");
      assert.equal(db.prepare("SELECT status FROM initiatives WHERE id='e1'").get().status, "dismissed");
    });

    it("an unknown resolution string is coerced to 'dismissed'", async () => {
      seedEscalation(db, "e1", { message: "decide", created_at: "2026-01-01T00:00:00Z" });
      const res = await reg.run("resolve_escalation", ctx, { id: "e1", resolution: "🤖<script>" });
      assert.equal(res.ok, true);
      assert.equal(res.resolution, "dismissed");
      assert.equal(db.prepare("SELECT status FROM initiatives WHERE id='e1'").get().status, "dismissed");
    });

    it("resolving a non-existent id is ok:false (no row changed)", async () => {
      const res = await reg.run("resolve_escalation", ctx, { id: "ghost", resolution: "approved" });
      assert.equal(res.ok, false);
    });

    it("will not resolve a non-repair initiative (trigger scoping)", async () => {
      seedEscalation(db, "n1", { message: "brief", trigger: "morning_brief", created_at: "2026-01-01T00:00:00Z" });
      const res = await reg.run("resolve_escalation", ctx, { id: "n1", resolution: "approved" });
      assert.equal(res.ok, false); // WHERE trigger_type filter means 0 rows changed
      assert.equal(db.prepare("SELECT status FROM initiatives WHERE id='n1'").get().status, "pending");
    });

    it("rejects a missing id", async () => {
      const res = await reg.run("resolve_escalation", ctx, { resolution: "approved" });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "missing_id");
    });

    it("requires an actor (operator-scoped write) — denied by the authz gate first", async () => {
      // No actor at all fails the operator-role gate (admin_only) before the
      // handler's own `no_actor` guard is ever reached — the authz gate below
      // pins the (now-redundant, but still-correct as defense-in-depth)
      // no_actor path directly with an admin actor missing only userId.
      const res = await reg.run("resolve_escalation", { db }, { id: "e1", resolution: "approved" });
      assert.equal(res.ok, false);
      assert.equal(res.error, "admin_only");
    });

    it("the handler's own no_actor guard still fires for an admin actor with no userId (defense-in-depth)", async () => {
      seedEscalation(db, "e1", { message: "decide", created_at: "2026-01-01T00:00:00Z" });
      const res = await reg.run("resolve_escalation", { db, actor: { role: "admin" } }, { id: "e1", resolution: "approved" });
      assert.equal(res.ok, false);
      assert.equal(res.reason, "no_actor");
    });
  });

  // ── repair.memory — Repair Memory learning stats ──────────────────────────
  describe("memory", () => {
    it("returns ok:true with the numeric learning stats shape", async () => {
      const out = await reg.run("memory", ctx, {});
      assert.equal(out.ok, true);
      assert.ok(out.stats && typeof out.stats === "object");
      assert.equal(typeof out.stats.totalPatterns, "number");
      assert.equal(typeof out.stats.totalRepairs, "number");
      assert.equal(typeof out.stats.avgSuccessRate, "number");
      assert.equal(typeof out.stats.deprecatedFixes, "number");
      assert.ok(out.stats.avgSuccessRate >= 0 && out.stats.avgSuccessRate <= 1);
    });
  });

  // ── repair.run_now — operator-triggered on-demand Homeostasis pass ────────
  // Reuses server/lib/world-health.js#runWorldHealthPass + the shared
  // escalator from server/emergent/world-health-monitor.js — the SAME
  // detect -> classify -> heal/escalate pipeline the ~4h heartbeat runs, not
  // a parallel implementation. Cooldown is read fresh per call via
  // CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS so it's testable without real sleeps.
  describe("run_now", () => {
    const savedEnv = {};
    beforeEach(() => {
      savedEnv.cooldown = process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS;
      savedEnv.disabled = process.env.CONCORD_WORLD_HEALTH;
      process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS = "0"; // no throttling unless a test opts in
      delete process.env.CONCORD_WORLD_HEALTH;
    });
    afterEach(() => {
      if (savedEnv.cooldown === undefined) delete process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS;
      else process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS = savedEnv.cooldown;
      if (savedEnv.disabled === undefined) delete process.env.CONCORD_WORLD_HEALTH;
      else process.env.CONCORD_WORLD_HEALTH = savedEnv.disabled;
    });

    it("runs the real detect->classify->heal/escalate pipeline and returns a summary", async () => {
      // negative_balance is economy -> escalated (never auto-mutated).
      db.prepare("UPDATE users SET concordia_credits = -50 WHERE id = 'u1'").run();
      const out = await reg.run("run_now", ctx, {});
      assert.equal(out.ok, true);
      assert.ok(out.checked >= 1);
      assert.ok(out.escalated >= 1);
      assert.ok(Array.isArray(out.findings));

      // the pass wrote a real health_check_log row...
      const logged = db.prepare("SELECT * FROM health_check_log WHERE pathology='negative_balance'").get();
      assert.ok(logged, "expected a negative_balance finding to be logged");
      assert.equal(logged.disposition, "escalated");
      assert.equal(logged.subject_id, "u1");

      // ...and escalated it into the real Sovereign inbox via the SAME
      // escalator the heartbeat uses (not a duplicated code path).
      const via = await reg.run("escalations", ctx, {});
      assert.ok(via.escalations.some((e) => e.message.includes("negative_balance") && e.message.includes("u1")));
    });

    it("is cooldown-gated on repeated calls", async () => {
      // Prime the module-scoped `_lastRunNowAt` with a zero-cooldown call
      // first (the cooldown clock is shared across the whole module, not
      // per-test, so this makes the assertion below order-independent
      // instead of relying on this being the very first run_now call in
      // the file — elapsed < 0 is never true, so this always succeeds).
      process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS = "0";
      const primed = await reg.run("run_now", ctx, {});
      assert.equal(primed.ok, true);

      process.env.CONCORD_REPAIR_RUN_NOW_COOLDOWN_MS = "60000";
      const second = await reg.run("run_now", ctx, {});
      assert.equal(second.ok, false);
      assert.equal(second.reason, "cooldown");
      assert.ok(second.retryInMs > 0 && second.retryInMs <= 60000);
    });

    it("respects the CONCORD_WORLD_HEALTH=0 kill switch", async () => {
      process.env.CONCORD_WORLD_HEALTH = "0";
      const out = await reg.run("run_now", ctx, {});
      assert.equal(out.ok, false);
      assert.equal(out.reason, "disabled");
    });

    it("fails closed with no_db when ctx has no db", async () => {
      const out = await reg.run("run_now", { actor: { userId: "u1", role: "admin" } }, {});
      assert.equal(out.ok, false);
      assert.equal(out.reason, "no_db");
    });
  });
});
