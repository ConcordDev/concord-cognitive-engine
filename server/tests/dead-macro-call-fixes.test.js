// Verification-audit fix — pinning tests for 9 real dead-macro-call
// findings: frontend calls to (domain, macro) pairs that were never
// registered on the backend (guaranteed unknown_macro at runtime).

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runMigrations } from "../migrate.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(domain, name, ctx, params = {}) {
  const fn = ACTIONS.get(`${domain}.${name}`);
  assert.ok(fn, `${domain}.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

describe("art.generate — real Pollinations text-to-image wiring", () => {
  before(async () => {
    const registerArtActions = (await import("../domains/art.js")).default;
    registerArtActions(register);
  });

  it("returns a real image URL shape for a prompt (network blocked under test, degrades honestly)", async () => {
    const r = await call("art", "generate", {}, { prompt: "a red fox in snow" });
    assert.equal(r.ok, true);
    assert.match(r.result.url, /^https:\/\/image\.pollinations\.ai\/prompt\//);
    assert.equal(r.result.reachable, false); // no-egress test guard blocks the HEAD check
  });

  it("rejects an empty prompt", async () => {
    const r = await call("art", "generate", {}, { prompt: "" });
    assert.equal(r.ok, false);
  });
});

describe("creative.generate — image/text kinds + structural_poetry mode", () => {
  before(async () => {
    const registerCreativeActions = (await import("../domains/creative.js")).default;
    registerCreativeActions(register);
  });

  it("kind:'image' delegates to the same real image generator as art.generate", async () => {
    const r = await call("creative", "generate", {}, { kind: "image", prompt: "a blue whale" });
    assert.equal(r.ok, true);
    assert.match(r.result.url, /^https:\/\/image\.pollinations\.ai\/prompt\//);
  });

  it("kind:'text' returns an honest deterministic scaffold with no LLM configured", async () => {
    const r = await call("creative", "generate", {}, { kind: "text", prompt: "a poem about the sea" });
    assert.equal(r.ok, true);
    assert.match(r.result.content, /a poem about the sea/);
  });

  it("kind:'melody' returns an honest not-yet-wired failure, never a fabricated melody", async () => {
    const r = await call("creative", "generate", {}, { kind: "melody", prompt: "a jazz riff" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_yet_wired");
  });

  it("mode:'structural_poetry' returns a deterministic skeleton for the requested form", async () => {
    const r = await call("creative", "generate", {}, { mode: "structural_poetry", form: "haiku" });
    assert.equal(r.ok, true);
    assert.equal(r.result.form, "haiku");
    assert.ok(r.result.content.split("\n").length >= 3);
  });
});

describe("healthcare.generate — care-plan scaffold, never a fabricated diagnosis", () => {
  before(async () => {
    const registerHealthcareActions = (await import("../domains/healthcare.js")).default;
    registerHealthcareActions(register);
  });

  it("returns a safe deterministic scaffold with no LLM configured", async () => {
    const r = await call("healthcare", "generate", {}, { symptoms: "headache, fatigue" });
    assert.equal(r.ok, true);
    assert.match(r.result.content, /headache, fatigue/);
    assert.match(r.result.content, /not a diagnosis/i);
  });

  it("rejects empty symptoms", async () => {
    const r = await call("healthcare", "generate", {}, { symptoms: "" });
    assert.equal(r.ok, false);
  });
});

describe("code.forge-generate — keyword-mapped Forge template generation", () => {
  before(async () => {
    const registerCodeActions = (await import("../domains/code.js")).default;
    registerCodeActions(register);
  });

  it("maps an ecommerce description to the ecommerce template and generates real code", async () => {
    const r = await call("code", "forge-generate", {}, { description: "an online shop with a cart and checkout" });
    assert.equal(r.ok, true);
    assert.equal(r.result.templateId, "ecommerce");
    assert.match(r.result.content, /\S/);
  });

  it("falls back to the blank template for an unmatched description", async () => {
    const r = await call("code", "forge-generate", {}, { description: "something entirely generic" });
    assert.equal(r.ok, true);
    assert.equal(r.result.templateId, "blank");
  });

  it("rejects an empty description", async () => {
    const r = await call("code", "forge-generate", {}, { description: "" });
    assert.equal(r.ok, false);
  });
});

describe("code.exec — real macro the retargeted 'Run Script' button now calls", () => {
  before(async () => {
    const registerCodeActions = (await import("../domains/code.js")).default;
    registerCodeActions(register);
  });

  it("executes real JS and returns stdout (when CONCORD_CODE_EXEC_ENABLED)", () => {
    const prevEnv = process.env.CONCORD_CODE_EXEC_ENABLED;
    process.env.CONCORD_CODE_EXEC_ENABLED = "1";
    try {
      const r = call("code", "exec", {}, { code: "console.log(2 + 2)", language: "javascript" });
      assert.equal(r.ok, true);
      assert.match(r.result.stdout, /4/);
    } finally {
      if (prevEnv === undefined) delete process.env.CONCORD_CODE_EXEC_ENABLED;
      else process.env.CONCORD_CODE_EXEC_ENABLED = prevEnv;
    }
  });
});

describe("skills.atrophy_risk — real dtus-table wiring", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    const registerSkillsActions = (await import("../domains/skills.js")).default;
    registerSkillsActions(register);
  });

  it("requires authentication", () => {
    const r = call("skills", "atrophy_risk", { db }, {});
    assert.equal(r.ok, false);
  });

  it("returns an honest zero-risk default when the user has no skill DTUs", () => {
    const r = call("skills", "atrophy_risk", { db, userId: "user_no_skills" }, {});
    assert.equal(r.ok, true);
    assert.equal(r.result.daysUnused, null);
    assert.equal(r.result.immune, false);
  });

  it("surfaces the most-at-risk skill for the user, using the real decay math", () => {
    const userId = "user_with_skills";
    db.prepare(`INSERT INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, 'x', unixepoch())`)
      .run(userId, "u_atrophy", "atrophy@example.test");
    const longUnused = Date.now() - 40 * 86_400_000; // 40 days ago — past the 14-day grace window
    const recentlyUsed = Date.now() - 1 * 86_400_000;
    db.prepare(`INSERT INTO dtus (id, type, title, owner_user_id, skill_level, last_used_at) VALUES (?, 'skill', 'Rusty Skill', ?, 50, ?)`)
      .run("dtu_rusty", userId, longUnused);
    db.prepare(`INSERT INTO dtus (id, type, title, owner_user_id, skill_level, last_used_at) VALUES (?, 'skill', 'Fresh Skill', ?, 50, ?)`)
      .run("dtu_fresh", userId, recentlyUsed);

    const r = call("skills", "atrophy_risk", { db, userId }, {});
    assert.equal(r.ok, true);
    assert.ok(r.result.projectedLoss > 0, "the long-unused skill should dominate the reported risk");
    assert.equal(r.result.immune, false);
  });
});

describe("worlds.anchors_for_world — real world_buildings wiring", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    const registerWorldsActions = (await import("../domains/worlds.js")).default;
    registerWorldsActions(register);
    db.prepare(`INSERT INTO worlds (id, name, universe_type) VALUES (?, ?, ?)`).run("anchor-test-world", "Anchor Test", "fantasy");
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z, is_seed, state)
      VALUES (?, ?, 'tower', 'The Iron Spire', 10, 0, 20, 1, 'standing')
    `).run("bld_spire", "anchor-test-world");
    db.prepare(`
      INSERT INTO world_buildings (id, world_id, building_type, name, x, y, z, is_seed, state)
      VALUES (?, ?, 'house', NULL, 5, 0, 5, 0, 'standing')
    `).run("bld_unnamed", "anchor-test-world");
  });

  it("returns named buildings as navigational anchors, excluding unnamed ones", () => {
    const r = call("worlds", "anchors_for_world", { db }, { worldId: "anchor-test-world" });
    assert.equal(r.ok, true);
    assert.equal(r.result.anchors.length, 1);
    assert.equal(r.result.anchors[0].name, "The Iron Spire");
    assert.equal(r.result.anchors[0].kind, "tower");
  });

  it("requires worldId", () => {
    const r = call("worlds", "anchors_for_world", { db }, {});
    assert.equal(r.ok, false);
  });
});

describe("seasons.current — real world_seasons wiring", () => {
  let db;
  before(async () => {
    db = new Database(":memory:");
    await runMigrations(db);
    const registerSeasonsActions = (await import("../domains/seasons.js")).default;
    registerSeasonsActions(register);
  });

  it("returns a real season name for a world on first call (idempotent init)", () => {
    const r = call("seasons", "current", { db }, { worldId: "season-test-world" });
    assert.equal(r.ok, true);
    assert.ok(["spring", "summer", "monsoon", "harvest", "frost", "deep_winter"].includes(r.result.season));
    assert.equal(typeof r.result.year, "number");
  });

  it("requires worldId", () => {
    const r = call("seasons", "current", { db }, {});
    assert.equal(r.ok, false);
  });
});
