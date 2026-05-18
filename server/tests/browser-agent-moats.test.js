// server/tests/browser-agent-moats.test.js
//
// Tier-2 contract tests for Sprint C: templates, schedules, chains,
// mint + cross-lens cite.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerBrowserAgentMacros from "../domains/browser-agent.js";
import registerBrowserAgentAiMacros from "../domains/browser-agent-ai.js";
import registerBrowserAgentMoatsMacros, { computeNextRun } from "../domains/browser-agent-moats.js";

const MACROS = new Map();
function register(_d, n, h) { MACROS.set(n, h); }
let db;

before(async () => {
  db = new Database(":memory:");
  for (const m of ["220_browser_agent", "221_browser_agent_ai", "222_browser_agent_moats"]) {
    const x = await import(`../migrations/${m}.js`);
    x.up(db);
  }
  // Minimal dtus table for mint paths
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtus (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT, creator_id TEXT,
      meta_json TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  registerBrowserAgentMacros(register);
  registerBrowserAgentAiMacros(register);
  registerBrowserAgentMoatsMacros(register);
});
after(() => { try { db.close(); } catch { /* ok */ } });

function ctx(userId) { return { db, actor: { userId } }; }

describe("computeNextRun cadence math", () => {
  it("every_n_hours adds N*3600 seconds", () => {
    const now = 1_900_000_000;
    assert.equal(computeNextRun("every_n_hours", "6", now), now + 6 * 3600);
  });
  it("daily 09:00 picks today-or-tomorrow at that hour", () => {
    const now = Math.floor(Date.UTC(2026, 5, 1, 8, 0, 0) / 1000);  // 08:00 UTC
    const next = computeNextRun("daily", "09:00", now);
    const d = new Date(next * 1000);
    assert.equal(d.getUTCHours(), 9);
    assert.equal(d.getUTCDate(), 1);  // same day, 9am
  });
  it("daily 06:00 when now is 08:00 picks tomorrow", () => {
    const now = Math.floor(Date.UTC(2026, 5, 1, 8, 0, 0) / 1000);
    const next = computeNextRun("daily", "06:00", now);
    assert.equal(new Date(next * 1000).getUTCDate(), 2);
  });
  it("weekly MO,09:00 finds next Monday", () => {
    const wedNoon = Math.floor(Date.UTC(2026, 5, 3, 12, 0, 0) / 1000);
    const next = computeNextRun("weekly", "MO,09:00", wedNoon);
    assert.equal(new Date(next * 1000).getUTCDay(), 1);
  });
  it("once_at preserves the timestamp", () => {
    const target = 2_000_000_000;
    assert.equal(computeNextRun("once_at", String(target), 1_900_000_000), target);
  });
});

describe("templates", () => {
  it("template_list seeds 4 defaults", async () => {
    const r = await MACROS.get("template_list")(ctx("u_seed"));
    assert.equal(r.ok, true);
    assert.ok(r.templates.length >= 4);
    const names = r.templates.map((t) => t.name);
    assert.ok(names.includes("Scrape + monitor"));
    assert.ok(names.includes("Research brief"));
  });

  it("template_create + template_apply round-trip with var interpolation", async () => {
    const c = await MACROS.get("template_create")(ctx("u_tmpl"), {
      name: "Watch URL", goalTemplate: "Visit {{url}} and report changes since {{since}}",
    });
    assert.equal(c.ok, true);
    const a = await MACROS.get("template_apply")(ctx("u_tmpl"), {
      id: c.id, vars: { url: "https://hn.com", since: "yesterday" },
    });
    assert.equal(a.ok, true);
    const t = await MACROS.get("task_get")(ctx("u_tmpl"), { id: a.taskId });
    assert.ok(t.task.goal.includes("https://hn.com"));
    assert.ok(t.task.goal.includes("yesterday"));
  });

  it("template_publish mints agent_spec DTU", async () => {
    const c = await MACROS.get("template_create")(ctx("u_pub"), {
      name: "Publishable", goalTemplate: "Do {{x}}",
    });
    const p = await MACROS.get("template_publish")(ctx("u_pub"), { id: c.id });
    assert.equal(p.ok, true);
    assert.ok(p.dtuId.startsWith("agent_spec:"));
    const p2 = await MACROS.get("template_publish")(ctx("u_pub"), { id: c.id });
    assert.equal(p2.alreadyPublished, true);
  });

  it("template_apply forbidden across users when private", async () => {
    const c = await MACROS.get("template_create")(ctx("u_priv"), {
      name: "Private", goalTemplate: "x", visibility: "private",
    });
    const r = await MACROS.get("template_apply")(ctx("u_other"), { id: c.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "forbidden");
  });
});

describe("schedules", () => {
  it("schedule_create + list + toggle + delete round-trip", async () => {
    const c = await MACROS.get("schedule_create")(ctx("u_s"), {
      title: "Daily scrape", goal: "scrape hn",
      cadenceKind: "every_n_hours", cadenceParam: "6",
    });
    assert.equal(c.ok, true);
    assert.ok(c.nextRunAt > Math.floor(Date.now() / 1000));
    const list = await MACROS.get("schedule_list")(ctx("u_s"));
    assert.ok(list.schedules.find((s) => s.id === c.id));
    await MACROS.get("schedule_toggle")(ctx("u_s"), { id: c.id, enabled: false });
    const after = await MACROS.get("schedule_list")(ctx("u_s"));
    assert.equal(after.schedules.find((s) => s.id === c.id).enabled, 0);
    const d = await MACROS.get("schedule_delete")(ctx("u_s"), { id: c.id });
    assert.equal(d.ok, true);
  });

  it("schedule_run_now creates a task + bumps next_run_at", async () => {
    const c = await MACROS.get("schedule_create")(ctx("u_run"), {
      title: "Run me now", goal: "do it", cadenceKind: "every_n_hours", cadenceParam: "12",
    });
    const r = await MACROS.get("schedule_run_now")(ctx("u_run"), { id: c.id });
    assert.equal(r.ok, true);
    assert.ok(r.taskId);
    const list = await MACROS.get("schedule_list")(ctx("u_run"));
    const s = list.schedules.find((x) => x.id === c.id);
    assert.equal(s.run_count, 1);
    assert.equal(s.last_task_id, r.taskId);
  });
});

describe("chains", () => {
  it("chain_create + list + delete round-trip", async () => {
    const c = await MACROS.get("chain_create")(ctx("u_c"), {
      triggerOn: "success",
      nextGoalTemplate: "Take {{lastResult}} and post it to slack",
    });
    assert.equal(c.ok, true);
    const list = await MACROS.get("chain_list")(ctx("u_c"));
    assert.ok(list.chains.find((x) => x.id === c.id));
    const d = await MACROS.get("chain_delete")(ctx("u_c"), { id: c.id });
    assert.equal(d.ok, true);
  });

  it("chain_fire_on_complete fires matching chain on success", async () => {
    // Create a source task + chain + complete the source
    const src = await MACROS.get("task_create")(ctx("u_ch"), { title: "Source", goal: "g" });
    await MACROS.get("task_complete")(ctx("u_ch"), { id: src.id, summary: "got result X" });
    await MACROS.get("chain_create")(ctx("u_ch"), {
      triggerTaskId: src.id, triggerOn: "success",
      nextGoalTemplate: "Process {{lastResult}}",
    });
    const r = await MACROS.get("chain_fire_on_complete")(ctx("u_ch"), { taskId: src.id });
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
    const newTask = await MACROS.get("task_get")(ctx("u_ch"), { id: r.fired[0].taskId });
    assert.ok(newTask.task.goal.includes("got result X"));
  });
});

describe("mint + cross-lens cite", () => {
  it("task_mint creates browser_run DTU when task finished + is idempotent", async () => {
    const t = await MACROS.get("task_create")(ctx("u_mint"), { title: "M", goal: "g" });
    await MACROS.get("task_complete")(ctx("u_mint"), { id: t.id, summary: "done" });
    const r1 = await MACROS.get("task_mint")(ctx("u_mint"), { taskId: t.id, royaltyRate: 0.15 });
    assert.equal(r1.ok, true);
    assert.ok(r1.dtuId.startsWith("browser_run:"));
    const r2 = await MACROS.get("task_mint")(ctx("u_mint"), { taskId: t.id });
    assert.equal(r2.alreadyMinted, true);
    assert.equal(r2.dtuId, r1.dtuId);
  });

  it("task_mint refuses while task in-flight", async () => {
    const t = await MACROS.get("task_create")(ctx("u_mip"), { title: "X", goal: "g" });
    const r = await MACROS.get("task_mint")(ctx("u_mip"), { taskId: t.id });
    assert.equal(r.ok, false); assert.equal(r.reason, "task_not_finished");
  });

  it("task_mint clamps royalty rate to 30%", async () => {
    const t = await MACROS.get("task_create")(ctx("u_cap"), { title: "C", goal: "g" });
    await MACROS.get("task_complete")(ctx("u_cap"), { id: t.id, summary: "done" });
    const r = await MACROS.get("task_mint")(ctx("u_cap"), { taskId: t.id, royaltyRate: 0.99 });
    assert.equal(r.royaltyRate, 0.30);
  });

  it("task_cite_dtu requires mint first + degrades when engine absent", async () => {
    const t = await MACROS.get("task_create")(ctx("u_cite"), { title: "C", goal: "g" });
    await MACROS.get("task_complete")(ctx("u_cite"), { id: t.id, summary: "done" });
    const unminted = await MACROS.get("task_cite_dtu")(ctx("u_cite"), { taskId: t.id, dtuId: "dtu:p" });
    assert.equal(unminted.ok, false); assert.equal(unminted.reason, "task_not_minted_yet");
    await MACROS.get("task_mint")(ctx("u_cite"), { taskId: t.id });
    db.prepare(`INSERT INTO dtus (id, kind, title, creator_id, meta_json) VALUES (?, 'doc', 'P', 'u_other', '{}')`).run("dtu:p1");
    const r = await MACROS.get("task_cite_dtu")(ctx("u_cite"), { taskId: t.id, dtuId: "dtu:p1" });
    assert.equal(r.ok, true);
    assert.ok(r.childDtuId);
  });
});
